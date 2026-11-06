import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { App } from './app';
import { IntakeForm } from './intake/intake-form';
import type { AssessmentRevision, DetailedAnalysis, Intake, Observation, PolicyResult } from './assessment.types';

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

const VALID_INTAKE: Intake = {
  caseType: 'return',
  category: 'computers_laptops',
  model: 'Synthetic laptop',
  reason: 'Synthetic hinge damage',
  purchaseDate: '2026-02-10',
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

interface FakeStream {
  response: Response;
  push: (chunk: unknown) => void;
  close: () => void;
}

function fakeSseStream(): FakeStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const fake: FakeStream = {
    push: (chunk) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    close: () => controller?.close(),
    response: undefined as unknown as Response,
  };
  fake.response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return fake;
}

async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<void> }, times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  fixture.detectChanges();
}

function intakeComponent(fixture: ComponentFixture<App>): IntakeForm {
  const found = fixture.debugElement.query(By.directive(IntakeForm));
  if (!found) {
    throw new Error('Expected the intake form to be mounted');
  }
  return found.componentInstance;
}

function applyIntake(component: IntakeForm, intake: Intake): void {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(intake.purchaseDate);
  component.form.setValue({
    caseType: intake.caseType,
    category: intake.category,
    model: intake.model,
    reason: intake.reason,
    purchaseDate: parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null,
  });
}

function selectImage(element: HTMLElement): void {
  const input = element.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('Expected the intake form image input to be mounted');
  }
  const file = new File([new Uint8Array(4096)], 'synthetic-equipment.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickSubmit(element: HTMLElement): void {
  const form = element.querySelector<HTMLElement>('app-intake-form');
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) {
    throw new Error('Expected the intake form submit button to be mounted');
  }
  button.click();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Synthetic staff workspace', () => {
  it('keeps synthetic-data and staff-decision limitations visible', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Synthetic cases only');
    expect(fixture.nativeElement.textContent).toContain('Staff make every final decision');
  });

  it('runs intake into visible progress, the completed result and revision-bound chat', async () => {
    const calls: Call[] = [];
    const assessment = fakeSseStream();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/assessments') {
        return assessment.response;
      }
      return new Response('not found', { status: 404 });
    }));
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const element = fixture.nativeElement as HTMLElement;
    await settle(fixture);

    applyIntake(intakeComponent(fixture), VALID_INTAKE);
    selectImage(element);
    await settle(fixture);
    clickSubmit(element);
    await settle(fixture);

    assessment.push({ kind: 'progress', sequence: 1, caseId: CASE_ID, revision: 1, stage: 'observations' });
    await settle(fixture);
    expect(element.textContent).toContain('Assessment stage: Reviewing observations');

    assessment.push({ kind: 'result', sequence: 2, caseId: CASE_ID, revision: 1, result: result() });
    assessment.close();
    await settle(fixture);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/assessments');
    expect(element.textContent).toContain('Synthetic cases only');
    expect(element.textContent).toContain('Human review required');
    expect(element.textContent).toContain('Synthetic explanation.');
    expect(element.textContent).toContain('Ask about this assessment');
    const form = calls[0].init?.body as FormData;
    expect(form.get('requestId')).toBeTruthy();
    expect(form.get('caseId')).toBeNull();
  });

  it('edits the intake and starts a new revision through the assessment endpoint', async () => {
    const calls: Call[] = [];
    const assessments = [fakeSseStream(), fakeSseStream()];
    let assessmentCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/assessments') {
        assessmentCalls += 1;
        return assessments[assessmentCalls - 1].response;
      }
      return new Response('not found', { status: 404 });
    }));
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const element = fixture.nativeElement as HTMLElement;
    await settle(fixture);

    applyIntake(intakeComponent(fixture), VALID_INTAKE);
    selectImage(element);
    await settle(fixture);
    clickSubmit(element);
    await settle(fixture);
    assessments[0].push({ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 1, result: result() });
    assessments[0].close();
    await settle(fixture);
    expect(element.textContent).toContain('Synthetic explanation.');

    const edit = [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Edit intake and reassess'));
    expect(edit).toBeTruthy();
    edit?.click();
    await settle(fixture);
    const intakeForm = element.querySelector<HTMLElement>('app-intake-form');
    expect(intakeForm?.hasAttribute('hidden')).toBe(false);

    clickSubmit(element);
    await settle(fixture);
    assessments[1].push({ kind: 'result', sequence: 1, caseId: CASE_ID, revision: 2, result: result({
      revision: 2,
      firstMessage: { id: 'first-2', role: 'assistant', parts: [{ type: 'text', text: 'Second explanation.' }] },
    }) });
    assessments[1].close();
    await settle(fixture);

    expect(assessmentCalls).toBe(2);
    const form = calls[1].init?.body as FormData;
    expect(form.get('caseId')).toBe(CASE_ID);
    expect(form.get('expectedRevision')).toBe('1');
    expect(element.textContent).toContain('Second explanation.');
    expect(element.textContent).toContain('Superseded revision 1');
    expect(element.querySelectorAll('app-assessment-view').length).toBe(2);
    const ids = [...element.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

it('starts a clean case, deleting server evidence and destroying the previous draft preview', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  const fixture = TestBed.createComponent(App);
  await settle(fixture);
  const before = intakeComponent(fixture);
  applyIntake(before, VALID_INTAKE);
  fixture.componentInstance.client.result.set(result());
  fixture.componentInstance.client.phase.set('result');
  await settle(fixture);
  const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(item => item.textContent?.includes('Start new case'));
  expect(button).toBeTruthy();
  button?.click();
  await settle(fixture);
  expect(intakeComponent(fixture)).not.toBe(before);
  expect(intakeComponent(fixture).form.controls.model.value).toBe('');
  expect(fixture.componentInstance.client.result()).toBeNull();
  expect(fixture.nativeElement.querySelector('app-chat-panel')).toBeNull();
});
