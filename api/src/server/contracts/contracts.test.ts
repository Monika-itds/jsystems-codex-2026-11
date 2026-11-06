import { describe, expect, it } from "vitest";
import {
  intakeSchema,
  observationsSchema,
  policyResultSchema,
  chatInputSchema,
} from "./index";
const intake = {
  caseType: "return",
  category: "computers_laptops",
  model: " Synthetic laptop ",
  reason: "",
  purchaseDate: "2026-11-01",
};
describe("public trust boundaries", () => {
  it("trims valid intake and rejects blank complaint reason, invalid dates, enums and extra fields", () => {
    expect(intakeSchema.parse(intake).model).toBe("Synthetic laptop");
    for (const invalid of [
      { ...intake, caseType: "complaint" },
      { ...intake, purchaseDate: "2025-02-29" },
      { ...intake, category: "invented" },
      { ...intake, apiKey: "synthetic" },
    ])
      expect(intakeSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires exactly the five distinct observations with bounded probabilities", () => {
    const ids = [
      "image_usable",
      "item_consistent",
      "crack_visible",
      "dent_visible",
      "scratch_visible",
    ];
    const observations = ids.map((id) => ({
      id,
      rawProbability: 0.9,
      usableProbability: 0.9,
      label: "present",
      provenance: { source: "decisions", model: "synthetic/model" },
      evidence: null,
      limitations: ["Single view"],
    }));
    expect(observationsSchema.safeParse(observations).success).toBe(true);
    expect(
      observationsSchema.safeParse([...observations.slice(1), observations[1]])
        .success,
    ).toBe(false);
    expect(
      observationsSchema.safeParse(
        observations.map((o) => ({ ...o, rawProbability: 1.01 })),
      ).success,
    ).toBe(false);
    expect(
      observationsSchema.safeParse(
        observations.map((o) => ({ ...o, usableProbability: null })),
      ).success,
    ).toBe(false);
  });
  it("cannot clear review blockers through a mismatched status or recommendation", () => {
    const result = {
      status: "human_review_required",
      recommendation: null,
      blockers: [
        {
          code: "provider_failure",
          message: "Provider unavailable",
          observationIds: [],
        },
      ],
      nextSteps: ["Staff review"],
      advisory: "Fictional demo rules",
    };
    expect(policyResultSchema.safeParse(result).success).toBe(true);
    expect(
      policyResultSchema.safeParse({
        ...result,
        recommendation: "return_verification",
      }).success,
    ).toBe(false);
    expect(
      policyResultSchema.safeParse({
        ...result,
        status: "preliminary_recommendation",
        recommendation: "return_verification",
      }).success,
    ).toBe(false);
  });
  it("accepts one bounded chat turn and rejects client policy/model overrides", () => {
    const turn = {
      caseId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      messageId: "message-1",
      text: "Why is review required?",
    };
    expect(chatInputSchema.safeParse(turn).success).toBe(true);
    expect(
      chatInputSchema.safeParse({ ...turn, text: "x".repeat(4001) }).success,
    ).toBe(false);
    expect(
      chatInputSchema.safeParse({ ...turn, status: "approved", model: "other" })
        .success,
    ).toBe(false);
  });
});

import {
  assessmentEventSchema,
  detailedAnalysisSchema,
  revisionSchema,
  publicErrorSchema,
  httpStatusByError,
  type AssessmentRevision,
} from "./index";
import type {
  AssessmentRevision as FrontendRevision,
  AssessmentEvent as FrontendEvent,
} from "../../../../web/src/app/assessment.types";
type Assert<T extends true> = T;
// Compile-time compatibility in both directions; frontend has no server runtime import.
export type DtoConsistency = Assert<
  AssessmentRevision extends FrontendRevision
    ? FrontendRevision extends AssessmentRevision
      ? true
      : false
    : false
>;
export type EventConsistency = Assert<
  import("./index").AssessmentEvent extends FrontendEvent
    ? FrontendEvent extends import("./index").AssessmentEvent
      ? true
      : false
    : false
>;
const example = {
  caseId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  requestId: "00000000-0000-4000-8000-000000000002",
  assessmentDate: "2026-11-06",
  timeZone: "Europe/Warsaw",
  intake,
  image: {
    id: "00000000-0000-4000-8000-000000000003",
    mediaType: "image/jpeg",
    width: 800,
    height: 600,
    byteLength: 500,
    hash: "a".repeat(64),
    warnings: [],
  },
  stage: "completed",
  versions: {
    questions: "VISUAL-1",
    thresholds: "THRESHOLDS-1",
    preparation: "PREP-1",
    policy: "DEMO-RETURN-1.0",
    decisionsModel: "synthetic/decisions",
    visionModel: "synthetic/vision",
    llmModel: "synthetic/text",
  },
  initialObservations: [
    "image_usable",
    "item_consistent",
    "crack_visible",
    "dent_visible",
    "scratch_visible",
  ].map((id, i) => ({
    id,
    rawProbability: i < 2 ? 0.9 : 0.1,
    usableProbability: i < 2 ? 0.9 : 0.1,
    label: i < 2 ? "present" : "absent",
    provenance: { source: "decisions", model: "synthetic/decisions" },
    evidence: null,
    limitations: ["No visual rationale returned; single view only."],
  })),
  detailedAnalysis: null,
  providerIdentities: [],
  policy: {
    status: "preliminary_recommendation",
    recommendation: "return_verification",
    blockers: [],
    nextSteps: ["Staff verify the synthetic case."],
    advisory: "Fictional rules; staff make the final decision.",
  },
  firstMessage: {
    id: "first-1",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Hello. Proceed to staff return verification under fictional demo rules.",
      },
    ],
  },
};
describe("complete synthetic public contracts", () => {
  it("validates a full revision and result event", () => {
    const result: FrontendRevision = revisionSchema.parse(example);
    expect(result.intake.model).toBe("Synthetic laptop");
    const event = {
      kind: "result",
      sequence: 2,
      caseId: result.caseId,
      revision: 1,
      result,
    };
    expect(assessmentEventSchema.safeParse(event).success).toBe(true);
    expect(
      assessmentEventSchema.safeParse({ ...event, revision: 2 }).success,
    ).toBe(false);
    expect(
      assessmentEventSchema.safeParse({
        ...event,
        caseId: "00000000-0000-4000-8000-000000000099",
      }).success,
    ).toBe(false);
  });
  it("excludes prepared bytes and provider credentials from the public DTO", () => {
    expect(
      revisionSchema.safeParse({
        ...example,
        image: { ...example.image, bytes: [1, 2] },
      }).success,
    ).toBe(false);
    expect(
      revisionSchema.safeParse({ ...example, apiKey: "synthetic-key" }).success,
    ).toBe(false);
  });
  it("accepts partial resolution and unresolved analysis but rejects unsupported resolutions", () => {
    const analysis = {
      findings: [
        {
          id: "scratch_visible",
          label: "absent",
          evidence: "The visible panel is smooth in this view.",
          limitations: ["Single view"],
        },
      ],
      conflicts: false,
      unsupportedConditions: [],
      limitations: [],
    };
    expect(detailedAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(
      detailedAnalysisSchema.safeParse({ ...analysis, findings: [] }).success,
    ).toBe(true);
    expect(
      detailedAnalysisSchema.safeParse({
        ...analysis,
        findings: [...analysis.findings, ...analysis.findings],
      }).success,
    ).toBe(false);
    expect(
      detailedAnalysisSchema.safeParse({
        ...analysis,
        findings: [{ ...analysis.findings[0], evidence: " " }],
      }).success,
    ).toBe(false);
  });
  it("maps sanitized errors to the documented HTTP statuses", () => {
    expect(httpStatusByError).toEqual({
      validation: 422,
      capacity: 413,
      stale_revision: 409,
      inaccessible: 404,
      expired: 410,
      origin: 403,
      context_limit: 413,
      unavailable: 503,
    });
    expect(
      publicErrorSchema.safeParse({
        code: "origin",
        message: "Request origin is not allowed.",
      }).success,
    ).toBe(true);
    expect(
      publicErrorSchema.safeParse({
        code: "origin",
        message: "Denied",
        providerBody: "forbidden",
      }).success,
    ).toBe(false);
  });
});

it("keeps recommendations tied to case type and interrupted results under review", () => {
  expect(
    revisionSchema.safeParse({
      ...example,
      policy: { ...example.policy, recommendation: "service_assessment" },
    }).success,
  ).toBe(false);
  expect(
    revisionSchema.safeParse({ ...example, stage: "interrupted" }).success,
  ).toBe(false);
});
