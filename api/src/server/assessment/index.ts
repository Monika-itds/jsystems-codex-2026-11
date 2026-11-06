import { isAllowedOrigin, getSessionId } from "./security";
import { randomUUID } from "node:crypto";
import {
  limits,
  revisionSchema,
  detailedAnalysisSchema,
  providerIdentitySchema,
  observationIds,
  versions,
  type AssessmentRevision,
  type Blocker,
  type Observation,
  type ProviderIdentity,
} from "../contracts";
import { prepareImage, ImageError, type PreparedImage } from "../images";
import {
  dateInTimeZone,
  evaluatePolicy,
  needsDetailedAnalysis,
  normalizeInitial,
  validateIntake,
} from "../policy";
import {
  ProviderError,
  createProviders,
  answerPlanSchema,
  type AssessmentProviders,
  type AnswerPlan,
} from "../providers";
import { SessionError, SessionStore, type RevisionRecord } from "../sessions";
import type { ConfigResult, ProviderConfig } from "../config/config";
import {
  buildTrustedContext,
  renderAnswerPlan,
  validatePlanReferences,
  type PolicyContent,
} from "./presentation";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fallbackPlan: AnswerPlan = {
  topics: [],
  observationIds: [],
  blockerCodes: [],
  acknowledgeNewInformation: false,
};
const blocker = (code: Blocker["code"], message: string): Blocker => ({
  code,
  message,
  observationIds: [],
});
type Deps = {
  store: SessionStore;
  config: () => ConfigResult;
  content: (type: "return" | "complaint") => PolicyContent | null;
  prepare?: (bytes: Buffer) => Promise<PreparedImage>;
  providers?: (config: ProviderConfig) => AssessmentProviders;
  clock?: () => Date;
};
function error(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return Response.json(
    { code, message, ...(fields ? { fields } : {}) },
    { status },
  );
}
function sessionError(e: unknown): Response {
  if (e instanceof SessionError) {
    const status = {
      inaccessible: 404,
      expired: 410,
      stale_revision: 409,
      capacity: 413,
      unavailable: 503,
    }[e.code];
    return error(
      status,
      e.code === "capacity" ? "capacity" : e.code,
      "The session or request is unavailable.",
    );
  }
  return error(503, "unavailable", "The assessment is unavailable.");
}
async function readBounded(req: Request): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limits.bodyBytes))
    throw new ImageError("capacity", "Too large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limits.bodyBytes) {
        await reader.cancel();
        throw new ImageError("capacity", "Too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function timed<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Interrupted"));
      return;
    }
    const onAbort = () => reject(new Error("Interrupted"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
export function createAssessmentHandlers(deps: Deps) {
  const prepare = deps.prepare ?? prepareImage,
    providerFactory = deps.providers ?? createProviders,
    clock = deps.clock ?? (() => new Date());
  async function post(req: Request): Promise<Response> {
    if (!isAllowedOrigin(req))
      return error(403, "origin", "Request origin is not allowed.");
    let form: FormData;
    try {
      const body = await readBounded(req);
      form = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: Uint8Array.from(body).buffer,
      }).formData();
    } catch (e) {
      return e instanceof ImageError && e.code === "capacity"
        ? error(413, "capacity", "The request exceeds supported limits.")
        : error(422, "validation", "A valid multipart form is required.");
    }
    const allowed = new Set([
      "caseType",
      "category",
      "model",
      "reason",
      "purchaseDate",
      "image",
      "requestId",
      "caseId",
      "expectedRevision",
    ]);
    const keys = [...form.keys()];
    if (keys.some((k) => !allowed.has(k) || form.getAll(k).length !== 1))
      return error(422, "validation", "Invalid form fields.");
    const field = (key: string) =>
      typeof form.get(key) === "string" ? (form.get(key) as string) : undefined;
    const requestId = field("requestId"),
      caseId = field("caseId"),
      expected = field("expectedRevision");
    if (
      !requestId ||
      !uuid.test(requestId) ||
      (caseId && !uuid.test(caseId)) ||
      (expected !== undefined &&
        (!/^(0|[1-9]\d*)$/.test(expected) ||
          !Number.isSafeInteger(Number(expected)))) ||
      (caseId && expected === undefined)
    )
      return error(422, "validation", "Invalid revision information.");
    let config: ConfigResult;
    try {
      config = deps.config();
    } catch {
      config = { available: false, missing: [] };
    }
    const timeZone = config.available
      ? config.config.timeZone
      : "Europe/Warsaw";
    let intake: ReturnType<typeof validateIntake>, assessmentDate: string;
    try {
      assessmentDate = dateInTimeZone(clock(), timeZone);
      intake = validateIntake(
        {
          caseType: field("caseType"),
          category: field("category"),
          model: field("model"),
          purchaseDate: field("purchaseDate"),
          reason: field("reason") ?? "",
        },
        assessmentDate,
      );
    } catch {
      return error(
        422,
        "validation",
        "Check the case fields and purchase date.",
        { form: "Check required fields and use a valid non-future date." },
      );
    }
    const file = form.get("image");
    if (
      !file ||
      typeof file === "string" ||
      !/\.(jpe?g|png|webp)$/i.test(file.name) ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      return error(422, "validation", "Choose one supported image.", {
        image: "Use a JPEG, PNG or WebP image.",
      });
    if (file.size > limits.uploadBytes)
      return error(413, "capacity", "The image exceeds supported limits.");
    let image: PreparedImage;
    try {
      image = await prepare(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      return e instanceof ImageError && e.code === "capacity"
        ? error(413, "capacity", "The image exceeds supported limits.")
        : error(422, "validation", "The image is invalid or unsupported.", {
            image: "Choose a valid image.",
          });
    }
    const policyVersion =
      intake.caseType === "return" ? "DEMO-RETURN-1.0" : "DEMO-COMPLAINT-1.0";
    let loaded: PolicyContent | null = null;
    try {
      loaded = deps.content(intake.caseType);
    } catch {
      /* Missing content requires review. */
    }
    const content =
      loaded?.version === policyVersion &&
      loaded.text.trim() &&
      loaded.prompt.trim()
        ? loaded
        : null;
    const session = getSessionId(req);
    let owner: string,
      created = false;
    try {
      if (session) {
        owner = deps.store.openSession(session).id;
      } else {
        owner = deps.store.openSession().id;
        created = true;
      }
    } catch (e) {
      if (e instanceof SessionError && e.code === "capacity")
        return error(503, "unavailable", "Session capacity has been reached.");
      return sessionError(e);
    }
    let record: RevisionRecord, reused: boolean;
    try {
      ({ record, reused } = deps.store.beginRevision(owner, {
        caseId,
        expectedRevision: expected === undefined ? undefined : Number(expected),
        requestId,
        intake,
        image,
        assessmentDate,
        timeZone,
        versions: {
          ...versions,
          policy: policyVersion,
          decisionsModel: config.available ? config.config.decisionModel : null,
          visionModel: config.available ? config.config.visionModel : null,
          llmModel: config.available ? config.config.llmModel : null,
        },
      }));
    } catch (e) {
      if (created)
        try {
          deps.store.clearSession(owner);
        } catch {
          /* Session may already be gone. */
        }
      return sessionError(e);
    }
    const headers = new Headers({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    });
    if (created)
      headers.set(
        "set-cookie",
        `hardware_session=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`,
      );
    let sequence = 0;
    const encoder = new TextEncoder();
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (value: unknown) => {
          if (!streamCancelled)
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
              );
            } catch {
              streamCancelled = true;
            }
        };
        const progress = (
          stage:
            | AssessmentRevision["stage"]
            | "observations"
            | "detailed_analysis"
            | "policy"
            | "explanation",
        ) => {
          record.stage = stage;
          emit({
            kind: "progress",
            sequence: ++sequence,
            caseId: record.caseId,
            revision: record.revision,
            stage,
          });
        };
        if (reused && record.result) {
          emit({
            kind: "result",
            sequence: ++sequence,
            caseId: record.caseId,
            revision: record.revision,
            result: record.result,
          });
          controller.close();
          return;
        }
        const abort = () => record.controller.abort();
        req.signal.addEventListener("abort", abort, { once: true });
        if (req.signal.aborted) abort();
        const deadline = setTimeout(abort, 130000);
        const run = async () => {
          let observations: Observation[] = normalizeInitial(
              {},
              record.versions.decisionsModel,
            ),
            detail: AssessmentRevision["detailedAnalysis"] = null;
          const blockers: Blocker[] = [];
          const identities: ProviderIdentity[] = [];
          let providers: AssessmentProviders | null = null;
          let interrupted = false;
          try {
            if (config.available)
              try {
                providers = providerFactory(config.config);
              } catch {
                /* Configuration failure is a required provider failure. */
              }
            if (!content)
              blockers.push(
                blocker(
                  "missing_policy",
                  "Fictional policy or prompt is unavailable.",
                ),
              );
            if (!providers)
              blockers.push(
                blocker(
                  "provider_failure",
                  "A required assessment provider is unavailable.",
                ),
              );
            if (record.controller.signal.aborted)
              throw new Error("Interrupted");
            if (content && providers) {
              progress("observations");
              let runDetail = false;
              try {
                const output = await timed(
                  providers.initial({
                    intake,
                    image,
                    signal: record.controller.signal,
                  }),
                  record.controller.signal,
                );
                if (
                  Object.keys(output.probabilities).length !== 5 ||
                  observationIds.some(
                    (id) =>
                      typeof output.probabilities[id] !== "number" ||
                      !Number.isFinite(output.probabilities[id]) ||
                      output.probabilities[id] < 0 ||
                      output.probabilities[id] > 1,
                  )
                )
                  throw new ProviderError("invalid_output");
                const identity = providerIdentitySchema.parse(output.identity);
                observations = normalizeInitial(
                  output.probabilities,
                  identity.model,
                );
                identities.push(identity);
                runDetail = needsDetailedAnalysis(observations);
              } catch (e) {
                if (record.controller.signal.aborted) throw e;
                const invalid =
                  e instanceof ProviderError && e.kind === "invalid_output";
                blockers.push(
                  blocker(
                    "provider_failure",
                    "A required assessment provider did not return a usable result.",
                  ),
                );
                observations = normalizeInitial(
                  invalid ? (e.partialProbabilities ?? {}) : {},
                  record.versions.decisionsModel,
                );
                if (invalid && e.identity) identities.push(e.identity);
                runDetail = invalid;
              }
              if (runDetail) {
                progress("detailed_analysis");
                try {
                  const output = await timed(
                    providers.detailed({
                      intake,
                      image,
                      observations,
                      signal: record.controller.signal,
                    }),
                    record.controller.signal,
                  );
                  const parsed = detailedAnalysisSchema.safeParse(
                      output.analysis,
                    ),
                    identity = providerIdentitySchema.safeParse(
                      output.identity,
                    );
                  if (!parsed.success || !identity.success)
                    throw new ProviderError("invalid_output");
                  detail = parsed.data;
                  identities.push(identity.data);
                } catch (e) {
                  if (record.controller.signal.aborted) throw e;
                  blockers.push(
                    blocker(
                      "provider_failure",
                      "Detailed visual analysis is unavailable.",
                    ),
                  );
                }
              }
            }
            if (record.controller.signal.aborted)
              throw new Error("Interrupted");
            progress("policy");
            let policy = evaluatePolicy({
              intake,
              assessmentDate,
              observations,
              detailedAnalysis: detail,
              blockers,
              policyAvailable: !!content,
            });
            const metadata = {
              id: image.id,
              mediaType: image.mediaType,
              width: image.width,
              height: image.height,
              byteLength: image.byteLength,
              hash: image.hash,
              warnings: image.warnings,
            };
            const makeResult = (): AssessmentRevision =>
              revisionSchema.parse({
                caseId: record.caseId,
                revision: record.revision,
                requestId: record.requestId,
                assessmentDate,
                timeZone,
                intake,
                image: metadata,
                stage: interrupted ? "interrupted" : "completed",
                versions: record.versions,
                initialObservations: observations,
                detailedAnalysis: detail,
                providerIdentities: identities,
                policy,
                firstMessage: {
                  id: randomUUID(),
                  role: "assistant",
                  parts: [
                    { type: "text", text: "Pending trusted explanation." },
                  ],
                },
              });
            let result = makeResult();
            let plan = fallbackPlan;
            if (content && providers) {
              progress("explanation");
              try {
                const output = await timed(
                  providers.plan({
                    messages: buildTrustedContext(result, content, []),
                    signal: record.controller.signal,
                    initial: true,
                  }),
                  record.controller.signal,
                );
                const checked = answerPlanSchema.safeParse(output.plan),
                  identity = providerIdentitySchema.safeParse(output.identity);
                if (
                  !checked.success ||
                  !identity.success ||
                  !validatePlanReferences(result, checked.data)
                )
                  throw new Error("Invalid plan");
                plan = checked.data;
                identities.push(identity.data);
              } catch (e) {
                if (record.controller.signal.aborted) throw e;
                blockers.push(
                  blocker(
                    "explanation_failure",
                    "The initial explanation could not be generated.",
                  ),
                );
                policy = evaluatePolicy({
                  intake,
                  assessmentDate,
                  observations,
                  detailedAnalysis: detail,
                  blockers,
                  policyAvailable: !!content,
                });
              }
            }
            result = makeResult();
            result.firstMessage.parts[0].text = renderAnswerPlan(result, plan, {
              first: true,
            });
            deps.store.finishRevision(
              owner,
              record.caseId,
              record.revision,
              result,
            );
            emit({
              kind: "result",
              sequence: ++sequence,
              caseId: record.caseId,
              revision: record.revision,
              result,
            });
          } catch {
            interrupted = true;
            try {
              deps.store.interruptRevision(
                owner,
                record.caseId,
                record.revision,
              );
              blockers.push(
                blocker("interrupted", "The assessment was interrupted."),
              );
              const policy = evaluatePolicy({
                intake,
                assessmentDate,
                observations,
                detailedAnalysis: detail,
                blockers,
                policyAvailable: !!content,
              });
              const { bytes: _, ...metadata } = image;
              const result: AssessmentRevision = revisionSchema.parse({
                caseId: record.caseId,
                revision: record.revision,
                requestId: record.requestId,
                assessmentDate,
                timeZone,
                intake,
                image: metadata,
                stage: "interrupted",
                versions: record.versions,
                initialObservations: observations,
                detailedAnalysis: detail,
                providerIdentities: identities,
                policy,
                firstMessage: {
                  id: randomUUID(),
                  role: "assistant",
                  parts: [
                    {
                      type: "text",
                      text: "Assessment interrupted. Staff review is required; retry or edit and reassess.",
                    },
                  ],
                },
              });
              deps.store.finishRevision(
                owner,
                record.caseId,
                record.revision,
                result,
              );
              emit({
                kind: "result",
                sequence: ++sequence,
                caseId: record.caseId,
                revision: record.revision,
                result,
              });
            } catch {
              /* Deleted, expired or superseded: do not resurrect. */
            }
          } finally {
            clearTimeout(deadline);
            req.signal.removeEventListener("abort", abort);
            if (!streamCancelled)
              try {
                controller.close();
              } catch {
                /* Already closed. */
              }
          }
        };
        return run();
      },
      cancel() {
        streamCancelled = true;
        record.controller.abort();
      },
    });
    return new Response(stream, { status: 200, headers });
  }
  async function get(req: Request, caseId: string): Promise<Response> {
    const owner = getSessionId(req);
    if (!owner || !uuid.test(owner) || !uuid.test(caseId))
      return error(404, "inaccessible", "Session or case is unavailable.");
    try {
      const record = deps.store.getRevision(owner, caseId);
      return Response.json(
        {
          caseId: record.caseId,
          revision: record.revision,
          stage: record.stage,
          interrupted: record.interrupted,
          result: record.result,
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (e) {
      return sessionError(e);
    }
  }
  async function remove(req: Request, caseId: string): Promise<Response> {
    if (!isAllowedOrigin(req))
      return error(403, "origin", "Request origin is not allowed.");
    const owner = getSessionId(req);
    if (!owner || !uuid.test(owner) || !uuid.test(caseId))
      return error(404, "inaccessible", "Session or case is unavailable.");
    try {
      deps.store.deleteCase(owner, caseId);
      return new Response(null, { status: 204 });
    } catch (e) {
      return sessionError(e);
    }
  }
  return { post, get, remove };
}
