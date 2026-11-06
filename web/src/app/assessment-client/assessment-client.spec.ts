import { TestBed } from '@angular/core/testing';
import type { AssessmentRevision, DetailedAnalysis, Observation, PolicyResult, PublicError } from '../assessment.types';
import { AssessmentClient } from './assessment-client';

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

const CASE_ID = '00000000-0000-4000-8000-000000000001';

const INTAKE = {
  caseType: 'return' as const,
  category: 'computers_laptops' as const,
  model: 'Synthetic laptop',
  reason: 'Synthetic hinge damage',
  purchaseDate: '2026-11-01',
};

function makeFile(): File {
  return new File([new Uint8Array(4096)], 'synthetic-equipment.png', { type: 'image/png' });
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createClient(): AssessmentClient {
  TestBed.configureTestingModule({});
  return TestBed.inject(AssessmentClient);
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

describe('AssessmentClient', () => {
  it('posts the intake and one image as multipart with a fresh requestId and no case envelope on a first submission', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return sseResponse([{ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result() }]);
    }));
    const client = createClient();
    const image = makeFile();

    await client.submit({ intake: INTAKE, image });
    await settle();

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/assessments');
    expect(calls[0].init?.method).toBe('POST');
    const form = calls[0].init?.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect([...form.keys()].sort()).toEqual(
      ['caseType', 'category', 'image', 'model', 'purchaseDate', 'reason', 'requestId'],
    );
    expect(form.get('model')).toBe('Synthetic laptop');
    expect(form.get('purchaseDate')).toBe('2026-11-01');
    expect(form.get('image')).toBe(image);
    expect(String(form.get('requestId'))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('updates the visible stage from progress events and stores the completed result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      { kind: 'progress', sequence: 1, caseId: CASE_ID, revision: 1, stage: 'observations' },
      { kind: 'progress', sequence: 2, caseId: CASE_ID, revision: 1, stage: 'explanation' },
      { kind: 'result', sequence: 3, caseId: CASE_ID, revision: 1, result: result() },
    ])));
    const client = createClient();
    expect(client.stage()).toBeNull();

    await client.submit({ intake: INTAKE, image: makeFile() });
    await settle();

    expect(client.stage()).toBeNull();
    expect(client.phase()).toBe('result');
    expect(client.result()?.revision).toBe(1);
    expect(client.result()?.firstMessage.parts[0].text).toBe('Synthetic explanation.');
  });

  it('shows each progress stage while the run is still streaming', async () => {
    const holder: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null };
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          holder.controller = streamController;
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));
    const client = createClient();
    const done = client.submit({ intake: INTAKE, image: makeFile() });
    await settle();

    holder.controller?.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'progress', sequence: 1, caseId: CASE_ID, revision: 1, stage: 'observations' })}\n\n`));
    await settle();
    expect(client.phase()).toBe('running');
    expect(client.stage()).toBe('observations');

    holder.controller?.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'result', sequence: 2, caseId: CASE_ID, revision: 1, result: result() })}\n\n`));
    holder.controller?.close();
    await done;
    await settle();
    expect(client.phase()).toBe('result');
    expect(client.result()?.caseId).toBe(CASE_ID);
  });

  it('starts a new revision on reassess with caseId and expectedRevision and never mutates the old result', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const first = calls.length === 1;
      return sseResponse([{
        kind: 'result',
        sequence: 1,
        caseId: CASE_ID,
        revision: first ? 1 : 2,
        result: result({ revision: first ? 1 : 2, firstMessage: { id: 'first', role: 'assistant', parts: [{ type: 'text', text: first ? 'Synthetic explanation.' : 'Second explanation.' }] } }),
      }]);
    }));
    const client = createClient();
    const first = result();
    await client.submit({ intake: INTAKE, image: makeFile() });
    await settle();
    expect(client.result()).toEqual(first);

    client.editIntake();
    expect(client.phase()).toBe('intake');

    await client.submit({ intake: { ...INTAKE, model: 'Synthetic laptop v2' }, image: makeFile() });
    await settle();

    expect(calls.length).toBe(2);
    const form = calls[1].init?.body as FormData;
    expect(form.get('caseId')).toBe(CASE_ID);
    expect(form.get('expectedRevision')).toBe('1');
    expect(client.result()?.revision).toBe(2);
    expect(client.result()?.firstMessage.parts[0].text).toBe('Second explanation.');
    expect(first.revision).toBe(1);
    expect(first.firstMessage.parts[0].text).toBe('Synthetic explanation.');
  });

  it('ignores stale events from a superseded submission', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const encoder = new TextEncoder();
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(streamController) {
            streams.push(streamController);
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }));
    const client = createClient();
    const first = client.submit({ intake: INTAKE, image: makeFile() });
    expect(call).toBe(1);
    const second = client.submit({ intake: { ...INTAKE, model: 'Newest model' }, image: makeFile() });
    expect(call).toBe(2);

    streams[1].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result({ intake: { ...INTAKE, model: 'Newest model' } }) })}\n\n`));
    streams[1].close();
    await second;
    await settle();

    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'progress', sequence: 2, caseId: CASE_ID, revision: 1, stage: 'policy' })}\n\n`));
    streams[0].enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'result', sequence: 3, caseId: CASE_ID, revision: 1, result: result({ intake: { ...INTAKE, model: 'Stale model' } }) })}\n\n`));
    streams[0].close();
    await first;
    await settle();

    expect(client.result()?.intake.model).toBe('Newest model');
    expect(client.stage()).toBeNull();
    expect(client.phase()).toBe('result');
  });

  it('maps every documented public error code to a visible message', async () => {
    const cases: Array<{ code: PublicError['code']; status: number }> = [
      { code: 'validation', status: 422 },
      { code: 'capacity', status: 413 },
      { code: 'stale_revision', status: 409 },
      { code: 'inaccessible', status: 404 },
      { code: 'expired', status: 410 },
      { code: 'origin', status: 403 },
      { code: 'context_limit', status: 413 },
      { code: 'unavailable', status: 503 },
    ];
    for (const testCase of cases) {
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ code: testCase.code, message: `server text for ${testCase.code}` }),
        { status: testCase.status, headers: { 'content-type': 'application/json' } },
      )));
      const client = createClient();
      await client.submit({ intake: INTAKE, image: makeFile() });
      await settle();

      expect(client.error(), `error state for ${testCase.code}`).not.toBeNull();
      expect(client.error()?.code, `code for ${testCase.code}`).toBe(testCase.code);
      expect(client.error()?.message, `message for ${testCase.code}`).toContain(testCase.code);
      expect(client.phase(), `phase for ${testCase.code}`).toBe('intake');
      TestBed.resetTestingModule();
    }
  });

  it('falls back to documented text when an error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'expired' }), {
      status: 410,
      headers: { 'content-type': 'application/json' },
    })));
    const client = createClient();
    await client.submit({ intake: INTAKE, image: makeFile() });
    await settle();

    expect(client.error()?.code).toBe('expired');
    expect(client.error()?.message).toContain('Session has expired');
  });

  it('recovers the current revision from the case snapshot when a reassess conflicts', async () => {
    const newer = result({ revision: 2, firstMessage: { id: 'first', role: 'assistant', parts: [{ type: 'text', text: 'Recovered explanation.' }] } });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === '/api/assessments' && init?.method === 'POST') {
        const form = init.body as FormData;
        if (form.get('caseId') === null) {
          return sseResponse([{ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result() }]);
        }
        return new Response(JSON.stringify({ code: 'stale_revision', message: 'The request conflicts with the current revision.' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target === `/api/assessments/${CASE_ID}`) {
        return new Response(JSON.stringify({ caseId: CASE_ID, revision: 2, stage: 'completed', interrupted: false, result: newer }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }));
    const client = createClient();
    await client.submit({ intake: INTAKE, image: makeFile() });
    await settle();
    expect(client.result()?.revision).toBe(1);

    await client.submit({ intake: { ...INTAKE, model: 'Edited model' }, image: makeFile() });
    await settle();

    expect(client.result()?.revision).toBe(2);
    expect(client.result()?.firstMessage.parts[0].text).toBe('Recovered explanation.');
    expect(client.error()).toBeNull();
    expect(client.phase()).toBe('result');
  });
});

it('clears the server case and in-memory draft/results when starting a new case', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : sseResponse([{ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result() }]));
  vi.stubGlobal('fetch', fetcher);
  const client = createClient();
  await client.submit({ intake: INTAKE, image: makeFile() });
  await client.startNewCase();
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/cases/${CASE_ID}`);
  expect(client.result()).toBeNull();
  expect(client.previousResults()).toEqual([]);
  expect(client.draftEpoch()).toBe(1);
  expect(client.phase()).toBe('intake');
});
it('retains the current draft/result when clearing the server case fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE' ? new Response('{}', { status: 503 }) : sseResponse([{ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result() }])));
  const client = createClient();
  await client.submit({ intake: INTAKE, image: makeFile() });
  await client.startNewCase();
  expect(client.result()?.caseId).toBe(CASE_ID);
  expect(client.draftEpoch()).toBe(0);
  expect(client.error()?.code).toBe('unavailable');
});
it('rejects a terminal event that does not match the current stream revision', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
    { kind: 'progress', sequence: 1, caseId: CASE_ID, revision: 1, stage: 'observations' },
    { kind: 'result', sequence: 2, caseId: CASE_ID, revision: 2, result: result() },
  ])));
  const client = createClient();
  await client.submit({ intake: INTAKE, image: makeFile() });
  expect(client.result()).toBeNull();
  expect(client.error()).not.toBeNull();
});
it('reconciles an interrupted request using the session-bound server snapshot', async () => {
  const encoder = new TextEncoder();
  let first = true;
  const interrupted = result({ stage: 'interrupted' });
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) !== '/api/assessments') return Response.json({ caseId: CASE_ID, revision: 1, stage: 'interrupted', result: interrupted });
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (first) { first = false; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'progress', sequence: 1, caseId: CASE_ID, revision: 1, stage: 'observations' })}\n\n`)); }
      else controller.error(new Error('Synthetic disconnect'));
    } }));
  }));
  const client = createClient();
  await client.submit({ intake: INTAKE, image: makeFile() });
  expect(client.result()?.stage).toBe('interrupted');
  expect(client.phase()).toBe('result');
});
