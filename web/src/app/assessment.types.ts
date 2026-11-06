// Public DTO only. Keep aligned with the strict server contracts; no server imports.
export type CaseType = 'return' | 'complaint';
export type Category =
  | 'phones_tablets'
  | 'computers_laptops'
  | 'monitors_tvs'
  | 'audio'
  | 'peripherals_accessories'
  | 'other_electronics';
export interface Intake {
  caseType: CaseType;
  category: Category;
  model: string;
  reason: string;
  purchaseDate: string;
}
export type ObservationId =
  'image_usable' | 'item_consistent' | 'crack_visible' | 'dent_visible' | 'scratch_visible';
export type ObservationLabel = 'present' | 'absent' | 'uncertain' | 'not_assessable';
export interface Observation {
  id: ObservationId;
  rawProbability: number | null;
  usableProbability: number | null;
  label: ObservationLabel;
  provenance: { source: 'decisions' | 'detailed_analysis' | 'code'; model: string | null };
  evidence: string | null;
  limitations: string[];
}
export interface DetailedFinding {
  id: ObservationId;
  label: ObservationLabel;
  evidence: string | null;
  limitations: string[];
}
export interface DetailedAnalysis {
  findings: DetailedFinding[];
  conflicts: boolean;
  unsupportedConditions: string[];
  limitations: string[];
}
export interface Blocker {
  code:
    | 'outside_window'
    | 'evidence_unresolved'
    | 'provider_failure'
    | 'return_damage'
    | 'conflicting_evidence'
    | 'unsupported_condition'
    | 'missing_policy'
    | 'explanation_failure'
    | 'interrupted'
    | 'compression_warning';
  message: string;
  observationIds: ObservationId[];
}
export interface PolicyResult {
  status: 'preliminary_recommendation' | 'human_review_required';
  recommendation: 'return_verification' | 'service_assessment' | null;
  blockers: Blocker[];
  nextSteps: string[];
  advisory: string;
}
export interface ImageMetadata {
  id: string;
  mediaType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  byteLength: number;
  hash: string;
  warnings: string[];
}
export interface ProviderIdentity {
  requestId: string | null;
  model: string;
  provider: string | null;
  usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | null;
}
export interface AssistantMessage {
  id: string;
  role: 'assistant';
  parts: { type: 'text'; text: string }[];
}
export type Stage =
  | 'validation'
  | 'image_preparation'
  | 'observations'
  | 'detailed_analysis'
  | 'policy'
  | 'explanation'
  | 'completed'
  | 'interrupted';
export interface AssessmentRevision {
  caseId: string;
  revision: number;
  requestId: string;
  assessmentDate: string;
  timeZone: string;
  intake: Intake;
  image: ImageMetadata;
  stage: 'completed' | 'interrupted';
  versions: {
    questions: string;
    thresholds: string;
    preparation: string;
    policy: string;
    decisionsModel: string | null;
    visionModel: string | null;
    llmModel: string | null;
  };
  initialObservations: Observation[];
  detailedAnalysis: DetailedAnalysis | null;
  providerIdentities: ProviderIdentity[];
  policy: PolicyResult;
  firstMessage: AssistantMessage;
}
export type AssessmentEvent =
  | { kind: 'progress'; sequence: number; caseId: string; revision: number; stage: Stage }
  | {
      kind: 'result';
      sequence: number;
      caseId: string;
      revision: number;
      result: AssessmentRevision;
    };
export interface PublicError {
  code:
    | 'validation'
    | 'capacity'
    | 'stale_revision'
    | 'inaccessible'
    | 'expired'
    | 'origin'
    | 'context_limit'
    | 'unavailable';
  message: string;
  fields?: Record<string, string>;
}
