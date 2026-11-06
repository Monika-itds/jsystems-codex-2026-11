import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { UIMessage } from "ai";
import {
  limits,
  revisionSchema,
  type AssessmentRevision,
  type Intake,
  type Stage,
} from "../contracts";
import type { PreparedImage } from "../images";

export type SessionErrorCode =
  "inaccessible" | "expired" | "stale_revision" | "capacity" | "unavailable";

export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export interface RevisionRecord {
  caseId: string;
  revision: number;
  requestId: string;
  intake: Intake;
  image: PreparedImage;
  assessmentDate: string;
  timeZone: string;
  versions: AssessmentRevision["versions"];
  stage: Stage;
  active: boolean;
  controller: AbortController;
  conversationController: AbortController | null;
  result: AssessmentRevision | null;
  history: UIMessage[];
  interrupted: boolean;
}

interface CaseRecord {
  id: string;
  revisions: RevisionRecord[];
}
interface StoredSession {
  id: string;
  createdAt: number;
  touchedAt: number;
  cases: Map<string, CaseRecord>;
  requests: Map<string, { fingerprint: string; record: RevisionRecord }>;
  expiryTimer?: ReturnType<typeof setTimeout>;
}
export interface BeginRevisionInput {
  caseId?: string;
  expectedRevision?: number;
  requestId: string;
  intake: Intake;
  image: PreparedImage;
  assessmentDate: string;
  timeZone: string;
  versions: AssessmentRevision["versions"];
}

const messages = {
  inaccessible: "Session or case is not available.",
  expired: "Session has expired; start a new case.",
  stale_revision: "The request conflicts with the current revision.",
  capacity: "The session capacity limit has been reached.",
  unavailable: "The session data could not be used.",
} satisfies Record<SessionErrorCode, string>;

function error(code: SessionErrorCode): SessionError {
  return new SessionError(code, messages[code]);
}
function freeze<T>(value: T): T {
  if (
    value &&
    typeof value === "object" &&
    !Buffer.isBuffer(value) &&
    !ArrayBuffer.isView(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function snapshot<T>(value: T): T {
  return freeze(structuredClone(value));
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly expired = new Map<string, number>();
  private imageBytes = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  openSession(existingId?: string): { id: string } {
    this.cleanExpired();
    if (existingId !== undefined)
      return { id: this.requireSession(existingId).id };
    if (this.sessions.size >= limits.sessions) throw error("capacity");
    const now = this.clock();
    const id = randomUUID();
    const session: StoredSession = {
      id,
      createdAt: now,
      touchedAt: now,
      cases: new Map(),
      requests: new Map(),
    };
    this.sessions.set(id, session);
    this.scheduleExpiry(session);
    return { id };
  }

  getSession(id: string): { id: string } {
    return { id: this.requireSession(id).id };
  }

  createCase(sessionId: string): { id: string; revisions: RevisionRecord[] } {
    const session = this.requireSession(sessionId);
    if (session.cases.size >= limits.revisions) throw error("capacity");
    const record = { id: randomUUID(), revisions: [] };
    session.cases.set(record.id, record);
    return { id: record.id, revisions: [] };
  }

  getCase(
    sessionId: string,
    caseId: string,
  ): { id: string; revisions: RevisionRecord[] } {
    const session = this.requireSession(sessionId);
    const record = session.cases.get(caseId);
    if (!record) throw error("inaccessible");
    return { id: record.id, revisions: [...record.revisions] };
  }

  beginRevision(
    sessionId: string,
    input: BeginRevisionInput,
  ): { record: RevisionRecord; reused: boolean } {
    const session = this.requireSession(sessionId);
    if (
      !isUuid(input.requestId) ||
      !Buffer.isBuffer(input.image.bytes) ||
      input.image.byteLength !== input.image.bytes.length ||
      input.image.byteLength <= 0 ||
      input.image.byteLength > limits.imageBytes
    )
      throw error("unavailable");
    const fingerprint = JSON.stringify({
      intake: input.intake,
      imageHash: input.image.hash,
    });
    const previous = session.requests.get(input.requestId);
    if (previous) {
      const targetMatches =
        input.caseId === undefined || input.caseId === previous.record.caseId;
      if (!targetMatches || previous.fingerprint !== fingerprint)
        throw error("stale_revision");
      if (
        session.cases.get(previous.record.caseId)?.revisions.at(-1) !==
        previous.record
      )
        throw error("stale_revision");
      if (previous.record.active) throw error("stale_revision");
      if (previous.record.result)
        return { record: previous.record, reused: true };
      throw error("stale_revision");
    }

    let target: CaseRecord | undefined;
    if (input.caseId !== undefined) {
      target = session.cases.get(input.caseId);
      if (!target) throw error("inaccessible");
      const current = target.revisions.at(-1);
      if (
        input.expectedRevision === undefined ||
        input.expectedRevision !== (current?.revision ?? 0)
      )
        throw error("stale_revision");
      if (current?.active) throw error("stale_revision");
    } else if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== 0
    ) {
      throw error("stale_revision");
    }

    if (
      [...session.cases.values()].some((item) => item.revisions.at(-1)?.active)
    )
      throw error("stale_revision");
    const revisionCount = [...session.cases.values()].reduce(
      (total, item) => total + item.revisions.length,
      0,
    );
    if (
      revisionCount >= limits.revisions ||
      (!target && session.cases.size >= limits.revisions)
    )
      throw error("capacity");
    if (this.imageBytes + input.image.byteLength > limits.globalImageBytes)
      throw error("capacity");

    target?.revisions.at(-1)?.conversationController?.abort();
    if (!target) {
      target = { id: randomUUID(), revisions: [] };
      session.cases.set(target.id, target);
    }
    const record: RevisionRecord = {
      caseId: target.id,
      revision: (target.revisions.at(-1)?.revision ?? 0) + 1,
      requestId: input.requestId,
      intake: snapshot(input.intake),
      image: Object.freeze({
        ...input.image,
        bytes: Buffer.from(input.image.bytes),
        warnings: Object.freeze([
          ...input.image.warnings,
        ]) as unknown as string[],
      }),
      assessmentDate: input.assessmentDate,
      timeZone: input.timeZone,
      versions: snapshot(input.versions),
      stage: "validation",
      active: true,
      controller: new AbortController(),
      conversationController: null,
      result: null,
      history: [],
      interrupted: false,
    };
    target.revisions.push(record);
    session.requests.set(input.requestId, { fingerprint, record });
    this.imageBytes += record.image.byteLength;
    return { record, reused: false };
  }

  getRevision(
    sessionId: string,
    caseId: string,
    revision?: number,
  ): RevisionRecord {
    const record = this.getCaseRecord(
      this.requireSession(sessionId),
      caseId,
    ).revisions;
    const found =
      revision === undefined
        ? record.at(-1)
        : record.find((item) => item.revision === revision);
    if (!found) throw error("inaccessible");
    return found;
  }

  finishRevision(
    sessionId: string,
    caseId: string,
    revision: number,
    result: AssessmentRevision,
  ): void {
    const record = this.getRevision(sessionId, caseId, revision);
    const parsed = revisionSchema.safeParse(result);
    const activeCompletion =
      record.active &&
      !record.interrupted &&
      parsed.success &&
      parsed.data.stage === "completed";
    const interruptedCompletion =
      !record.active &&
      record.interrupted &&
      record.result === null &&
      parsed.success &&
      parsed.data.stage === "interrupted";
    if (
      record !==
        this.getCaseRecord(this.requireSession(sessionId), caseId).revisions.at(
          -1,
        ) ||
      (!activeCompletion && !interruptedCompletion)
    )
      throw error("stale_revision");
    if (
      !parsed.success ||
      parsed.data.caseId !== record.caseId ||
      parsed.data.revision !== record.revision ||
      parsed.data.requestId !== record.requestId ||
      !isDeepStrictEqual(parsed.data.intake, record.intake) ||
      parsed.data.assessmentDate !== record.assessmentDate ||
      parsed.data.timeZone !== record.timeZone ||
      !isDeepStrictEqual(parsed.data.versions, record.versions) ||
      !isDeepStrictEqual(parsed.data.image, this.imageMetadata(record.image))
    )
      throw error("unavailable");
    const saved = snapshot(parsed.data);
    record.result = saved;
    record.stage = saved.stage;
    record.active = false;
    record.interrupted = saved.stage === "interrupted";
    record.history = [snapshot(saved.firstMessage) as UIMessage];
  }

  interruptRevision(sessionId: string, caseId: string, revision: number): void {
    const record = this.getRevision(sessionId, caseId, revision);
    if (!record.active) return;
    record.controller.abort();
    record.active = false;
    record.interrupted = true;
    record.stage = "interrupted";
  }

  deleteCase(sessionId: string, caseId: string): void {
    const session = this.requireSession(sessionId);
    const record = session.cases.get(caseId);
    if (!record) return;
    this.releaseCase(session, record);
    session.cases.delete(caseId);
  }

  clearSession(sessionId: string): void {
    const session = this.requireSession(sessionId);
    clearTimeout(session.expiryTimer);
    for (const record of session.cases.values())
      this.releaseCase(session, record);
    this.sessions.delete(sessionId);
    this.expired.delete(sessionId);
  }

  cleanExpired(): void {
    const now = this.clock();
    for (const [id, session] of this.sessions) {
      if (
        now - session.touchedAt >= limits.idleMs ||
        now - session.createdAt >= limits.absoluteMs
      )
        this.expireSession(id, session, now);
    }
    for (const [id, until] of this.expired)
      if (now >= until) this.expired.delete(id);
  }

  private requireSession(id: string): StoredSession {
    const session = this.sessions.get(id);
    if (!session) {
      if (this.expired.has(id)) throw error("expired");
      throw error("inaccessible");
    }
    const now = this.clock();
    if (
      now - session.touchedAt >= limits.idleMs ||
      now - session.createdAt >= limits.absoluteMs
    ) {
      this.expireSession(id, session, now);
      throw error("expired");
    }
    session.touchedAt = now;
    this.scheduleExpiry(session);
    return session;
  }

  private scheduleExpiry(session: StoredSession): void {
    clearTimeout(session.expiryTimer);
    const remaining = Math.min(
      session.touchedAt + limits.idleMs,
      session.createdAt + limits.absoluteMs,
    ) - this.clock();
    session.expiryTimer = setTimeout(() => {
      if (!this.sessions.has(session.id)) return;
      const now = this.clock();
      if (now - session.touchedAt >= limits.idleMs || now - session.createdAt >= limits.absoluteMs) {
        this.expireSession(session.id, session, now);
      } else {
        this.scheduleExpiry(session);
      }
    }, Math.max(1, remaining));
    session.expiryTimer.unref?.();
  }

  private getCaseRecord(session: StoredSession, caseId: string): CaseRecord {
    const record = session.cases.get(caseId);
    if (!record) throw error("inaccessible");
    return record;
  }

  private imageMetadata(image: PreparedImage) {
    return {
      id: image.id,
      mediaType: image.mediaType,
      width: image.width,
      height: image.height,
      byteLength: image.byteLength,
      hash: image.hash,
      warnings: image.warnings,
    };
  }

  private releaseCase(session: StoredSession, record: CaseRecord): void {
    for (const revision of record.revisions) {
      if (revision.active) revision.controller.abort();
      revision.conversationController?.abort();
      revision.conversationController = null;
      this.imageBytes -= revision.image.byteLength;
      session.requests.delete(revision.requestId);
    }
  }

  private expireSession(id: string, session: StoredSession, now: number): void {
    clearTimeout(session.expiryTimer);
    for (const record of session.cases.values())
      this.releaseCase(session, record);
    this.sessions.delete(id);
    this.expired.set(id, now + limits.absoluteMs);
    while (this.expired.size > limits.sessions)
      this.expired.delete(this.expired.keys().next().value!);
  }
}

export const sessionStore = new SessionStore();
