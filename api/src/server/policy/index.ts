import {
  advisory,
  dateSchema,
  detailedAnalysisSchema,
  intakeSchema,
  observationIds,
  observationsSchema,
  policyResultSchema,
  type Blocker,
  type DetailedAnalysis,
  type Intake,
  type Observation,
  type ObservationId,
  type PolicyResult,
} from "../contracts";

const damageIds = ["crack_visible", "dent_visible", "scratch_visible"] as const;
const limitations = [
  "Typed visual assessment; this provider did not return a visual rationale.",
  "A single image cannot establish hidden damage, functionality, ownership, damage cause or legal eligibility.",
];

export function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day)
    throw new RangeError(
      "Could not form an assessment date in the requested time zone",
    );
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

export function validateIntake(input: unknown, assessmentDate: string): Intake {
  const intake = intakeSchema.parse(input);
  const date = dateSchema.parse(assessmentDate);
  if (intake.purchaseDate > date)
    throw new RangeError("Purchase date cannot be in the future");
  return intake;
}

export function labelProbability(
  probability: number,
): "present" | "absent" | "uncertain" {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new RangeError("Probability must be finite and between 0 and 1");
  return probability >= 0.85
    ? "present"
    : probability <= 0.15
      ? "absent"
      : "uncertain";
}

export function normalizeInitial(
  values: Partial<Record<ObservationId, number | null>>,
  model: string | null,
): Observation[] {
  const raw = new Map<ObservationId, number | null>();
  for (const id of observationIds) {
    const value = values[id];
    raw.set(
      id,
      typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
        ? value
        : null,
    );
  }
  const prerequisitesPositive = (
    ["image_usable", "item_consistent"] as const
  ).every((id) => raw.get(id) !== null && raw.get(id)! >= 0.85);

  return observationIds.map((id) => {
    const rawProbability = raw.get(id) ?? null;
    const usableProbability =
      damageIds.includes(id as (typeof damageIds)[number]) &&
      !prerequisitesPositive
        ? null
        : rawProbability;
    const assessable = usableProbability !== null;
    return {
      id,
      rawProbability,
      usableProbability,
      label: assessable
        ? labelProbability(usableProbability)
        : "not_assessable",
      provenance: {
        source: rawProbability === null ? "code" : "decisions",
        model: rawProbability === null ? null : model,
      },
      evidence: null,
      limitations:
        rawProbability === null
          ? [
              ...limitations,
              "No usable probability was returned for this observation.",
            ]
          : [...limitations],
    };
  });
}

export function needsDetailedAnalysis(observations: Observation[]): boolean {
  return (
    observations.some(
      (observation) =>
        observation.label === "uncertain" ||
        observation.label === "not_assessable",
    ) ||
    (["image_usable", "item_consistent"] as const).some(
      (id) =>
        observations.find((observation) => observation.id === id)?.label !==
        "present",
    )
  );
}

function addBlocker(
  blockers: Blocker[],
  code: Blocker["code"],
  message: string,
  observationIds: ObservationId[] = [],
): void {
  if (
    !blockers.some(
      (blocker) =>
        blocker.code === code &&
        blocker.observationIds.join("|") === observationIds.join("|"),
    )
  ) {
    blockers.push({ code, message, observationIds });
  }
}

function addCalendarDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addCalendarMonthsClamped(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = (((targetMonthIndex % 12) + 12) % 12) + 1;
  const leapYear =
    targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0);
  const lastDay = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][normalizedMonth - 1];
  return `${String(targetYear).padStart(4, "0")}-${String(normalizedMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function nextStepFor(blocker: Blocker): string {
  switch (blocker.code) {
    case "outside_window":
      return "Have staff review the policy exception and applicable rights.";
    case "evidence_unresolved":
      return "Have staff inspect the item or request clearer evidence.";
    case "provider_failure":
      return "Retry explicitly or have staff review the case.";
    case "return_damage":
      return "Have staff inspect the reported return condition.";
    case "conflicting_evidence":
      return "Have staff resolve the conflicting visual findings.";
    case "unsupported_condition":
      return "Have staff assess the condition outside the supported visual criteria.";
    case "missing_policy":
      return "Restore the fictional policy input, then reassess.";
    case "explanation_failure":
      return "Use the structured result and have staff review the case.";
    case "interrupted":
      return "Retry the assessment explicitly or have staff review the case.";
    case "compression_warning":
      return "Request a clearer image and reassess.";
  }
}

export function evaluatePolicy(input: {
  intake: Intake;
  assessmentDate: string;
  observations: Observation[];
  detailedAnalysis?: DetailedAnalysis | null;
  blockers?: Blocker[];
  policyAvailable?: boolean;
}): PolicyResult {
  const intake = intakeSchema.parse(input.intake);
  const assessmentDate = dateSchema.parse(input.assessmentDate);
  const observations = observationsSchema.parse(input.observations);
  const detailed =
    input.detailedAnalysis == null
      ? null
      : detailedAnalysisSchema.parse(input.detailedAnalysis);
  const blockers: Blocker[] = [
    ...(input.blockers ?? []).map((value) => ({
      ...value,
      observationIds: [...value.observationIds],
    })),
  ];

  const endDate =
    intake.caseType === "return"
      ? addCalendarDays(intake.purchaseDate, 30)
      : addCalendarMonthsClamped(intake.purchaseDate, 12);
  if (assessmentDate < intake.purchaseDate || assessmentDate > endDate) {
    addBlocker(
      blockers,
      "outside_window",
      `Purchase date is outside the fictional ${intake.caseType} window ending ${endDate}.`,
    );
  }
  if (input.policyAvailable === false)
    addBlocker(
      blockers,
      "missing_policy",
      "The fictional policy input is unavailable.",
    );

  const resolved = new Map(
    observations.map((observation) => [observation.id, observation.label]),
  );
  const initialById = new Map(
    observations.map((observation) => [observation.id, observation]),
  );
  const detailsById = new Map(
    detailed?.findings.map((finding) => [finding.id, finding]) ?? [],
  );

  for (const finding of detailsById.values()) {
    const initial = initialById.get(finding.id)!;
    if (
      (initial.label === "present" || initial.label === "absent") &&
      (finding.label === "present" || finding.label === "absent") &&
      initial.label !== finding.label
    ) {
      addBlocker(
        blockers,
        "conflicting_evidence",
        `Detailed analysis conflicts with the initial ${finding.id} finding.`,
        [finding.id],
      );
    }
    if (
      (finding.label === "present" || finding.label === "absent") &&
      finding.evidence?.trim()
    )
      resolved.set(finding.id, finding.label);
    else resolved.set(finding.id, finding.label);
  }

  if (detailed?.conflicts)
    addBlocker(
      blockers,
      "conflicting_evidence",
      "Detailed analysis reports conflicting visual evidence.",
    );
  if (detailed?.unsupportedConditions.length)
    addBlocker(
      blockers,
      "unsupported_condition",
      "Detailed analysis reports a condition outside the supported visual criteria.",
    );

  const unresolved = observations
    .filter((observation) => {
      const label = resolved.get(observation.id);
      return label === "uncertain" || label === "not_assessable";
    })
    .map((observation) => observation.id);
  if (unresolved.length)
    addBlocker(
      blockers,
      "evidence_unresolved",
      "One or more required visual findings remain uncertain or not assessable.",
      unresolved,
    );

  const prerequisitesPositive = (
    ["image_usable", "item_consistent"] as const
  ).every((id) => resolved.get(id) === "present");
  if (!prerequisitesPositive) {
    const failed = (["image_usable", "item_consistent"] as const).filter(
      (id) => resolved.get(id) !== "present",
    );
    addBlocker(
      blockers,
      "evidence_unresolved",
      "The image is not confirmed as usable and relevant.",
      [...failed],
    );
  }

  if (intake.caseType === "return" && prerequisitesPositive) {
    const damage = damageIds.filter((id) => resolved.get(id) === "present");
    if (damage.length)
      addBlocker(
        blockers,
        "return_damage",
        "Visible damage on a return requires human review.",
        [...damage],
      );
  }

  if (blockers.length > 50)
    throw new RangeError("Policy result exceeds the frozen blocker limit");
  const uniqueBlockers = blockers;
  const result = {
    status: uniqueBlockers.length
      ? ("human_review_required" as const)
      : ("preliminary_recommendation" as const),
    recommendation: uniqueBlockers.length
      ? null
      : intake.caseType === "return"
        ? ("return_verification" as const)
        : ("service_assessment" as const),
    blockers: uniqueBlockers,
    nextSteps: uniqueBlockers.length
      ? [...new Set(uniqueBlockers.map(nextStepFor))]
      : [
          intake.caseType === "return"
            ? "Staff verify the synthetic return case."
            : "Staff determine the appropriate service assessment.",
        ],
    advisory,
  };
  return policyResultSchema.parse(result);
}
