import { z } from "zod";

export const observationIds = [
  "image_usable",
  "item_consistent",
  "crack_visible",
  "dent_visible",
  "scratch_visible",
] as const;
export const categories = [
  "phones_tablets",
  "computers_laptops",
  "monitors_tvs",
  "audio",
  "peripherals_accessories",
  "other_electronics",
] as const;
export const labels = [
  "present",
  "absent",
  "uncertain",
  "not_assessable",
] as const;
export const versions = {
  questions: "VISUAL-1",
  thresholds: "THRESHOLDS-1",
  preparation: "PREP-1",
} as const;
export const limits = {
  uploadBytes: 10 * 1024 ** 2,
  bodyBytes: 12 * 1024 ** 2,
  imageBytes: 1024 ** 2,
  imageEdge: 1600,
  pixels: 25_000_000,
  idleMs: 60 * 60_000,
  absoluteMs: 4 * 60 * 60_000,
  sessions: 20,
  revisions: 10,
  globalImageBytes: 25 * 1024 ** 2,
  contextCharacters: 80_000,
} as const;
export const advisory =
  "Synthetic course demo under fictional policies. Staff make the final decision. A single image cannot establish hidden damage, functionality, ownership, damage cause or legal eligibility.";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= "0001-01-01"
    );
  }, "Use a valid date");
export const intakeSchema = z
  .strictObject({
    caseType: z.enum(["return", "complaint"]),
    category: z.enum(categories),
    model: z.string().trim().min(1).max(200),
    purchaseDate: dateSchema,
    reason: z.string().trim().max(4000).default(""),
  })
  .refine(
    (value) => value.caseType !== "complaint" || value.reason.length > 0,
    { path: ["reason"], message: "A complaint reason is required" },
  );
const probability = z.number().finite().min(0).max(1).nullable();
export const observationSchema = z
  .strictObject({
    id: z.enum(observationIds),
    rawProbability: probability,
    usableProbability: probability,
    label: z.enum(labels),
    provenance: z.strictObject({
      source: z.enum(["decisions", "detailed_analysis", "code"]),
      model: z.string().max(200).nullable(),
    }),
    evidence: z.string().max(4000).nullable(),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .superRefine((value, ctx) => {
    if (
      (value.usableProbability === null) !==
      (value.label === "not_assessable")
    )
      ctx.addIssue({
        code: "custom",
        message: "Unavailable probabilities require not_assessable",
      });
    if (value.usableProbability !== null) {
      const expected =
        value.usableProbability >= 0.85
          ? "present"
          : value.usableProbability <= 0.15
            ? "absent"
            : "uncertain";
      if (value.label !== expected)
        ctx.addIssue({
          code: "custom",
          message: "Observation label must match version-1 probability bands",
        });
    }
  });
export const observationsSchema = z
  .array(observationSchema)
  .length(5)
  .refine(
    (values) => new Set(values.map((v) => v.id)).size === 5,
    "All five distinct observations are required",
  );
export const detailedFindingSchema = z
  .strictObject({
    id: z.enum(observationIds),
    label: z.enum(labels),
    evidence: z.string().trim().max(4000).nullable(),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .refine(
    (value) =>
      !["present", "absent"].includes(value.label) || Boolean(value.evidence),
    "Resolved findings require visible evidence",
  );
export const detailedAnalysisSchema = z.strictObject({
  findings: z
    .array(detailedFindingSchema)
    .max(5)
    .refine(
      (values) => new Set(values.map((v) => v.id)).size === values.length,
      "Detailed finding IDs must be distinct",
    ),
  conflicts: z.boolean(),
  unsupportedConditions: z.array(z.string().max(2000)).max(20),
  limitations: z.array(z.string().max(2000)).max(20),
});
export const blockerCodes = [
  "outside_window",
  "evidence_unresolved",
  "provider_failure",
  "return_damage",
  "conflicting_evidence",
  "unsupported_condition",
  "missing_policy",
  "explanation_failure",
  "interrupted",
  "compression_warning",
] as const;
export const blockerSchema = z.strictObject({
  code: z.enum(blockerCodes),
  message: z.string().min(1).max(2000),
  observationIds: z.array(z.enum(observationIds)).max(5),
});
export const policyResultSchema = z
  .strictObject({
    status: z.enum(["preliminary_recommendation", "human_review_required"]),
    recommendation: z
      .enum(["return_verification", "service_assessment"])
      .nullable(),
    blockers: z.array(blockerSchema).max(50),
    nextSteps: z.array(z.string().min(1).max(2000)).min(1).max(20),
    advisory: z.string().min(1).max(2000),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "preliminary_recommendation" &&
      (value.blockers.length || !value.recommendation)
    )
      ctx.addIssue({
        code: "custom",
        message: "Recommendations require no blockers",
      });
    if (
      value.status === "human_review_required" &&
      (!value.blockers.length || value.recommendation !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Review requires a blocker and no recommendation",
      });
  });
export const imageMetadataSchema = z.strictObject({
  id: z.string().uuid(),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  width: z.number().int().positive().max(1600),
  height: z.number().int().positive().max(1600),
  byteLength: z.number().int().positive().max(limits.imageBytes),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  warnings: z.array(z.string().max(2000)).max(20),
});
export const providerIdentitySchema = z.strictObject({
  requestId: z.string().max(300).nullable(),
  model: z.string().min(1).max(200),
  provider: z.string().max(200).nullable(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      costUsd: z.number().finite().nonnegative().optional(),
    })
    .nullable(),
});
export const assistantMessageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  role: z.literal("assistant"),
  parts: z
    .array(
      z.strictObject({
        type: z.literal("text"),
        text: z.string().min(1).max(64_000),
      }),
    )
    .min(1)
    .max(20),
});
export const stages = [
  "validation",
  "image_preparation",
  "observations",
  "detailed_analysis",
  "policy",
  "explanation",
  "completed",
  "interrupted",
] as const;
export const revisionSchema = z
  .strictObject({
    caseId: z.string().uuid(),
    revision: z.number().int().positive().max(limits.revisions),
    requestId: z.string().uuid(),
    assessmentDate: dateSchema,
    timeZone: z.string().min(1).max(100),
    intake: intakeSchema,
    image: imageMetadataSchema,
    stage: z.enum(["completed", "interrupted"]),
    versions: z.strictObject({
      questions: z.string(),
      thresholds: z.string(),
      preparation: z.string(),
      policy: z.string(),
      decisionsModel: z.string().nullable(),
      visionModel: z.string().nullable(),
      llmModel: z.string().nullable(),
    }),
    initialObservations: observationsSchema,
    detailedAnalysis: detailedAnalysisSchema.nullable(),
    providerIdentities: z.array(providerIdentitySchema).max(3),
    policy: policyResultSchema,
    firstMessage: assistantMessageSchema,
  })
  .superRefine((result, ctx) => {
    const expected =
      result.intake.caseType === "return"
        ? "return_verification"
        : "service_assessment";
    if (
      result.policy.status === "preliminary_recommendation" &&
      result.policy.recommendation !== expected
    )
      ctx.addIssue({
        code: "custom",
        message: "Recommendation must match the current case type",
      });
    if (
      result.stage === "interrupted" &&
      (result.policy.status !== "human_review_required" ||
        !result.policy.blockers.some(
          (blocker) => blocker.code === "interrupted",
        ))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Interrupted assessments require an interruption review blocker",
      });
  });
export const assessmentEventSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("progress"),
      sequence: z.number().int().positive(),
      caseId: z.string().uuid(),
      revision: z.number().int().positive(),
      stage: z.enum(stages),
    }),
    z.strictObject({
      kind: z.literal("result"),
      sequence: z.number().int().positive(),
      caseId: z.string().uuid(),
      revision: z.number().int().positive(),
      result: revisionSchema,
    }),
  ])
  .superRefine((event, ctx) => {
    if (
      event.kind === "result" &&
      (event.caseId !== event.result.caseId ||
        event.revision !== event.result.revision)
    )
      ctx.addIssue({
        code: "custom",
        message: "Result identity must match the event envelope",
      });
  });
export const chatInputSchema = z.strictObject({
  caseId: z.string().uuid(),
  revision: z.number().int().positive().max(limits.revisions),
  messageId: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(4000),
});
export const errorCodes = [
  "validation",
  "capacity",
  "stale_revision",
  "inaccessible",
  "expired",
  "origin",
  "context_limit",
  "unavailable",
] as const;
export const publicErrorSchema = z.strictObject({
  code: z.enum(errorCodes),
  message: z.string().min(1).max(2000),
  fields: z.record(z.string(), z.string().max(500)).optional(),
});
export type Intake = z.infer<typeof intakeSchema>;
export type ObservationId = (typeof observationIds)[number];
export type Observation = z.infer<typeof observationSchema>;
export type DetailedAnalysis = z.infer<typeof detailedAnalysisSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type PolicyResult = z.infer<typeof policyResultSchema>;
export type ImageMetadata = z.infer<typeof imageMetadataSchema>;
export type ProviderIdentity = z.infer<typeof providerIdentitySchema>;
export type AssessmentRevision = z.infer<typeof revisionSchema>;
export type AssessmentEvent = z.infer<typeof assessmentEventSchema>;
export type Stage = (typeof stages)[number];
export const httpStatusByError = {
  validation: 422,
  capacity: 413,
  stale_revision: 409,
  inaccessible: 404,
  expired: 410,
  origin: 403,
  context_limit: 413,
  unavailable: 503,
} as const;
