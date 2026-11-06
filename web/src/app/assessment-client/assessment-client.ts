import { Injectable, signal } from '@angular/core';
import type { AssessmentEvent, AssessmentRevision, Intake, PublicError, Stage } from '../assessment.types';
import { publicErrorFromResponse } from './public-error';

export type AssessmentPhase = 'intake' | 'running' | 'result';

export interface AssessmentSubmission {
  intake: Intake;
  image: File;
}

export const stageLabels: Record<Stage, string> = {
  validation: 'Checking the intake',
  image_preparation: 'Preparing the image',
  observations: 'Reviewing observations',
  detailed_analysis: 'Running detailed analysis',
  policy: 'Applying the fictional policy',
  explanation: 'Writing the explanation',
  completed: 'Completed',
  interrupted: 'Interrupted',
};

/** API client and state for the intake -> assessment -> chat flow. */
@Injectable({ providedIn: 'root' })
export class AssessmentClient {
  readonly phase = signal<AssessmentPhase>('intake');
  readonly stage = signal<Stage | null>(null);
  readonly result = signal<AssessmentRevision | null>(null);
  readonly error = signal<PublicError | null>(null);
  readonly previousResults = signal<AssessmentRevision[]>([]);
  readonly draftEpoch = signal(0);
  readonly clearing = signal(false);

  private attempt = 0;
  private controller: AbortController | null = null;
  private pendingIdentity: { caseId: string; revision: number } | null = null;

  get busy(): boolean {
    return this.phase() === 'running' || this.clearing();
  }

  async startNewCase(): Promise<void> {
    if (this.clearing()) return;
    ++this.attempt;
    this.controller?.abort();
    this.clearing.set(true);
    this.phase.set('intake');
    this.stage.set(null);
    this.error.set(null);
    const caseId = this.pendingIdentity?.caseId ?? this.result()?.caseId;
    try {
      if (caseId) {
        const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404 && response.status !== 410) {
          this.error.set(publicErrorFromResponse(response.status, await safeJson(response)));
          return;
        }
      }
      this.pendingIdentity = null;
      this.result.set(null);
      this.previousResults.set([]);
      this.draftEpoch.update(value => value + 1);
    } catch {
      this.error.set({ code: 'unavailable', message: 'The case could not be cleared. Your draft is still available.' });
    } finally {
      this.clearing.set(false);
    }
  }

  /** Returns to the intake form; the completed result is kept for a reassess revision. */
  editIntake(): void {
    this.error.set(null);
    this.stage.set(null);
    this.phase.set('intake');
  }

  async submit(payload: AssessmentSubmission): Promise<void> {
    if (this.clearing()) return;
    const attempt = ++this.attempt;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.error.set(null);
    this.stage.set('validation');
    this.phase.set('running');

    const current = this.result();
    this.pendingIdentity = current ? { caseId: current.caseId, revision: current.revision + 1 } : null;
    const form = new FormData();
    form.set('caseType', payload.intake.caseType);
    form.set('category', payload.intake.category);
    form.set('model', payload.intake.model);
    form.set('reason', payload.intake.reason);
    form.set('purchaseDate', payload.intake.purchaseDate);
    form.set('image', payload.image);
    form.set('requestId', newRequestId());
    if (current) {
      form.set('caseId', current.caseId);
      form.set('expectedRevision', String(current.revision));
    }

    let response: Response;
    try {
      response = await fetch('/api/assessments', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch {
      if (attempt !== this.attempt) {
        return;
      }
      this.fail({ code: 'unavailable', message: 'The assessment service could not be reached.' });
      if (this.pendingIdentity) await this.resync(this.pendingIdentity.caseId, attempt);
      return;
    }
    if (!response.ok) {
      const body = await safeJson(response);
      if (attempt !== this.attempt) {
        return;
      }
      const failure = publicErrorFromResponse(response.status, body);
      this.fail(failure);
      if (failure.code === 'stale_revision' && current) {
        await this.resync(current.caseId, attempt);
      }
      return;
    }

    let sawResult = false;
    try {
      sawResult = await this.readEvents(response, attempt);
    } catch {
      if (attempt !== this.attempt) {
        return;
      }
      this.fail({ code: 'unavailable', message: 'The assessment stream ended unexpectedly.' });
      if (this.pendingIdentity) await this.resync(this.pendingIdentity.caseId, attempt);
      return;
    }
    if (attempt !== this.attempt) {
      return;
    }
    if (!sawResult) {
      this.fail({ code: 'unavailable', message: 'The assessment ended before a result arrived.' });
      if (this.pendingIdentity) await this.resync(this.pendingIdentity.caseId, attempt);
    }
  }

  /** Reads the POST event stream; returns whether this attempt produced a result. */
  private async readEvents(response: Response, attempt: number): Promise<boolean> {
    const reader = response.body?.getReader();
    if (!reader) {
      return false;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let sawResult = false;
    let lastSequence = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) {
          break;
        }
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('');
        if (!payload) {
          continue;
        }
        let event: AssessmentEvent;
        try {
          event = JSON.parse(payload) as AssessmentEvent;
        } catch {
          continue;
        }
        // Stale-revision isolation: a superseded submission may never update state.
        if (attempt !== this.attempt) {
          continue;
        }
        if (!event || !Number.isSafeInteger(event.sequence) || event.sequence <= lastSequence ||
            typeof event.caseId !== 'string' || !Number.isSafeInteger(event.revision) || event.revision < 1 || sawResult) {
          throw new Error('Invalid assessment event');
        }
        this.pendingIdentity ??= { caseId: event.caseId, revision: event.revision };
        if (event.caseId !== this.pendingIdentity.caseId || event.revision !== this.pendingIdentity.revision) {
          throw new Error('Mismatched assessment event');
        }
        lastSequence = event.sequence;
        if (event.kind === 'progress') {
          if (!(event.stage in stageLabels)) throw new Error('Invalid assessment stage');
          this.stage.set(event.stage);
        } else if (event.kind === 'result') {
          if (!event.result || event.result.caseId !== event.caseId || event.result.revision !== event.revision ||
              !['completed', 'interrupted'].includes(event.result.stage)) throw new Error('Invalid assessment result');
          this.adopt(event.result);
          this.stage.set(null);
          this.phase.set('result');
          sawResult = true;
        } else {
          throw new Error('Unknown assessment event');
        }
      }
    }
    return sawResult && attempt === this.attempt;
  }

  /** Adopts a newer server-owned result after a conflicting reassess. */
  private async resync(caseId: string, attempt: number): Promise<void> {
    try {
      const response = await fetch(`/api/assessments/${caseId}`);
      if (!response.ok) {
        return;
      }
      const snapshot = (await response.json()) as { result?: AssessmentRevision | null };
      if (attempt !== this.attempt) {
        return;
      }
      const current = this.result();
      const found = snapshot.result ?? null;
      if (found && found.caseId === caseId && found.revision >= (this.pendingIdentity?.revision ?? (current ? current.revision + 1 : 1))) {
        this.adopt(found);
        this.error.set(null);
        this.phase.set('result');
      }
    } catch {
      /* Keep the visible error. */
    }
  }

  private adopt(result: AssessmentRevision): void {
    const previous = this.result();
    if (previous && previous.caseId === result.caseId && previous.revision < result.revision) {
      this.previousResults.update(values => [...values, previous]);
    }
    this.result.set(result);
    this.pendingIdentity = { caseId: result.caseId, revision: result.revision };
  }

  private fail(error: PublicError): void {
    this.error.set(error);
    this.stage.set(null);
    this.phase.set('intake');
  }
}

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
