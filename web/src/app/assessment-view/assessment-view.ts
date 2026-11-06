import { Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import type { AssessmentRevision, Observation, ObservationId, ObservationLabel } from '../assessment.types';

@Component({
  selector: 'app-assessment-view',
  standalone: true,
  imports: [MatCardModule, MatExpansionModule],
  templateUrl: './assessment-view.html',
  styleUrl: './assessment-view.scss',
})
export class AssessmentView {
  readonly result = input.required<AssessmentRevision>();
  readonly superseded = input(false);
  readonly sectionId = computed(() => `assessment-${this.result().caseId}-${this.result().revision}`);

  readonly singleImageLimit = 'One image cannot prove hidden condition, functionality, damage cause or legal eligibility.';
  readonly noRationale = 'Typed visual assessment; this provider did not return a visual rationale.';

  get statusTitle(): string {
    const policy = this.result().policy;
    if (policy.status === 'human_review_required') return 'Human review required';
    if (policy.recommendation === 'return_verification') return 'Preliminary recommendation: staff return verification';
    if (policy.recommendation === 'service_assessment') return 'Preliminary recommendation: service assessment';
    return 'Assessment result unavailable';
  }

  caseTypeLabel(caseType: AssessmentRevision['intake']['caseType']): string {
    return caseType === 'return' ? 'Return' : 'Complaint';
  }

  categoryLabel(category: AssessmentRevision['intake']['category']): string {
    const labels: Record<AssessmentRevision['intake']['category'], string> = {
      phones_tablets: 'Phones and tablets', computers_laptops: 'Computers and laptops', monitors_tvs: 'Monitors and TVs',
      audio: 'Audio equipment', peripherals_accessories: 'Peripherals and accessories', other_electronics: 'Other electronics',
    };
    return labels[category];
  }

  observationName(id: ObservationId): string {
    const names: Record<ObservationId, string> = {
      image_usable: 'Image usability', item_consistent: 'Item relevance', crack_visible: 'Crack visible',
      dent_visible: 'Dent or deformation visible', scratch_visible: 'Scratch visible',
    };
    return names[id];
  }

  labelText(label: ObservationLabel): string {
    const labels: Record<ObservationLabel, string> = {
      present: 'Present', absent: 'Absent in this view', uncertain: 'Uncertain', not_assessable: 'Not assessable',
    };
    return labels[label];
  }

  probabilityText(value: number | null): string {
    return value === null ? 'Not returned' : String(value);
  }

  usableProbabilityText(observation: Observation): string {
    if (observation.usableProbability !== null) return String(observation.usableProbability);
    return observation.rawProbability === null
      ? 'Not usable; no probability was returned'
      : 'Not used; image usability or relevance prerequisite was not clearly positive';
  }

  provenanceText(observation: Observation): string {
    const source = observation.provenance.source === 'decisions' ? 'Decisions model' :
      observation.provenance.source === 'detailed_analysis' ? 'Detailed analysis' : 'Code';
    return observation.provenance.model ? `${source}: ${observation.provenance.model}` : source;
  }
}
