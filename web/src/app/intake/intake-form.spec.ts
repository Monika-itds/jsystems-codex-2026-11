import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Intake } from '../assessment.types';
import { IntakeForm } from './intake-form';

const MiB = 1024 * 1024;
/** Fixed "today" so date validation is deterministic in tests (local calendar day). */
const TODAY = new Date(2026, 5, 1);

interface Ctx {
  fixture: ComponentFixture<IntakeForm>;
  component: IntakeForm;
  element: HTMLElement;
}

interface DraftChange {
  intake: Partial<Intake>;
  image: File | null;
}

interface Submission {
  intake: Intake;
  image: File;
}

let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let configured = false;

beforeEach(() => {
  let sequence = 0;
  configured = false;
  createObjectUrl = vi.fn(() => `blob:synthetic/${++sequence}`);
  revokeObjectUrl = vi.fn();
  const urlApi = URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  urlApi.createObjectURL = createObjectUrl as unknown as (blob: Blob) => string;
  urlApi.revokeObjectURL = revokeObjectUrl as unknown as (url: string) => void;
});

afterEach(() => {
  const urlApi = URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  delete urlApi.createObjectURL;
  delete urlApi.revokeObjectURL;
  TestBed.resetTestingModule();
});

async function createComponent(
  options: { draft?: Intake | null; imageFile?: File | null; busy?: boolean; today?: Date } = {},
): Promise<Ctx> {
  if (!configured) {
    await TestBed.configureTestingModule({ imports: [IntakeForm] }).compileComponents();
    configured = true;
  }
  const fixture = TestBed.createComponent(IntakeForm);
  applyInputs(fixture, options);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
}

function applyInputs(
  fixture: ComponentFixture<IntakeForm>,
  options: { draft?: Intake | null; imageFile?: File | null; busy?: boolean; today?: Date },
): void {
  fixture.componentRef.setInput('today', options.today ?? TODAY);
  if ('draft' in options) {
    fixture.componentRef.setInput('draft', options.draft ?? null);
  }
  if ('imageFile' in options) {
    fixture.componentRef.setInput('imageFile', options.imageFile ?? null);
  }
  if (options.busy !== undefined) {
    fixture.componentRef.setInput('busy', options.busy);
  }
}

function makeFile(name = 'synthetic-equipment.png', type = 'image/png', bytes = 4096): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function withSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

function localDate(iso: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) {
    return null;
  }
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

function applyIntake(component: IntakeForm, intake: Intake): void {
  component.form.setValue({
    caseType: intake.caseType,
    category: intake.category,
    model: intake.model,
    reason: intake.reason,
    purchaseDate: localDate(intake.purchaseDate),
  });
}

const VALID_INTAKE: Intake = {
  caseType: 'complaint',
  category: 'monitors_tvs',
  model: 'Synthetic monitor',
  reason: 'Bezel crack after unboxing',
  purchaseDate: '2026-02-10',
};

function selectFiles(element: HTMLElement, files: File[]): HTMLInputElement {
  const input = element.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('Expected exactly one file input');
  }
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input;
}

function clickSubmit(element: HTMLElement): void {
  const button = element.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) {
    throw new Error('Expected a submit button');
  }
  button.click();
}

function describeIntake(component: IntakeForm): string {
  return JSON.stringify(component.form.getRawValue());
}

describe('IntakeForm', () => {
  it('renders one labeled native file input, readable options and the synthetic-only reminder', async () => {
    const { fixture, component, element } = await createComponent();

    const fileInputs = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    expect(fileInputs).toHaveLength(1);
    const fileInput = fileInputs[0];
    expect(fileInput.hasAttribute('multiple')).toBe(false);
    const accept = fileInput.getAttribute('accept') ?? '';
    expect(accept).toContain('image/jpeg');
    expect(accept).toContain('image/png');
    expect(accept).toContain('image/webp');
    expect(fileInput.id).not.toBe('');
    const label = element.querySelector(`label[for="${fileInput.id}"]`);
    expect(label?.textContent?.trim()).toContain('image');
    const describedBy = (fileInput.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(describedBy).not.toHaveLength(0);
    for (const id of describedBy) {
      expect(element.querySelector(`#${id}`)).not.toBeNull();
    }

    const optionLabels = [
      ...component.caseTypeOptions.map((option) => option.label),
      ...component.categoryOptions.map((option) => option.label),
    ];
    expect(optionLabels).toHaveLength(8);
    expect(optionLabels).toContain('Return');
    expect(optionLabels).toContain('Complaint');
    expect(optionLabels).toContain('Monitors & TVs');
    expect(optionLabels.filter((label) => label.includes('_'))).toHaveLength(0);
    applyIntake(component, VALID_INTAKE);
    fixture.detectChanges();
    expect(element.querySelector('#intake-category')?.textContent).toContain('Monitors & TVs');

    const text = element.textContent ?? '';
    expect(text).toContain('Synthetic');
    expect(text).toContain('serial numbers');
    expect(text).toContain('automated identity detection');
    expect(element.querySelector('[role="status"]')).not.toBeNull();
  });

  it('rejects a blank or whitespace complaint reason but allows an empty reason for a return', async () => {
    const { fixture, component } = await createComponent();

    applyIntake(component, { ...VALID_INTAKE, reason: '   ' });
    fixture.detectChanges();
    expect(component.form.invalid).toBe(true);
    expect(component.form.get('reason')?.hasError('reasonRequired')).toBe(true);

    component.form.get('reason')?.setValue('Speaker cone is dented');
    fixture.detectChanges();
    expect(component.form.valid).toBe(true);

    component.form.get('caseType')?.setValue('return');
    component.form.get('reason')?.setValue('');
    fixture.detectChanges();
    expect(component.form.get('reason')?.valid).toBe(true);
    expect(component.form.valid).toBe(true);
  });

  it('emits no assessment for invalid date, model or missing image and keeps entered fields', async () => {
    const { fixture, component, element } = await createComponent();
    const submissions: Submission[] = [];
    component.submitAssessment.subscribe((value) => submissions.push(value));

    applyIntake(component, { ...VALID_INTAKE, model: '   ', purchaseDate: '2026-07-15' });
    fixture.detectChanges();
    clickSubmit(element);
    fixture.detectChanges();
    expect(submissions).toHaveLength(0);
    expect(component.form.get('model')?.hasError('required')).toBe(true);
    expect(component.form.get('purchaseDate')?.hasError('futureDate')).toBe(true);

    const modelInput = element.querySelector<HTMLInputElement>('#intake-model');
    expect(modelInput).not.toBeNull();
    const describedIds = (modelInput?.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(describedIds.length).toBeGreaterThan(0);
    const describedText = describedIds.map((id) => element.querySelector(`#${id}`)?.textContent ?? '').join(' ');
    expect(describedText).toContain('model');

    component.form.get('purchaseDate')?.setValue(null);
    fixture.detectChanges();
    expect(component.form.get('purchaseDate')?.hasError('required')).toBe(true);
    expect(describeIntake(component)).toContain('"caseType":"complaint"');

    applyIntake(component, VALID_INTAKE);
    fixture.detectChanges();
    clickSubmit(element);
    expect(submissions).toHaveLength(0);
    expect(component.selectedImage()).toBeNull();
    expect(element.textContent).toContain('Choose one image');
    expect(component.form.get('model')?.value).toBe(VALID_INTAKE.model);
    expect(component.form.get('reason')?.value).toBe(VALID_INTAKE.reason);
    expect(component.form.get('category')?.value).toBe(VALID_INTAKE.category);
  });

  it('emits a trimmed intake with a local date-only ISO date and the selected file', async () => {
    const { fixture, component, element } = await createComponent();
    const submissions: Submission[] = [];
    component.submitAssessment.subscribe((value) => submissions.push(value));

    applyIntake(component, {
      ...VALID_INTAKE,
      model: '  Synthetic Monitor 27"  ',
      reason: '  Bezel crack after unboxing  ',
      purchaseDate: '2026-01-05',
    });
    const file = makeFile('synthetic-monitor.png');
    selectFiles(element, [file]);
    fixture.detectChanges();
    expect(component.selectedImage()).toBe(file);

    clickSubmit(element);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].intake).toEqual({
      caseType: 'complaint',
      category: 'monitors_tvs',
      model: 'Synthetic Monitor 27"',
      reason: 'Bezel crack after unboxing',
      purchaseDate: '2026-01-05',
    });
    expect(submissions[0].image).toBe(file);
  });

  it('suppresses duplicate submission while busy and disables edit controls', async () => {
    const { fixture, component, element } = await createComponent();
    applyIntake(component, VALID_INTAKE);
    selectFiles(element, [makeFile()]);
    fixture.detectChanges();
    const submissions: Submission[] = [];
    component.submitAssessment.subscribe((value) => submissions.push(value));

    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(button?.disabled).toBe(true);
    expect(component.form.disabled).toBe(true);
    const modelInput = element.querySelector<HTMLInputElement>('#intake-model');
    expect(modelInput?.disabled).toBe(true);
    const caseTypeSelect = element.querySelector<HTMLElement>('mat-select');
    expect(caseTypeSelect?.getAttribute('aria-disabled')).toBe('true');

    clickSubmit(element);
    expect(submissions).toHaveLength(0);
    component.onSubmit();
    expect(submissions).toHaveLength(0);

    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.form.disabled).toBe(false);
    expect(component.form.get('model')?.value).toBe(VALID_INTAKE.model);

    clickSubmit(element);
    expect(submissions).toHaveLength(1);
  });

  it('rejects empty, oversized, unsupported and multi-file selections with inline guidance', async () => {
    const { fixture, component, element } = await createComponent();
    applyIntake(component, VALID_INTAKE);
    fixture.detectChanges();

    selectFiles(element, [withSize(makeFile('empty.png', 'image/png'), 0)]);
    expect(component.selectedImage()).toBeNull();
    expect(component.imageError()).toContain('empty');

    selectFiles(element, [withSize(makeFile('large.jpg', 'image/jpeg'), 11 * MiB)]);
    expect(component.selectedImage()).toBeNull();
    expect(component.imageError()).toContain('10 MB');

    selectFiles(element, [makeFile('document.gif', 'image/gif')]);
    expect(component.selectedImage()).toBeNull();
    expect(component.imageError()).toContain('JPEG');

    selectFiles(element, [makeFile('first.png'), makeFile('second.png')]);
    expect(component.selectedImage()).toBeNull();
    expect(component.imageError()).toContain('exactly one');
    expect(component.previewUrl()).toBeNull();
    expect(element.textContent).toContain('exactly one');

    expect(component.form.get('caseType')?.value).toBe(VALID_INTAKE.caseType);
    expect(component.form.get('model')?.value).toBe(VALID_INTAKE.model);
  });

  it('revokes the preview object URL on replace, remove and destroy', async () => {
    const { fixture, component, element } = await createComponent();

    selectFiles(element, [makeFile('first.png')]);
    fixture.detectChanges();
    const firstUrl = component.previewUrl();
    expect(firstUrl).toBeTruthy();
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    selectFiles(element, [makeFile('second.png')]);
    fixture.detectChanges();
    expect(revokeObjectUrl).toHaveBeenCalledWith(firstUrl);
    const secondUrl = component.previewUrl();
    expect(secondUrl).toBeTruthy();
    expect(secondUrl).not.toBe(firstUrl);

    element.querySelector<HTMLButtonElement>('#intake-remove-image')?.click();
    fixture.detectChanges();
    expect(revokeObjectUrl).toHaveBeenCalledWith(secondUrl);
    expect(component.previewUrl()).toBeNull();
    expect(component.selectedImage()).toBeNull();

    const other = await createComponent();
    selectFiles(other.element, [makeFile('third.png')]);
    other.fixture.detectChanges();
    const thirdUrl = other.component.previewUrl();
    expect(thirdUrl).toBeTruthy();
    other.fixture.destroy();
    expect(revokeObjectUrl).toHaveBeenCalledWith(thirdUrl);
  });

  it('applies provided draft and image inputs and emits draftChanged for later edits', async () => {
    await TestBed.configureTestingModule({ imports: [IntakeForm] }).compileComponents();
    configured = true;
    const draft: Intake = {
      caseType: 'return',
      category: 'audio',
      model: 'Synthetic speaker',
      reason: '',
      purchaseDate: '2026-02-10',
    };
    const draftImage = makeFile('draft-speaker.png');
    const fixture = TestBed.createComponent(IntakeForm);
    applyInputs(fixture, { draft, imageFile: draftImage });
    const changes: DraftChange[] = [];
    fixture.componentInstance.draftChanged.subscribe((value) => changes.push(value));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(changes).toHaveLength(0);
    expect(fixture.componentInstance.form.getRawValue()).toEqual({
      caseType: 'return',
      category: 'audio',
      model: 'Synthetic speaker',
      reason: '',
      purchaseDate: new Date(2026, 1, 10),
    });
    expect(fixture.componentInstance.selectedImage()).toBe(draftImage);
    expect(fixture.componentInstance.previewUrl()).toBeTruthy();

    fixture.componentInstance.form.get('model')?.setValue('  Synth speaker MK2  ');
    fixture.detectChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].intake).toEqual({
      caseType: 'return',
      category: 'audio',
      model: '  Synth speaker MK2  ',
      reason: '',
      purchaseDate: '2026-02-10',
    });
    expect(changes[0].image).toBe(draftImage);

    const element = fixture.nativeElement as HTMLElement;
    selectFiles(element, [makeFile('other.png')]);
    fixture.detectChanges();
    expect(changes).toHaveLength(2);
    expect(changes[1].image?.name).toBe('other.png');
    expect(fixture.componentInstance.form.get('model')?.value).toBe('  Synth speaker MK2  ');
  });

  it('emits cancelled from the cancel control without discarding entered values', async () => {
    const { fixture, component, element } = await createComponent();
    applyIntake(component, VALID_INTAKE);
    fixture.detectChanges();
    let cancelled = false;
    component.cancelled.subscribe(() => (cancelled = true));

    const cancel = element.querySelector<HTMLButtonElement>('#intake-cancel');
    expect(cancel).not.toBeNull();
    cancel?.click();
    fixture.detectChanges();

    expect(cancelled).toBe(true);
    expect(component.form.get('model')?.value).toBe(VALID_INTAKE.model);
  });
});
