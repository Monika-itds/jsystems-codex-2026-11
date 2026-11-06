import { describe, expect, it, vi } from "vitest";
import {
  limits,
  observationIds,
  type AssessmentRevision,
  type Intake,
} from "../contracts";
import type { PreparedImage } from "../images";
import { SessionError, SessionStore } from "./index";

const intake = (): Intake => ({
  caseType: "return",
  category: "computers_laptops",
  model: "Synthetic laptop",
  purchaseDate: "2026-11-01",
  reason: "",
});
const image = (byteLength = 128): PreparedImage => ({
  id: crypto.randomUUID(),
  mediaType: "image/jpeg",
  width: 40,
  height: 30,
  byteLength,
  hash: "a".repeat(64),
  warnings: ["Single view; subtle detail may be reduced."],
  bytes: Buffer.alloc(byteLength, 7),
});
const versions = {
  questions: "VISUAL-1",
  thresholds: "THRESHOLDS-1",
  preparation: "PREP-1",
  policy: "POLICY-1",
  decisionsModel: "synthetic/decisions",
  visionModel: "synthetic/vision",
  llmModel: "synthetic/chat",
};
const resultFor = (
  record: {
    caseId: string;
    revision: number;
    requestId: string;
    intake: Intake;
    image: PreparedImage;
    assessmentDate: string;
    timeZone: string;
    versions: AssessmentRevision["versions"];
  },
  stage: "completed" | "interrupted" = "completed",
): AssessmentRevision => ({
  caseId: record.caseId,
  revision: record.revision,
  requestId: record.requestId,
  intake: record.intake,
  image: {
    id: record.image.id,
    mediaType: record.image.mediaType,
    width: record.image.width,
    height: record.image.height,
    byteLength: record.image.byteLength,
    hash: record.image.hash,
    warnings: record.image.warnings,
  },
  assessmentDate: record.assessmentDate,
  timeZone: record.timeZone,
  stage,
  versions: { ...record.versions },
  initialObservations: observationIds.map((id) => ({
    id,
    rawProbability: 0.9,
    usableProbability: 0.9,
    label: "present",
    provenance: { source: "decisions" as const, model: "synthetic/decisions" },
    evidence: null,
    limitations: ["Single view"],
  })),
  detailedAnalysis: null,
  providerIdentities: [],
  policy: {
    status: "human_review_required",
    recommendation: null,
    blockers: [
      {
        code: stage === "interrupted" ? "interrupted" : "evidence_unresolved",
        message: "Staff review",
        observationIds: [],
      },
    ],
    nextSteps: ["Staff review the synthetic item."],
    advisory: "Synthetic demonstration.",
  },
  firstMessage: {
    id: `assistant-${record.revision}`,
    role: "assistant",
    parts: [{ type: "text", text: "This synthetic case needs staff review." }],
  },
});
const begin = (
  store: SessionStore,
  sessionId: string,
  options: {
    caseId?: string;
    expectedRevision?: number;
    requestId?: string;
    intake?: Intake;
    image?: PreparedImage;
  } = {},
) =>
  store.beginRevision(sessionId, {
    ...options,
    requestId: options.requestId ?? crypto.randomUUID(),
    intake: options.intake ?? intake(),
    image: options.image ?? image(),
    assessmentDate: "2026-11-06",
    timeZone: "Europe/Warsaw",
    versions,
  });
const finish = (
  store: SessionStore,
  sessionId: string,
  record: ReturnType<SessionStore["beginRevision"]>["record"],
) =>
  store.finishRevision(
    sessionId,
    record.caseId,
    record.revision,
    resultFor(record),
  );

describe("SessionStore", () => {
  it("touches idle TTL but never extends the absolute TTL", () => {
    let now = 0;
    const store = new SessionStore(() => now);
    const { id } = store.openSession();
    now = limits.idleMs - 1;
    expect(store.getSession(id).id).toBe(id);
    now += limits.idleMs - 1;
    expect(store.getSession(id).id).toBe(id);
    now = limits.absoluteMs;
    expect(() => store.getSession(id)).toThrowError(SessionError);
    expect(() => store.openSession(id)).toThrowError(
      expect.objectContaining({ code: "expired" }),
    );
  });

  it("aborts active work when cleanExpired expires a session", () => {
    let now = 0;
    const store = new SessionStore(() => now);
    const session = store.openSession().id;
    const { record } = begin(store, session, { image: image(1024) });
    now = limits.idleMs;
    store.cleanExpired();
    expect(record.controller.signal.aborted).toBe(true);
    expect((store as unknown as { imageBytes: number }).imageBytes).toBe(0);
    expect(() => store.getSession(session)).toThrowError(
      expect.objectContaining({ code: "expired" }),
    );
  });

  it("does not evict sessions at capacity and keeps session-owned cases inaccessible across sessions", () => {
    const store = new SessionStore();
    const sessions = Array.from(
      { length: limits.sessions },
      () => store.openSession().id,
    );
    const firstCase = store.createCase(sessions[0]);
    expect(() => store.openSession()).toThrowError(
      expect.objectContaining({ code: "capacity" }),
    );
    expect(() => store.getCase(sessions[1], firstCase.id)).toThrowError(
      expect.objectContaining({ code: "inaccessible" }),
    );
    expect(store.getCase(sessions[0], firstCase.id).id).toBe(firstCase.id);
  });

  it("snapshots intake and image input, enforces request idempotency, and rejects stale revisions", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const draft = intake();
    const prepared = image();
    const requestId = crypto.randomUUID();
    const first = begin(store, session, {
      intake: draft,
      image: prepared,
      requestId,
    });
    draft.model = "mutated after submission";
    prepared.bytes.fill(0);
    expect(first.record.intake.model).toBe("Synthetic laptop");
    expect(first.record.image.bytes[0]).toBe(7);
    expect(() =>
      begin(store, session, { requestId, intake: intake(), image: image() }),
    ).toThrowError(expect.objectContaining({ code: "stale_revision" }));
    finish(store, session, first.record);
    const repeated = begin(store, session, {
      requestId,
      intake: intake(),
      image: image(),
    });
    expect(repeated).toMatchObject({
      reused: true,
      record: { caseId: first.record.caseId, revision: 1 },
    });
    expect(() =>
      begin(store, session, {
        caseId: first.record.caseId,
        expectedRevision: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "stale_revision" }));
    const second = begin(store, session, {
      caseId: first.record.caseId,
      expectedRevision: 1,
    });
    expect(second.record.revision).toBe(2);
    finish(store, session, second.record);
    expect(() =>
      begin(store, session, { requestId, intake: intake(), image: image() }),
    ).toThrowError(expect.objectContaining({ code: "stale_revision" }));
  });

  it("freezes cloned result snapshots and seeds chat from the trusted first message", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session);
    const result = resultFor(record);
    store.finishRevision(session, record.caseId, record.revision, result);
    result.policy.nextSteps[0] = "Mutated caller-owned value";
    const saved = store.getRevision(session, record.caseId);
    expect(saved.result?.policy.nextSteps[0]).toBe(
      "Staff review the synthetic item.",
    );
    expect(saved.history).toEqual(
      saved.result?.firstMessage ? [saved.result.firstMessage] : [],
    );
    expect(Object.isFrozen(saved.result?.policy.nextSteps)).toBe(true);
    expect(saved.active).toBe(false);
  });

  it("rejects schema-valid results that substitute captured revision context", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session);
    const substituted = structuredClone(resultFor(record));
    substituted.intake.model = "Different synthetic item";
    substituted.image.width = 1;
    substituted.versions.policy = "different-policy";
    expect(() =>
      store.finishRevision(
        session,
        record.caseId,
        record.revision,
        substituted,
      ),
    ).toThrowError(expect.objectContaining({ code: "unavailable" }));
    expect(record).toMatchObject({
      active: true,
      result: null,
      stage: "validation",
    });
  });

  it("ignores a late disconnect after a completed revision", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session);
    finish(store, session, record);
    const signal = record.controller.signal;
    store.interruptRevision(session, record.caseId, record.revision);
    expect(signal.aborted).toBe(false);
    expect(record).toMatchObject({
      stage: "completed",
      active: false,
      interrupted: false,
    });
    expect(record.result?.stage).toBe("completed");
  });

  it("aborts interrupted and deleted work, releases bytes on deletion, and treats missing case deletion as idempotent", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session, { image: image(1024) });
    const signal = record.controller.signal;
    store.interruptRevision(session, record.caseId, record.revision);
    expect(signal.aborted).toBe(true);
    expect(record).toMatchObject({
      active: false,
      interrupted: true,
      stage: "interrupted",
    });
    store.deleteCase(session, record.caseId);
    expect(() => store.getCase(session, record.caseId)).toThrowError(
      expect.objectContaining({ code: "inaccessible" }),
    );
    expect(() => store.deleteCase(session, crypto.randomUUID())).not.toThrow();
    expect(() =>
      store.beginRevision(session, {
        requestId: crypto.randomUUID(),
        intake: intake(),
        image: image(limits.imageBytes),
        assessmentDate: "2026-11-06",
        timeZone: "Europe/Warsaw",
        versions,
      }),
    ).not.toThrow();
  });

  it("stores a validated review snapshot after interruption without completing or replacing other results", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session);
    store.interruptRevision(session, record.caseId, record.revision);
    store.finishRevision(
      session,
      record.caseId,
      record.revision,
      resultFor(record, "interrupted"),
    );
    const saved = store.getRevision(session, record.caseId);
    expect(saved.result?.stage).toBe("interrupted");
    expect(saved.result?.policy.blockers[0]?.code).toBe("interrupted");
    expect(saved.stage).toBe("interrupted");
    expect(saved.active).toBe(false);
    expect(saved.history).toHaveLength(1);
    expect(() =>
      store.finishRevision(
        session,
        record.caseId,
        record.revision,
        resultFor(record),
      ),
    ).toThrowError(expect.objectContaining({ code: "stale_revision" }));
  });

  it("enforces the session-wide revision and global retained-image limits without partial mutation", () => {
    const store = new SessionStore();
    const sessions = Array.from({ length: 3 }, () => store.openSession().id);
    for (const session of sessions.slice(0, 2)) {
      for (let i = 0; i < limits.revisions; i++) {
        const { record } = begin(store, session, {
          image: image(limits.imageBytes),
        });
        finish(store, session, record);
      }
    }
    for (let i = 0; i < 5; i++) {
      const { record } = begin(store, sessions[2], {
        image: image(limits.imageBytes),
      });
      finish(store, sessions[2], record);
    }
    const before = store.createCase(sessions[2]).id;
    expect(() =>
      begin(store, sessions[2], {
        caseId: before,
        expectedRevision: 0,
        image: image(limits.imageBytes),
      }),
    ).toThrowError(expect.objectContaining({ code: "capacity" }));
    expect(store.getCase(sessions[2], before).revisions).toHaveLength(0);
  });

  it("limits revisions across all cases in one session", () => {
    const store = new SessionStore();
    const session = store.openSession().id;
    let caseId: string | undefined;
    let expectedRevision = 0;
    for (let i = 0; i < limits.revisions; i++) {
      const { record } = begin(store, session, {
        ...(caseId ? { caseId, expectedRevision } : {}),
      });
      caseId = record.caseId;
      expectedRevision = record.revision;
      finish(store, session, record);
    }
    const otherCase = store.createCase(session).id;
    expect(() =>
      begin(store, session, { caseId: otherCase, expectedRevision: 0 }),
    ).toThrowError(expect.objectContaining({ code: "capacity" }));
    expect(store.getCase(session, otherCase).revisions).toHaveLength(0);
  });
});

it("compares captured facts structurally regardless of property insertion order", () => {
  const store = new SessionStore();
  const session = store.openSession().id;
  const reorderedIntake = Object.fromEntries(
    Object.entries(intake()).reverse(),
  ) as unknown as Intake;
  const reorderedVersions = Object.fromEntries(
    Object.entries(versions).reverse(),
  ) as unknown as AssessmentRevision["versions"];
  const { record } = store.beginRevision(session, {
    requestId: crypto.randomUUID(),
    intake: reorderedIntake,
    image: image(),
    assessmentDate: "2026-11-06",
    timeZone: "Europe/Warsaw",
    versions: reorderedVersions,
  });
  expect(() => finish(store, session, record)).not.toThrow();
});

it('expires and releases idle evidence without another request, aborting a pending conversation', () => {
  vi.useFakeTimers();
  try {
    const store = new SessionStore();
    const session = store.openSession().id;
    const { record } = begin(store, session);
    finish(store, session, record);
    const conversation = new AbortController();
    record.conversationController = conversation;
    vi.advanceTimersByTime(limits.idleMs);
    expect(conversation.signal.aborted).toBe(true);
    expect((store as unknown as { imageBytes: number }).imageBytes).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('aborts an existing conversation on reassessment and deletion', () => {
  const store = new SessionStore();
  const session = store.openSession().id;
  const { record } = begin(store, session);
  finish(store, session, record);
  const conversation = new AbortController();
  record.conversationController = conversation;
  const next = begin(store, session, { caseId: record.caseId, expectedRevision: 1 }).record;
  expect(conversation.signal.aborted).toBe(true);
  finish(store, session, next);
  const second = new AbortController();
  next.conversationController = second;
  store.deleteCase(session, next.caseId);
  expect(second.signal.aborted).toBe(true);
});
