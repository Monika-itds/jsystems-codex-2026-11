import { randomUUID } from "node:crypto";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  assistantMessageSchema,
  chatInputSchema,
  httpStatusByError,
  type AssessmentRevision,
} from "../contracts";
import { getSessionId, isAllowedOrigin } from "../assessment/security";
import {
  buildTrustedContext,
  renderAnswerPlan,
  validatePlanReferences,
  type PolicyContent,
} from "../assessment/presentation";
import {
  ProviderError,
  answerPlanSchema,
  createProviders,
  type AnswerPlan,
  type AssessmentProviders,
} from "../providers";
import {
  SessionError,
  type RevisionRecord,
  type SessionStore,
} from "../sessions";
import type { ConfigResult, ProviderConfig } from "../config/config";

export type ChatMetadata = { state: "completed" | "interrupted" };

export interface ChatTurnState {
  text: string;
  state: "active" | "completed" | "interrupted";
  failed: boolean;
  assistantId: string | null;
  assistantText: string | null;
}

export interface ChatState {
  turns: Map<string, ChatTurnState>;
}

export const chatStates = new WeakMap<RevisionRecord, ChatState>();

export type ChatDeps = {
  store: SessionStore;
  config: () => ConfigResult;
  content: (type: "return" | "complaint") => PolicyContent | null;
  providers?: (config: ProviderConfig) => AssessmentProviders;
  render?: (
    result: AssessmentRevision,
    plan: AnswerPlan,
    options: { first: boolean },
  ) => string;
  generateId?: () => string;
};

const bodyBytes = 256 * 1024;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const envelopeKeys = new Set([
  "caseId",
  "revision",
  "messageId",
  "text",
  "id",
  "messages",
  "trigger",
]);
const messagesText = {
  validation: "The chat request is invalid.",
  capacity: "The request exceeds supported limits.",
  origin: "Request origin is not allowed.",
  inaccessible: "Session or case is not available.",
  expired: "Session has expired; start a new case.",
  stale_revision: "The request conflicts with the current revision.",
  context_limit:
    "The complete case and conversation exceed the supported context limit. Edit the form and reassess to continue; the current result remains unchanged.",
  unavailable: "The assistant is unavailable right now.",
} as const;

type ErrorCode = keyof typeof httpStatusByError;

function chatError(code: ErrorCode, message?: string): Response {
  return Response.json(
    { code, message: message ?? messagesText[code] },
    { status: httpStatusByError[code] },
  );
}
function sessionError(e: unknown): Response {
  if (e instanceof SessionError)
    return chatError(
      e.code === "capacity" ? "capacity" : (e.code as ErrorCode),
      e.code === "expired" ? undefined : "The session or case is not available.",
    );
  return chatError("unavailable", "The session data is unavailable.");
}

class BodyError extends Error {}
async function readBounded(req: Request): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > bodyBytes))
    throw new BodyError();
  const reader = req.body?.getReader();
  if (!reader) throw new BodyError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > bodyBytes) {
        await reader.cancel();
        throw new BodyError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

const textPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1).max(64_000),
});
const historyMessageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant"]),
  parts: z.array(textPartSchema).min(1).max(20),
  metadata: z
    .strictObject({ state: z.enum(["completed", "interrupted"]) })
    .optional(),
});
function validHistory(history: UIMessage[]): boolean {
  if (!history.length || history[0].role !== "assistant") return false;
  if (!assistantMessageSchema.safeParse(history[0]).success) return false;
  return history.every(
    (message, index) =>
      index === 0 || historyMessageSchema.safeParse(message).success,
  );
}
function textParts(text: string): Array<{ type: "text"; text: string }> {
  const parts: Array<{ type: "text"; text: string }> = [];
  for (let index = 0; index < text.length; index += 64_000)
    parts.push({ type: "text", text: text.slice(index, index + 64_000) });
  return parts.slice(0, 20);
}
function splitDeltas(text: string): string[] {
  const sections = text
    .split(/(?<=\n\n)/)
    .filter((piece) => piece.length > 0);
  if (sections.length > 1) return sections;
  const size = Math.max(1, Math.ceil(text.length / 4));
  const pieces: string[] = [];
  for (let index = 0; index < text.length; index += size)
    pieces.push(text.slice(index, index + size));
  return pieces;
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function chatState(record: RevisionRecord): ChatState {
  let state = chatStates.get(record);
  if (!state) {
    state = { turns: new Map() };
    chatStates.set(record, state);
  }
  return state;
}

export function createChatHandler(deps: ChatDeps) {
  const providerFactory = deps.providers ?? createProviders;
  const render =
    deps.render ??
    ((result, plan, options) => renderAnswerPlan(result, plan, options));
  const generateId = deps.generateId ?? (() => randomUUID());

  const sseResponse = (stream: Parameters<typeof createUIMessageStreamResponse>[0]["stream"]) =>
    createUIMessageStreamResponse({
      stream,
      consumeSseStream: ({ stream: copy }) => {
        void consumeStream({ stream: copy, onError: () => {} });
      },
      headers: { "cache-control": "no-store" },
    });

  const cancelledStream = (assistantId: string): Response =>
    sseResponse(
      createUIMessageStream<UIMessage>({
        execute: ({ writer }) => {
          writer.write({ type: "start", messageId: assistantId });
          writer.write({ type: "abort", reason: "cancelled" });
        },
        onError: () => "The response was interrupted.",
      }),
    );

  const replayStream = (assistantId: string, text: string): Response =>
    sseResponse(
      createUIMessageStream<UIMessage>({
        execute: async ({ writer }) => {
          const partId = `${assistantId}-text`;
          writer.write({
            type: "start",
            messageId: assistantId,
            messageMetadata: { state: "completed" },
          });
          writer.write({ type: "text-start", id: partId });
          for (const piece of splitDeltas(text)) {
            writer.write({ type: "text-delta", id: partId, delta: piece });
            await tick();
          }
          writer.write({ type: "text-end", id: partId });
          writer.write({
            type: "finish",
            messageMetadata: { state: "completed" },
          });
        },
        onError: () => "The response could not be replayed. Please retry.",
      }),
    );

  async function post(req: Request): Promise<Response> {
    if (req.method !== "POST") return chatError("validation");
    if (!isAllowedOrigin(req)) return chatError("origin");
    const contentType = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(contentType))
      return chatError("validation", "A JSON request body is required.");
    let raw: Uint8Array;
    try {
      raw = await readBounded(req);
    } catch {
      return chatError("capacity");
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(Buffer.from(raw).toString("utf8"));
    } catch {
      return chatError("validation");
    }
    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    )
      return chatError("validation");
    const data = parsedBody as Record<string, unknown>;
    if (Object.keys(data).some((key) => !envelopeKeys.has(key)))
      return chatError(
        "validation",
        "Unknown request fields are not accepted.",
      );
    if (data.id !== undefined && typeof data.id !== "string")
      return chatError("validation");
    if (data.messages !== undefined && !Array.isArray(data.messages))
      return chatError("validation");
    if (data.trigger !== undefined && typeof data.trigger !== "string")
      return chatError("validation");
    // Client-supplied history (data.messages) is deliberately ignored; only
    // server-owned record history plus the explicit text field are trusted.
    const parsed = chatInputSchema.safeParse({
      caseId: data.caseId,
      revision: data.revision,
      messageId: data.messageId,
      text: data.text,
    });
    if (!parsed.success) return chatError("validation");
    const input = parsed.data;

    const owner = getSessionId(req);
    if (!owner || !uuid.test(owner)) return chatError("inaccessible");
    let record: RevisionRecord;
    try {
      record = deps.store.getRevision(owner, input.caseId);
    } catch (e) {
      return sessionError(e);
    }
    if (record.revision !== input.revision) return chatError("stale_revision");
    const result = record.result;
    if (
      record.active ||
      !result ||
      result.stage !== "completed" ||
      result.caseId !== record.caseId ||
      result.revision !== record.revision
    )
      return chatError(
        "stale_revision",
        "The assessment is not ready for chat.",
      );

    let config: ConfigResult;
    try {
      config = deps.config();
    } catch {
      config = { available: false, missing: [] };
    }
    if (!config.available)
      return chatError("unavailable", "The assistant is not configured.");
    let providers: AssessmentProviders;
    try {
      providers = providerFactory(config.config);
    } catch {
      return chatError("unavailable", "The assistant is not configured.");
    }
    let loaded: PolicyContent | null = null;
    try {
      loaded = deps.content(result.intake.caseType);
    } catch {
      loaded = null;
    }
    if (
      !loaded ||
      loaded.version !== result.versions.policy ||
      !loaded.text.trim() ||
      !loaded.prompt.trim()
    )
      return chatError("unavailable", "The fictional policy is unavailable.");

    const state = chatState(record);
    const existing = state.turns.get(input.messageId);
    if (existing && existing.text !== input.text)
      return chatError(
        "stale_revision",
        "This message id was already used with different text.",
      );
    const running =
      (record.conversationController &&
        !record.conversationController.signal.aborted) ||
      [...state.turns.values()].some((turn) => turn.state === "active");
    if (running)
      return chatError(
        "stale_revision",
        "Another chat turn is in progress for this revision.",
      );

    const ensureCurrent = (): boolean => {
      try {
        return (
          deps.store.getRevision(owner, input.caseId) === record &&
          record.result === result &&
          !record.active
        );
      } catch {
        return false;
      }
    };

    if (
      existing &&
      existing.state === "completed" &&
      existing.assistantId &&
      existing.assistantText !== null
    ) {
      if (!ensureCurrent()) return chatError("stale_revision");
      return replayStream(existing.assistantId, existing.assistantText);
    }

    const controller = new AbortController();
    record.conversationController = controller;
    const onAbort = () => controller.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });
    if (req.signal.aborted) controller.abort();

    const turn: ChatTurnState = existing ?? {
      text: input.text,
      state: "active",
      failed: false,
      assistantId: null,
      assistantText: null,
    };
    turn.state = "active";
    turn.failed = false;
    state.turns.set(input.messageId, turn);

    let userEntry = record.history.find(
      (message) => message.id === input.messageId,
    );
    const markInterrupted = (partial: { id: string; text: string } | null) => {
      turn.state = "interrupted";
      if (!ensureCurrent()) return;
      if (userEntry) userEntry.metadata = { state: "interrupted" };
      if (partial && partial.text.length)
        record.history.push({
          id: partial.id,
          role: "assistant",
          parts: textParts(partial.text),
          metadata: { state: "interrupted" },
        });
    };
    const markFailed = () => {
      turn.state = "interrupted";
      turn.failed = true;
      if (!ensureCurrent()) return;
      if (userEntry) userEntry.metadata = { state: "interrupted" };
    };
    const markCompleted = (assistantId: string, text: string): boolean => {
      if (!ensureCurrent()) {
        turn.state = "interrupted";
        return false;
      }
      if (userEntry) userEntry.metadata = { state: "completed" };
      record.history.push({
        id: assistantId,
        role: "assistant",
        parts: textParts(text),
        metadata: { state: "completed" },
      });
      turn.state = "completed";
      turn.assistantId = assistantId;
      turn.assistantText = text;
      return true;
    };

    if (!userEntry) {
      if (!ensureCurrent()) return chatError("stale_revision");
      userEntry = {
        id: input.messageId,
        role: "user",
        parts: [{ type: "text", text: input.text }],
      };
      record.history.push(userEntry);
    }

    let messages: ModelMessage[];
    try {
      if (!validHistory(record.history)) throw new Error("invalid history");
      const trusted = record.history.filter(
        (message) =>
          message.role === "user" ||
          message.metadata == null ||
          (message.metadata as ChatMetadata).state === "completed",
      );
      messages = [
        ...buildTrustedContext(result, loaded, []),
        ...(await convertToModelMessages(trusted)),
      ];
    } catch {
      markFailed();
      return chatError(
        "unavailable",
        "The conversation record could not be used.",
      );
    }

    const assistantId = generateId();
    let plan: AnswerPlan;
    try {
      const output = await providers.plan({
        messages,
        signal: controller.signal,
      });
      const checked = answerPlanSchema.safeParse(output.plan);
      if (!checked.success || !validatePlanReferences(result, checked.data))
        throw new ProviderError("invalid_output");
      plan = checked.data;
    } catch (e) {
      req.signal.removeEventListener("abort", onAbort);
      if (record.conversationController === controller)
        record.conversationController = null;
      if (controller.signal.aborted) {
        markInterrupted(null);
        return cancelledStream(assistantId);
      }
      markFailed();
      if (e instanceof ProviderError && e.kind === "context_limit")
        return chatError("context_limit");
      return chatError(
        "unavailable",
        "The assistant could not produce a validated answer. Retry the turn.",
      );
    }

    return sseResponse(
      createUIMessageStream<UIMessage>({
        execute: async ({ writer }) => {
          const partId = `${assistantId}-text`;
          let emitted = "";
          try {
            writer.write({
              type: "start",
              messageId: assistantId,
              messageMetadata: { state: "completed" },
            });
            writer.write({ type: "text-start", id: partId });
            const full = render(result, plan, { first: false });
            if (!full.length) throw new Error("empty render");
            for (const piece of splitDeltas(full)) {
              if (controller.signal.aborted) throw new Error("aborted");
              writer.write({ type: "text-delta", id: partId, delta: piece });
              emitted += piece;
              await tick();
            }
            if (controller.signal.aborted) throw new Error("aborted");
            writer.write({ type: "text-end", id: partId });
            if (!markCompleted(assistantId, full)) throw new Error("stale");
            writer.write({
              type: "finish",
              messageMetadata: { state: "completed" },
            });
          } catch {
            if (controller.signal.aborted) {
              markInterrupted(
                emitted.length ? { id: assistantId, text: emitted } : null,
              );
              try {
                writer.write({ type: "abort", reason: "cancelled" });
              } catch {
                /* Consumer is gone. */
              }
            } else {
              markFailed();
              try {
                writer.write({
                  type: "error",
                  errorText:
                    "The response could not be completed. Please retry.",
                });
                writer.write({ type: "abort", reason: "failed" });
              } catch {
                /* Consumer is gone. */
              }
            }
          } finally {
            req.signal.removeEventListener("abort", onAbort);
            if (record.conversationController === controller)
              record.conversationController = null;
          }
        },
        onError: () => "The response could not be completed. Please retry.",
      }),
    );
  }

  return { post };
}
