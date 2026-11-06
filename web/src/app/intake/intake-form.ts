import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CaseType, Category, Intake } from '../assessment.types';

const MAX_MODEL_LENGTH = 200;
const MAX_REASON_LENGTH = 4000;
/** 10 MiB, matching the proposed upload default. The server re-checks the real file. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

const CASE_TYPE_OPTIONS: readonly SelectOption<CaseType>[] = [
  { value: 'return', label: 'Return' },
  { value: 'complaint', label: 'Complaint' },
];

const CATEGORY_OPTIONS: readonly SelectOption<Category>[] = [
  { value: 'phones_tablets', label: 'Phones & tablets' },
  { value: 'computers_laptops', label: 'Computers & laptops' },
  { value: 'monitors_tvs', label: 'Monitors & TVs' },
  { value: 'audio', label: 'Audio equipment' },
  { value: 'peripherals_accessories', label: 'Peripherals & accessories' },
  { value: 'other_electronics', label: 'Other electronics' },
];

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** Date-only string from local calendar fields; never a UTC conversion. */
function toDateOnlyIso(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function parseDateOnly(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) {
    return null;
  }
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function sameDay(left: Date | null, right: Date | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.getTime() === right.getTime();
}

function precheckImage(file: File): string | null {
  if (file.size === 0) {
    return 'That file is empty. Choose a nonempty image.';
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Use a JPEG, PNG or WebP image file.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'That file is larger than 10 MB. Choose a smaller image.';
  }
  return null;
}

@Component({
  selector: 'app-intake-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './intake-form.html',
  styleUrl: './intake-form.scss',
})
export class IntakeForm {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly draft = input<Intake | null>(null);
  readonly imageFile = input<File | null>(null);
  readonly busy = input<boolean>(false);
  readonly today = input<Date>(new Date());

  readonly submitAssessment = output<{ intake: Intake; image: File }>();
  readonly draftChanged = output<{ intake: Partial<Intake>; image: File | null }>();
  readonly cancelled = output<void>();

  readonly caseTypeOptions = CASE_TYPE_OPTIONS;
  readonly categoryOptions = CATEGORY_OPTIONS;

  readonly selectedImage = signal<File | null>(null);
  readonly imageError = signal<string | null>(null);
  readonly previewUrl = signal<string | null>(null);
  private readonly statusMessage = signal('');
  readonly status = computed(() => {
    if (this.busy()) {
      return 'Working on this intake. Please wait.';
    }
    return this.statusMessage();
  });

  private readonly modelValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value : '';
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { required: true };
    }
    if (trimmed.length > MAX_MODEL_LENGTH) {
      return { maxlength: { requiredLength: MAX_MODEL_LENGTH, actualLength: trimmed.length } };
    }
    return null;
  };

  private readonly purchaseDateValidator = (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (value === null || value === undefined || value === '') {
      return { required: true };
    }
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return { invalidDate: true };
    }
    if (startOfDay(value).getTime() > startOfDay(this.today()).getTime()) {
      return { futureDate: true };
    }
    return null;
  };

  private readonly reasonValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value : '';
    const errors: ValidationErrors = {};
    if (value.length > MAX_REASON_LENGTH) {
      errors['maxlength'] = { requiredLength: MAX_REASON_LENGTH, actualLength: value.length };
    }
    const caseType: CaseType | null = control.parent?.get('caseType')?.value ?? null;
    if (caseType === 'complaint' && value.trim().length === 0) {
      errors['reasonRequired'] = true;
    }
    return Object.keys(errors).length > 0 ? errors : null;
  };

  readonly form = this.fb.group({
    caseType: this.fb.nonNullable.control<CaseType | null>(null, [Validators.required]),
    category: this.fb.nonNullable.control<Category | null>(null, [Validators.required]),
    model: this.fb.nonNullable.control('', [this.modelValidator]),
    purchaseDate: this.fb.nonNullable.control<Date | null>(null, [this.purchaseDateValidator]),
    reason: this.fb.nonNullable.control('', [this.reasonValidator]),
  });

  readonly caseTypeControl = this.form.controls.caseType;
  readonly categoryControl = this.form.controls.category;
  readonly modelControl = this.form.controls.model;
  readonly purchaseDateControl = this.form.controls.purchaseDate;
  readonly reasonControl = this.form.controls.reason;

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  private applyingExternal = false;
  private lastAppliedDraft: Intake | null = null;
  private lastAppliedImage: File | null = null;

  constructor() {
    this.caseTypeControl.valueChanges.subscribe(() => {
      this.reasonControl.updateValueAndValidity({ emitEvent: false });
    });
    this.form.valueChanges.subscribe(() => {
      if (this.applyingExternal) {
        return;
      }
      this.emitDraftChanged();
    });

    effect(() => {
      const draft = this.draft();
      if (draft !== null && draft !== this.lastAppliedDraft) {
        this.lastAppliedDraft = draft;
        this.applyDraft(draft);
      }
    });
    effect(() => {
      const image = this.imageFile();
      if (image !== this.lastAppliedImage) {
        this.lastAppliedImage = image;
        this.applyImage(image);
      }
    });
    effect(() => {
      this.today();
      this.purchaseDateControl.updateValueAndValidity({ emitEvent: false });
    });
    effect(() => {
      if (this.busy()) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    });

    this.destroyRef.onDestroy(() => {
      const url = this.previewUrl();
      if (url) {
        URL.revokeObjectURL(url);
        this.previewUrl.set(null);
      }
    });
  }

  onSubmit(): void {
    if (this.busy()) {
      return;
    }
    this.form.markAllAsTouched();
    const image = this.selectedImage();
    if (!image) {
      this.imageError.set('Choose one image file to continue.');
    }
    if (this.form.invalid || !image) {
      this.statusMessage.set('Fix the highlighted fields before adding an image.');
      return;
    }
    const raw = this.form.getRawValue();
    if (!raw.caseType || !raw.category || !(raw.purchaseDate instanceof Date)) {
      this.statusMessage.set('Fix the highlighted fields before adding an image.');
      return;
    }
    const intake: Intake = {
      caseType: raw.caseType,
      category: raw.category,
      model: raw.model.trim(),
      reason: raw.reason.trim(),
      purchaseDate: toDateOnlyIso(raw.purchaseDate),
    };
    this.submitAssessment.emit({ intake, image });
    this.statusMessage.set('Intake complete: local checks passed.');
  }

  onFileSelected(event: Event): void {
    if (this.busy()) {
      return;
    }
    const inputElement = event.target as HTMLInputElement | null;
    const files = inputElement?.files;
    if (!files || files.length !== 1) {
      const count = files?.length ?? 0;
      this.imageError.set(
        count === 0 ? 'Choose one image file to continue.' : 'Select exactly one image file at a time.',
      );
      return;
    }
    const file = files[0];
    const problem = precheckImage(file);
    if (problem) {
      this.imageError.set(problem);
      return;
    }
    this.imageError.set(null);
    this.replacePreview(file);
    this.selectedImage.set(file);
    this.lastAppliedImage = file;
    if (inputElement) {
      inputElement.value = '';
    }
    this.emitDraftChanged();
  }

  replaceImage(): void {
    if (this.busy()) {
      return;
    }
    const inputElement = this.fileInput?.nativeElement;
    if (!inputElement) {
      return;
    }
    inputElement.value = '';
    inputElement.click();
  }

  removeImage(): void {
    if (this.busy()) {
      return;
    }
    this.revokePreview();
    this.selectedImage.set(null);
    this.lastAppliedImage = null;
    this.imageError.set(null);
    this.emitDraftChanged();
  }

  private applyDraft(draft: Intake): void {
    const purchaseDate = parseDateOnly(draft.purchaseDate);
    const current = this.form.getRawValue();
    if (
      current.caseType === draft.caseType &&
      current.category === draft.category &&
      current.model === draft.model &&
      current.reason === draft.reason &&
      sameDay(current.purchaseDate, purchaseDate)
    ) {
      return;
    }
    this.applyingExternal = true;
    try {
      this.form.setValue({
        caseType: draft.caseType,
        category: draft.category,
        model: draft.model,
        reason: draft.reason,
        purchaseDate,
      });
      this.form.markAsPristine();
    } finally {
      this.applyingExternal = false;
    }
  }

  private applyImage(image: File | null): void {
    this.applyingExternal = true;
    try {
      if (image) {
        this.replacePreview(image);
        this.selectedImage.set(image);
        this.imageError.set(null);
      } else {
        this.revokePreview();
        this.selectedImage.set(null);
      }
    } finally {
      this.applyingExternal = false;
    }
  }

  private replacePreview(file: File): void {
    this.revokePreview();
    if (typeof URL.createObjectURL === 'function') {
      this.previewUrl.set(URL.createObjectURL(file));
    }
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
  }

  private emitDraftChanged(): void {
    this.draftChanged.emit({ intake: this.partialIntake(), image: this.selectedImage() });
  }

  private partialIntake(): Partial<Intake> {
    const raw = this.form.getRawValue();
    const partial: Partial<Intake> = { model: raw.model, reason: raw.reason };
    if (raw.caseType) {
      partial.caseType = raw.caseType;
    }
    if (raw.category) {
      partial.category = raw.category;
    }
    if (raw.purchaseDate) {
      partial.purchaseDate = toDateOnlyIso(raw.purchaseDate);
    }
    return partial;
  }
}
