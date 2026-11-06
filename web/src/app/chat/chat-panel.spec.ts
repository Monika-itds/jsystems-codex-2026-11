import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AssessmentRevision, DetailedAnalysis, Observation, PolicyResult } from '../assessment.types';
import { ChatPanel } from './chat-panel';

const observations: Observation[] = [
  { id: 'image_usable', rawProbability: 0.9, usableProbability: 0.9, label: 'present', provenance: { source: 'decisions', model: 'synthetic/decision' }, evidence: null, limitations: ['Single image view.'] },
  { id: 'item_consistent', rawProbability: 0.85, usableProbability: 0.85, label: 'present', provenance: { source: 'decisions', model: 'synthetic/decision' }, evidence: null, limitations: ['This does not authenticate a model.'] },
  { id: 'crack_visible', rawProbability: 0.15, usableProbability: 0.15, label: 'absent', provenance: { source: 'decisions', model: 'synthetic/decision' }, evidence: null, limitations: ['No crack observed in this view.'] },
  { id: 'dent_visible', rawProbability: 0.5, usableProbability: 0.5, label: 'uncertain', provenance: { source: 'decisions', model: 'synthetic/decision' }, evidence: null, limitations: ['Image detail is insufficient.'] },
  { id: 'scratch_visible', rawProbability: 0.1, usableProbability: null, label: 'not_assessable', provenance: { source: 'decisions', model: 'synthetic/decision' }, evidence: null, limitations: ['Image usability prerequisite was not clear.'] },
];
const detailedAnalysis: DetailedAnalysis = {
  findings: [{ id: 'dent_visible', label: 'present', evidence: 'A shallow dent is visible beside the synthetic hinge.', limitations: ['One viewing angle.'] }],
  conflicts: true,
  unsupportedConditions: ['Reported intermittent power loss requires service judgment.'],
  limitations: ['The image cannot verify internal function.'],
};
const review: PolicyResult = {
  status: 'human_review_required', recommendation: null,
  blockers: [{ code: 'conflicting_evidence', message: 'Detailed analysis conflicts with initial dent evidence.', observationIds: ['dent_visible'] }],
  nextSteps: ['Have staff resolve the conflicting visual findings.'],
  advisory: 'Synthetic demo only. Staff make the final decision.',
};
const result = (overrides: Partial<AssessmentRevision> = {}): AssessmentRevision => ({
  caseId: '00000000-0000-4000-8000-000000000001', revision: 1, requestId: '00000000-0000-4000-8000-000000000002',
  assessmentDate: '2026-11-06', timeZone: 'Europe/Warsaw',
  intake: { caseType: 'return', category: 'computers_laptops', model: 'Synthetic laptop', reason: 'Synthetic hinge damage', purchaseDate: '2026-11-01' },
  image: { id: '00000000-0000-4000-8000-000000000003', mediaType: 'image/jpeg', width: 800, height: 600, byteLength: 2000, hash: 'a'.repeat(64), warnings: [] },
  stage: 'completed', versions: { questions: 'VISUAL-1', thresholds: 'THRESHOLDS-1', preparation: 'PREP-1', policy: 'DEMO-RETURN-1.0', decisionsModel: 'synthetic/decision', visionModel: 'synthetic/vision', llmModel: 'synthetic/chat' },
  initialObservations: observations, detailedAnalysis, providerIdentities: [], policy: review,
  firstMessage: { id: 'first', role: 'assistant', parts: [{ type: 'text', text: 'Synthetic explanation.' }] },
  ...overrides,
});

interface FakeStream {
  response: Response;
  push: (chunk: unknown) => void;
  close: () => void;
  cancelled: () => boolean;
}

function fakeSseStream(): FakeStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = false;
  const fake: FakeStream = {
    cancelled: () => cancelled,
    push: (chunk) => {
      try {
        controller?.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      } catch {
        /* Cancelled streams reject late chunks; that is the stale path. */
      }
    },
    close: () => {
      try {
        controller?.close();
      } catch {
        /* Already closed or cancelled. */
      }
    },
    response: undefined as unknown as Response,
  };
  fake.response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return fake;
}

interface Call {
  init: RequestInit | undefined;
}

async function settleFixture(fixture: ComponentFixture<ChatPanel>, times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

async function render(value: AssessmentRevision): Promise<ComponentFixture<ChatPanel>> {
  await TestBed.configureTestingModule({ imports: [ChatPanel] }).compileComponents();
  const fixture = TestBed.createComponent(ChatPanel);
  fixture.componentRef.setInput('result', value);
  fixture.detectChanges();
  await settleFixture(fixture);
  return fixture;
}

function buttonWith(element: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

describe('ChatPanel', () => {
  it('creates one chat per revision and disposes the previous one', async () => {
    const calls: Call[] = [];
    const streams: FakeStream[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init });
      const stream = fakeSseStream();
      streams.push(stream);
      return stream.response;
    }));
    const fixture = await render(result({ revision: 1 }));
    const component = fixture.componentInstance;

    component.draft.setValue('question one');
    component.send();
    await settleFixture(fixture);
    expect(calls.length).toBe(1);

    fixture.componentRef.setInput('result', result({
      revision: 2,
      firstMessage: { id: 'first-2', role: 'assistant', parts: [{ type: 'text', text: 'Second explanation.' }] },
    }));
    await settleFixture(fixture);

    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(streams[0].cancelled()).toBe(true);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Second explanation.');
    expect(text).not.toContain('question one');

    streams[0].push({ type: 'text-delta', id: 'p1', delta: 'Stale reply' });
    streams[0].close();
    await settleFixture(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('Stale reply');
  });

  it('renders plain text only and shows a Stop control while streaming', async () => {
    const calls: Call[] = [];
    const streams: FakeStream[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init });
      const stream = fakeSseStream();
      streams.push(stream);
      return stream.response;
    }));
    const fixture = await render(result({ revision: 1 }));
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.draft.setValue('look <img src="x"> at this');
    fixture.componentInstance.send();
    await settleFixture(fixture);
    streams[0].push({ type: 'start', messageId: 'a1' });
    streams[0].push({ type: 'text-start', id: 'p1' });
    streams[0].push({ type: 'text-delta', id: 'p1', delta: 'Plain reply' });
    await settleFixture(fixture);

    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('look <img src="x"> at this');
    expect(element.textContent).toContain('Plain reply');
    expect(element.textContent).toContain('writing the reply');
    expect(buttonWith(element, 'Stop')).toBeTruthy();

    buttonWith(element, 'Stop')?.click();
    await settleFixture(fixture);
    expect(buttonWith(element, 'Retry the last question')).toBeTruthy();
  });

  it('retry after an interrupted turn reuses the user message id and text', async () => {
    const calls: Call[] = [];
    const streams: FakeStream[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ init });
      const stream = fakeSseStream();
      streams.push(stream);
      return stream.response;
    }));
    const fixture = await render(result({ revision: 1 }));
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.draft.setValue('question one');
    fixture.componentInstance.send();
    await settleFixture(fixture);
    streams[0].push({ type: 'start', messageId: 'a1' });
    streams[0].push({ type: 'text-start', id: 'p1' });
    streams[0].push({ type: 'text-delta', id: 'p1', delta: 'partial' });
    await settleFixture(fixture);

    fixture.componentInstance.stop();
    await settleFixture(fixture);
    buttonWith(element, 'Retry the last question')?.click();
    await settleFixture(fixture);
    streams[1].push({ type: 'start', messageId: 'a2' });
    streams[1].push({ type: 'text-start', id: 'p2' });
    streams[1].push({ type: 'text-delta', id: 'p2', delta: 'complete answer' });
    streams[1].push({ type: 'text-end', id: 'p2' });
    streams[1].push({ type: 'finish', messageMetadata: { state: 'completed' } });
    streams[1].close();
    await settleFixture(fixture);

    expect(calls.length).toBe(2);
    const firstBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    const secondBody = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    expect(secondBody['messageId']).toBe(firstBody['messageId']);
    expect(secondBody['text']).toBe('question one');
    expect(element.querySelectorAll('[data-role="user"]').length).toBe(1);
    expect(element.textContent).toContain('complete answer');
  });
});
