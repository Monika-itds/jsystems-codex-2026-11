import { TestBed } from '@angular/core/testing';
import { AssessmentView } from './assessment-view';
import type { AssessmentRevision, DetailedAnalysis, Observation, PolicyResult } from '../assessment.types';

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
  blockers: [
    { code: 'conflicting_evidence', message: 'Detailed analysis conflicts with initial dent evidence.', observationIds: ['dent_visible'] },
    { code: 'unsupported_condition', message: 'Reported power loss needs service judgment.', observationIds: [] },
  ],
  nextSteps: ['Have staff resolve the conflicting visual findings.', 'Have staff assess the reported fault.'],
  advisory: 'Synthetic demo only. Staff make the final decision.',
};
const result = (overrides: Partial<AssessmentRevision> = {}): AssessmentRevision => ({
  caseId: '00000000-0000-4000-8000-000000000001', revision: 2, requestId: '00000000-0000-4000-8000-000000000002',
  assessmentDate: '2026-11-06', timeZone: 'Europe/Warsaw',
  intake: { caseType: 'return', category: 'computers_laptops', model: 'Synthetic laptop', reason: 'Synthetic hinge damage', purchaseDate: '2026-11-01' },
  image: { id: '00000000-0000-4000-8000-000000000003', mediaType: 'image/jpeg', width: 800, height: 600, byteLength: 2000, hash: 'a'.repeat(64), warnings: ['Small image; fine detail may be limited.'] },
  stage: 'completed', versions: { questions: 'VISUAL-1', thresholds: 'THRESHOLDS-1', preparation: 'PREP-1', policy: 'DEMO-RETURN-1.0', decisionsModel: 'synthetic/decision', visionModel: 'synthetic/vision', llmModel: 'synthetic/chat' },
  initialObservations: observations, detailedAnalysis, providerIdentities: [], policy: review,
  firstMessage: { id: 'first', role: 'assistant', parts: [{ type: 'text', text: 'Synthetic explanation.' }] },
  ...overrides,
});

async function render(value: AssessmentRevision, superseded = false) {
  await TestBed.configureTestingModule({ imports: [AssessmentView] }).compileComponents();
  const fixture = TestBed.createComponent(AssessmentView);
  fixture.componentRef.setInput('result', value);
  fixture.componentRef.setInput('superseded', superseded);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('assessment evidence view', () => {
  it('keeps review status, every blocker and next step visible outside chat', async () => {
    const fixture = await render(result());
    const page = fixture.nativeElement.textContent as string;
    expect(page).toContain('Human review required');
    expect(page).toContain('Detailed analysis conflicts with initial dent evidence.');
    expect(page).toContain('Reported power loss needs service judgment.');
    expect(page).toContain('Have staff resolve the conflicting visual findings.');
    expect(page).toContain('Have staff assess the reported fault.');
    expect(page).toContain('Staff make the final decision.');
  });

  it('labels preliminary return and complaint recommendations from the DTO', async () => {
    const returned = await render(result({ policy: { status: 'preliminary_recommendation', recommendation: 'return_verification', blockers: [], nextSteps: ['Staff verify the return.'], advisory: 'Synthetic demo.' }, detailedAnalysis: null }));
    expect(returned.nativeElement.textContent).toContain('Preliminary recommendation: staff return verification');
    returned.componentRef.setInput('result', result({ intake: { ...result().intake, caseType: 'complaint' }, versions: { ...result().versions, policy: 'DEMO-COMPLAINT-1.0' }, policy: { status: 'preliminary_recommendation', recommendation: 'service_assessment', blockers: [], nextSteps: ['Staff assess the service complaint.'], advisory: 'Synthetic demo.' }, detailedAnalysis: null }));
    returned.detectChanges();
    expect(returned.nativeElement.textContent).toContain('Preliminary recommendation: service assessment');
  });

  it('shows all initial observations, raw and usable probabilities, labels and nullable rationale', async () => {
    const fixture = await render(result());
    const page = fixture.nativeElement.textContent as string;
    for (const label of ['Image usability', 'Item relevance', 'Crack visible', 'Dent or deformation visible', 'Scratch visible', 'Not assessable']) expect(page).toContain(label);
    const crack = fixture.nativeElement.querySelector('[id$="-finding-crack_visible"]').parentElement as HTMLElement;
    const scratch = fixture.nativeElement.querySelector('[id$="-finding-scratch_visible"]').parentElement as HTMLElement;
    expect(Array.from(crack.querySelectorAll('dd')).map(value => value.textContent?.trim())).toEqual(['0.15', '0.15', 'Decisions model: synthetic/decision']);
    expect(Array.from(scratch.querySelectorAll('dd')).map(value => value.textContent?.trim())).toEqual(['0.1', 'Not used; image usability or relevance prerequisite was not clearly positive', 'Decisions model: synthetic/decision']);
    expect(page).toContain('Typed visual assessment; this provider did not return a visual rationale.');
    expect(page).toContain('synthetic/decision');
    expect(page).toContain('No crack observed in this view.');
    expect(page).toContain('One image cannot prove hidden condition, functionality, damage cause or legal eligibility.');
  });

  it('keeps initial and detailed evidence separate and shows unsupported findings and conflicts', async () => {
    const fixture = await render(result());
    const page = fixture.nativeElement.textContent as string;
    expect(page).toContain('Initial observations');
    expect(page).toContain('Detailed analysis');
    expect(page).toContain('A shallow dent is visible beside the synthetic hinge.');
    expect(page).toContain('Detailed analysis reports conflicting visual evidence.');
    expect(page).toContain('Reported intermittent power loss requires service judgment.');
    expect(page).toContain('The image cannot verify internal function.');
    expect(page).toContain('Small image; fine detail may be limited.');
  });

  it('marks a superseded result read-only and labels the active result current otherwise', async () => {
    const current = await render(result());
    expect(current.nativeElement.textContent).toContain('Current assessment result');
    current.componentRef.setInput('superseded', true);
    current.detectChanges();
    expect(current.nativeElement.textContent).toContain('Superseded older revision - read only');
  });

  it('renders untrusted case and evidence strings as text rather than HTML', async () => {
    const injected = '<img src=x onerror="window.injected=true">';
    const fixture = await render(result({ intake: { ...result().intake, model: injected }, initialObservations: observations.map(value => value.id === 'crack_visible' ? { ...value, evidence: injected } : value) }));
    expect(fixture.nativeElement.querySelector('img[src="x"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(injected);
  });

  it('shows interruption status separately from the structured policy result', async () => {
    const fixture = await render(result({ stage: 'interrupted' }));
    expect(fixture.nativeElement.textContent).toContain('Assessment interrupted');
    expect(fixture.nativeElement.textContent).toContain('Human review required');
  });
});
