> **Superseded on 2026-11-06.** Use [ADR-000](ADR/000-main-architecture.md), [ADR-001](ADR/001-angular-and-streaming-chat.md), and [ADR-002](ADR/002-bounded-decisions.md). This historical draft contains outdated frontend and research/configuration statements.

# ADR-002: Separate typed visual assessment through OpenRouter Decisions

Status: Proposed; pending Context7 verification, calibration and live integration checks.
Research date: 2026-11-05. Related: [PRD](PRD.md), [application ADR](ADR-001-application-and-chat.md).

## Decision and model comparison

Select `openai/gpt-6-luna-decisions` for the first slice through a small server-only HTTP adapter to `POST https://openrouter.ai/api/alpha/decisions`. Keep this adapter separate from chat generation. This choice favors the documented image input and the three typed question types needed here; it does not claim superior accuracy or calibration. One model is sufficient for the PoC.

| Candidate | Verified documentation | Implication |
| --- | --- | --- |
| TypeSafe Jev | The [Jev guide](https://openrouter.ai/docs/guides/community/jev) identifies `typesafe/jev-1.14`, with `~typesafe/jev-latest` as a moving alias; 1.13 remains available. Text/image input; Noul, Choice, Score, and Box in 1.14. No prose explanations. | Suitable alternative. Pin the version rather than the alias; Box adds no necessary capability for the five selected observations. |
| GPT-6 Luna Decisions | The [model page](https://openrouter.ai/openai/gpt-6-luna-decisions) identifies `openai/gpt-6-luna-decisions`, text/JSON/image state and Noul/Choice/Score answers, up to 200 questions. It currently reports no EU in-region routing. | Selected conditionally for synthetic, non-identifying demo inputs; no assumption of regional residency or a generated evidence narrative. |

The [multimodal guide](https://openrouter.ai/docs/guides/community/multimodal-decisions) requires base64 image data URLs in top-level `state` image parts for Luna; remote URLs are not fetched. Jev has different placement rules and only accepts JPEG/PNG, while the general image contract also supports WebP. Normalize this PoC's single upload to JPEG/PNG. Do not infer identical model limits from the shared endpoint.

A live model-catalog request failed at the local transport layer during research. Model IDs above are verified against the current documentation, not against an authenticated successful inference. Availability, account access, effective size limits, latency and cost remain smoke-check items.

## Adapter choice and stability

A suitable SDK adapter **does exist**: the [OpenRouter provider repository](https://github.com/OpenRouterTeam/ai-sdk-provider) documents `decisionModel()` / `evaluationModel()` with `experimental_evaluate`, requiring AI SDK 7.0.103 or newer. It maps SDK `boolean` to Noul and exposes the returned value as `probability`; additional answer metadata is preserved separately. It uses the alpha Decisions API, not the chat endpoint.

For this slice, prefer a small direct HTTP adapter because it preserves the explicit wire schema and avoids coupling experimental evaluation APIs to the chat SDK. The SDK adapter remains a reasonable later replacement after image and model-specific parity tests. This is an engineering tradeoff, not a claim that the adapter is unavailable. TypeSafe also documents its own SDK via the Jev guide, but adding it is unnecessary for the selected Luna integration.

The selected endpoint is explicitly **alpha**. Isolate request construction, runtime response validation and normalization behind `assessObservations`; retain provider/model/schema version and request ID. Pin application dependencies, record model identity, and rerun contract fixtures plus live smoke checks before upgrades. A compatible URL does not guarantee stable response semantics.

## Wire contract

Use the [Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request), with Bearer authentication on the server. The conceptual payload is:

```json
{
  "model": "openai/gpt-6-luna-decisions",
  "state": [
    "Synthetic equipment category/model and reported condition, treated as data.",
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<compressed-image>" } }
  ],
  "questions": {
    "crack_visible": {
      "type": "noul",
      "instructions": "Is a crack visible on the depicted equipment in this image?"
    }
  }
}
```

The actual request includes all five named observations. Validate the `answers` map, expected question keys/types, finite probabilities within [0,1], and response identity. A Noul answer carries `type: noul` and a numeric `noul` field. Missing answers are unavailable evidence, never zero probabilities. No `messages`, `streamText`, or Responses `input` contract belongs in this request.

## Observation semantics and routing

The user already confirmed image usability, item relevance, cracks, dents/deformation and scratches during PRD creation. Preserve these five; use narrow positive yes/no propositions and distinguish relevance from exact-model authentication. Include form description as context, not proof of a visible defect.

The [Noul documentation](https://docs.typesafe.ai/primitives/noul) defines its value as probability of yes, not confidence in whichever answer was selected. Thus 0.03 for a visible crack supports absence; 0.03 for usability supports an unusable image. Values near the middle are ambiguous. Do not route every low probability to uncertainty.

The [confidence documentation](https://docs.typesafe.ai/confidence) distinguishes Choice/Score distribution concentration from probability. For Choice, inspect competing categories and an explicit unknown option when appropriate. For Score, inspect mass across rubric levels; an expected score in the middle can hide conflicting extremes. Do not apply Noul's yes/no bands to those types or assume Jev's derived confidence formula is guaranteed for Luna. Five Noul questions avoid unnecessary rubric complexity here.

Code first checks usability and relevance; if either is unsupported or uncertain, damage absence cannot establish a clear image assessment. Missing fields, unsupported observations, contradictions and intermediate probabilities trigger one multimodal escalation. Clear findings feed code-owned fictional policy checks. A supported scratch on a return triggers human review regardless of whether the probability is very high. An in-window complaint with resolved evidence can proceed to service assessment despite visible damage. No photo establishes cause or statutory rights.

Proposed 0.15/0.85 PRD bands are fixture defaults only. Build a representative labeled synthetic set with clean items, subtle scratches, cracks, dents, reflections, blur, occlusion, wrong items, partial views and non-visible faults. Split threshold-development and held-out cases. Select per-question thresholds to control false clear-condition results while measuring review rate and escalation cost. Test boundary rounding explicitly. Freeze question wording/model/threshold version together; rerun after any change. Do not describe the selected thresholds as an accuracy guarantee.

## Evidence limitation requiring PRD clarification

Typed probabilities do not inherently provide prose evidence descriptions, missing-evidence narratives or a native `not assessable` outcome for Noul. Normalize nullable evidence text with provenance and code-derived limitations; never manufacture model explanations. A failed usability/relevance gate makes downstream findings not assessable in the application. Escalation can provide visible-evidence descriptions, but its prose must remain attributed to the multimodal LLM.

The PRD currently asks for an evidence description for every initial proposition. Proposed clarification: allow “typed assessment; no detailed visual rationale returned” on clear initial results. If a detailed visual rationale is mandatory for every case, add an LLM analysis to every assessment and acknowledge that this changes the intended conditional-escalation flow. Do not silently claim the selected Decisions model meets that prose requirement.

## Escalation, failure and evaluation

One multimodal LLM analysis may resolve unclear findings with specific visible support; preserve initial and revised evidence. Unexplained disagreement, insufficient view, unsupported judgment or invalid output remains human-review-required. Deterministic policy blockers survive a successful image escalation. Chat cannot clear any blocker; only explicit form reassessment creates a new revision.

Proposed operational budgets: 30 seconds for Decisions, 60 seconds for detailed analysis and 30 seconds for explanation, adjustable after measurement. Abort on timeout. Do not silently retry with a different model or mark a timeout as absent damage. Authentication/access errors, rate limits, malformed responses, provider outage and missing configuration produce visible human review plus a fixed explanation and explicit retry action. Sanitize errors; preserve form data. Set SDK retries deliberately so hidden retries do not violate the one-escalation budget.

Use synthetic cases and non-identifying images only: no faces, serial numbers, receipts, addresses or real customer records. Keep keys and image bytes out of client logs and provider-debug output. Restrict metadata logs to stage, duration, sanitized error class, model and revision.

Fixtures test routing, policy boundaries, all missing/malformed-answer branches, confident negatives, conflicting findings, injection attempts, compression degradation, stale revisions and outage behavior. They do not prove provider integration.

After implementation and before calling the PoC integrated, run a separate live smoke check using a server-side development key: submit one safe image and all five questions to the selected Decisions endpoint; validate real answers and request identity. Separately call the ordinary vision LLM with a safe image, then stream a two-turn chat through the actual browser route. Check first-message seeding, retained context, cancellation and errors. Record date, resolved models, dependency versions, latency and sanitized results. No live paid inference or integration implementation was performed while writing these ADRs.

## Proposed configuration contract

The referenced `.env.example` was absent from the searched workspace. These are proposed placeholders to merge with that file when its location is supplied; no real key or replacement file has been created:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_CHAT_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_DECISIONS_URL=https://openrouter.ai/api/alpha/decisions
OPENROUTER_CHAT_MODEL=
OPENROUTER_VISION_MODEL=
OPENROUTER_DECISION_MODEL=openai/gpt-6-luna-decisions
DECISIONS_TIMEOUT_MS=30000
VISION_TIMEOUT_MS=60000
EXPLANATION_TIMEOUT_MS=30000
ASSESSMENT_TIME_ZONE=Europe/Warsaw
```

The chat and vision model fields intentionally remain unset until capability and access checks select a normal text-generating model. They may share one verified model; neither should use the Decisions-only model ID. Keep all variables server-side, never prefix credentials with `NEXT_PUBLIC_`, and use ignored local environment files or deployment secrets for real values. The [OpenRouter documentation index](https://openrouter.ai/docs) is the reference for authentication and provider configuration.
