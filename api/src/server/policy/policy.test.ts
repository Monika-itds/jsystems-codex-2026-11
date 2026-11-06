import { describe, expect, it } from "vitest";
import {
  policyResultSchema,
  type Blocker,
  type DetailedAnalysis,
  type Intake,
  type ObservationId,
} from "../contracts";
import {
  dateInTimeZone,
  evaluatePolicy,
  labelProbability,
  needsDetailedAnalysis,
  normalizeInitial,
  validateIntake,
} from "./index";
import { loadPolicyContent } from "./content";

const intake = (
  caseType: "return" | "complaint" = "return",
  purchaseDate = "2026-01-01",
): Intake => ({
  caseType,
  category: "computers_laptops",
  model: "Synthetic laptop",
  reason: caseType === "complaint" ? "Synthetic charging fault" : "",
  purchaseDate,
});
const clearValues: Record<ObservationId, number | null> = {
  image_usable: 0.9,
  item_consistent: 0.9,
  crack_visible: 0.1,
  dent_visible: 0.1,
  scratch_visible: 0.1,
};
const clear = () => normalizeInitial(clearValues, "synthetic/decisions");
const analysis = (
  findings: DetailedAnalysis["findings"],
  extra: Partial<DetailedAnalysis> = {},
): DetailedAnalysis => ({
  findings,
  conflicts: false,
  unsupportedConditions: [],
  limitations: ["Single view"],
  ...extra,
});
const assess = (
  caseType: "return" | "complaint",
  purchaseDate: string,
  assessmentDate: string,
  extra: Partial<Parameters<typeof evaluatePolicy>[0]> = {},
) =>
  evaluatePolicy({
    intake: intake(caseType, purchaseDate),
    assessmentDate,
    observations: clear(),
    ...extra,
  });

describe("pure policy rules", () => {
  it("uses the requested time zone to form an ISO date-only value", () => {
    expect(
      dateInTimeZone(new Date("2026-11-01T23:30:00.000Z"), "Europe/Warsaw"),
    ).toBe("2026-11-02");
  });

  it("rejects future purchase dates, but leaves old dates to policy review", () => {
    expect(() =>
      validateIntake({ ...intake(), purchaseDate: "2026-01-03" }, "2026-01-02"),
    ).toThrow(RangeError);
    expect(
      validateIntake(intake("return", "2025-12-01"), "2026-01-02").purchaseDate,
    ).toBe("2025-12-01");
  });

  it("classifies exact inclusive probability boundaries without rounding", () => {
    expect(labelProbability(0.15)).toBe("absent");
    expect(labelProbability(0.1500001)).toBe("uncertain");
    expect(labelProbability(0.5)).toBe("uncertain");
    expect(labelProbability(0.8499999)).toBe("uncertain");
    expect(labelProbability(0.85)).toBe("present");
    for (const p of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => labelProbability(p)).toThrow(RangeError);
  });

  it("normalizes all five findings and makes damage not assessable when prerequisites are not positive", () => {
    const observations = normalizeInitial(
      { ...clearValues, image_usable: 0.5, crack_visible: 0.1 },
      null,
    );
    expect(observations).toHaveLength(5);
    expect(
      observations.find((value) => value.id === "crack_visible"),
    ).toMatchObject({
      rawProbability: 0.1,
      usableProbability: null,
      label: "not_assessable",
      provenance: { source: "decisions", model: null },
    });
    expect(
      observations.find((value) => value.id === "image_usable"),
    ).toMatchObject({ label: "uncertain", evidence: null });
    const missing = normalizeInitial({}, null);
    expect(
      missing.every(
        (value) =>
          value.rawProbability === null &&
          value.usableProbability === null &&
          value.label === "not_assessable",
      ),
    ).toBe(true);
  });

  it("does not escalate for absent damage or missing initial narrative alone", () => {
    expect(needsDetailedAnalysis(clear())).toBe(false);
    expect(
      clear().every(
        (value) => value.evidence === null && value.limitations.length > 0,
      ),
    ).toBe(true);
  });

  it("accepts the return day-30 boundary and routes day 31 to review", () => {
    const day30 = assess("return", "2026-01-01", "2026-01-31");
    expect(day30).toMatchObject({
      status: "preliminary_recommendation",
      recommendation: "return_verification",
      blockers: [],
    });
    const day31 = assess("return", "2026-01-01", "2026-02-01");
    expect(day31).toMatchObject({
      status: "human_review_required",
      recommendation: null,
    });
    expect(day31.blockers.map((value) => value.code)).toContain(
      "outside_window",
    );
  });

  it("requires review for supported return damage without refusing the return", () => {
    const result = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: normalizeInitial(
        {
          ...clearValues,
          crack_visible: 0.85,
          dent_visible: 0.85,
          scratch_visible: 0.85,
        },
        "synthetic/decisions",
      ),
    });
    expect(result).toMatchObject({
      status: "human_review_required",
      recommendation: null,
    });
    expect(result.blockers.map((value) => value.code)).toContain(
      "return_damage",
    );
    expect(
      result.blockers.find((value) => value.code === "return_damage")
        ?.observationIds,
    ).toEqual(["crack_visible", "dent_visible", "scratch_visible"]);
    expect(result.nextSteps).toContain(
      "Have staff inspect the reported return condition.",
    );
  });

  it("uses the inclusive complaint anniversary and clamps leap day to February 28", () => {
    expect(assess("complaint", "2025-03-01", "2026-03-01")).toMatchObject({
      status: "preliminary_recommendation",
      recommendation: "service_assessment",
    });
    expect(
      assess("complaint", "2025-03-01", "2026-03-02").blockers.map(
        (value) => value.code,
      ),
    ).toContain("outside_window");
    expect(assess("complaint", "2024-02-29", "2025-02-28")).toMatchObject({
      status: "preliminary_recommendation",
      recommendation: "service_assessment",
    });
    expect(
      assess("complaint", "2024-02-29", "2025-03-01").blockers.map(
        (value) => value.code,
      ),
    ).toContain("outside_window");
  });

  it("allows a scratch only when detailed analysis gives supported visible evidence", () => {
    const uncertain = normalizeInitial(
      { ...clearValues, scratch_visible: 0.5 },
      "synthetic/decisions",
    );
    const unresolved = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: uncertain,
    });
    expect(unresolved.blockers.map((value) => value.code)).toContain(
      "evidence_unresolved",
    );
    const resolved = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: uncertain,
      detailedAnalysis: analysis([
        {
          id: "scratch_visible",
          label: "absent",
          evidence: "The visible panel has no scratch in this view.",
          limitations: ["Single view"],
        },
      ]),
    });
    expect(resolved).toMatchObject({
      status: "preliminary_recommendation",
      recommendation: "return_verification",
      blockers: [],
    });
  });

  it("keeps confident contradictions and provider blockers cumulative", () => {
    const blocker: Blocker = {
      code: "provider_failure",
      message: "Synthetic provider unavailable.",
      observationIds: [],
    };
    const contradiction = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: clear(),
      detailedAnalysis: analysis([
        {
          id: "scratch_visible",
          label: "present",
          evidence: "A scratch appears in this view.",
          limitations: [],
        },
      ]),
      blockers: [blocker],
    });
    expect(contradiction.status).toBe("human_review_required");
    expect(contradiction.blockers.map((value) => value.code)).toEqual(
      expect.arrayContaining(["provider_failure", "conflicting_evidence"]),
    );
  });

  it("keeps uncertainty when detail has no evidence and preserves explicit analysis conflicts", () => {
    const uncertain = normalizeInitial(
      { ...clearValues, scratch_visible: 0.5 },
      "synthetic/decisions",
    );
    const noEvidence = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: uncertain,
      detailedAnalysis: analysis([
        {
          id: "scratch_visible",
          label: "uncertain",
          evidence: null,
          limitations: [],
        },
      ]),
    });
    expect(noEvidence.blockers.map((value) => value.code)).toContain(
      "evidence_unresolved",
    );
    const conflict = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: clear(),
      detailedAnalysis: analysis([], { conflicts: true }),
    });
    expect(conflict.blockers.map((value) => value.code)).toContain(
      "conflicting_evidence",
    );
  });

  it("keeps an explicit unresolved detailed finding even when the initial finding was clear", () => {
    const result = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-01-15",
      observations: clear(),
      detailedAnalysis: analysis([
        {
          id: "scratch_visible",
          label: "not_assessable",
          evidence: null,
          limitations: ["Insufficient view"],
        },
      ]),
    });
    expect(result.status).toBe("human_review_required");
    expect(result.blockers.map((value) => value.code)).toContain(
      "evidence_unresolved",
    );
  });

  it("preserves outside-window and provider blockers when detailed analysis resolves uncertainty", () => {
    const uncertain = normalizeInitial(
      { ...clearValues, scratch_visible: 0.5 },
      "synthetic/decisions",
    );
    const blocker: Blocker = {
      code: "provider_failure",
      message: "Synthetic provider failure remains review-required.",
      observationIds: [],
    };
    const result = evaluatePolicy({
      intake: intake(),
      assessmentDate: "2026-02-01",
      observations: uncertain,
      detailedAnalysis: analysis([
        {
          id: "scratch_visible",
          label: "absent",
          evidence: "The visible panel has no scratch in this view.",
          limitations: [],
        },
      ]),
      blockers: [blocker],
    });
    expect(result.blockers.map((value) => value.code)).toEqual(
      expect.arrayContaining(["outside_window", "provider_failure"]),
    );
  });

  it("never refuses a complaint because of visible damage and blocks unsupported conditions or missing policy", () => {
    const complaintDamage = evaluatePolicy({
      intake: intake("complaint"),
      assessmentDate: "2026-01-15",
      observations: normalizeInitial(
        { ...clearValues, scratch_visible: 0.9 },
        "synthetic/decisions",
      ),
    });
    expect(complaintDamage).toMatchObject({
      status: "preliminary_recommendation",
      recommendation: "service_assessment",
      blockers: [],
    });
    const unsupported = evaluatePolicy({
      intake: intake("complaint"),
      assessmentDate: "2026-01-15",
      observations: clear(),
      detailedAnalysis: analysis([], {
        unsupportedConditions: [
          "Synthetic electrical fault requires judgment.",
        ],
      }),
    });
    expect(unsupported.blockers.map((value) => value.code)).toContain(
      "unsupported_condition",
    );
    const missingPolicy = assess("return", "2026-01-01", "2026-01-15", {
      policyAvailable: false,
    });
    expect(missingPolicy.blockers.map((value) => value.code)).toContain(
      "missing_policy",
    );
  });

  it("validates every returned result against the frozen public policy schema", () => {
    expect(() =>
      policyResultSchema.parse(assess("return", "2026-01-01", "2026-01-31")),
    ).not.toThrow();
    expect(() =>
      policyResultSchema.parse(assess("return", "2026-01-01", "2026-02-01")),
    ).not.toThrow();
  });

  it("loads only the versioned fictional policy and prompt for each case type", () => {
    expect(loadPolicyContent("return")).toMatchObject({
      version: "DEMO-RETURN-1.0",
      text: expect.stringContaining("30 calendar days"),
      prompt: expect.stringContaining("staff make the final decision"),
    });
    expect(loadPolicyContent("complaint")).toMatchObject({
      version: "DEMO-COMPLAINT-1.0",
      text: expect.stringContaining("12-month calendar anniversary"),
      prompt: expect.stringContaining("A fault need not be visible"),
    });
  });
});

it("preserves negative image prerequisite reasons alongside unrelated unresolved evidence", () => {
  const observations = normalizeInitial(
    { ...clearValues, image_usable: 0.1, scratch_visible: 0.5 },
    "synthetic/decisions",
  );
  const result = evaluatePolicy({
    intake: intake(),
    assessmentDate: "2026-01-15",
    observations,
  });
  expect(
    result.blockers.flatMap((blocker) => blocker.observationIds),
  ).toContain("image_usable");
  expect(
    result.blockers.flatMap((blocker) => blocker.observationIds),
  ).toContain("scratch_visible");
});
