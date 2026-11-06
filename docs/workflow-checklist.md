# Requested Workflow Checklist

**Date:** 2026-11-06. Earlier planning entries below are historical. The implementation execution record directly below tracks current progress; planning evidence is not application QA.

## Implementation execution record

- GitHub sync verification on 2026-11-06: current web tests 40/40 (6 files), API tests 104/104 (9 files), both typechecks passed; API lint had 0 errors and 5 warnings in unchanged files. Web production build passed with bundle-budget and CommonJS warnings. Frontend startup and a real Chrome intake reset smoke check passed; see [sync verification](qa/sync-verification.md). Live provider checks, full flow QA and final acceptance remain pending. This sync publishes work in progress, not a declaration that C0-C12 is complete.

- C0: The user explicitly requested implementation of the canonical plan, approving its local-only slice, scaffold adaptation, worker/invocation limits and US$5 evaluation cap (US$1 smoke ceiling). Publication/merge and final human acceptance remain separate.
- A fresh independent `gpt-6.1-terra` review of AGENTS/PRD/current ADRs/plan found no substantive contradiction blocking C1/C2. The prior MiMo review remains incomplete and is not counted as a pass.
- Baseline rechecked: no application manifests or application source; Node v24.22.1, npm 11.19.1. Existing unrelated changes preserved. No secrets inspected.
- C1 shells/config implemented. Luna generated Angular/Material and Next shells; coordinator finished after its extended timebox. Exact dependencies pinned in per-app lockfiles. Synthetic config tests first failed for the missing module, then 4 passed. Web shell test passed. Both production builds passed; a generated Next cache setting conflicting with explicit Node routes was removed. No real config loader or provider call was invoked by agents.
- C1 runtime: API session 42767 at `http://127.0.0.1:3000`, web session 98173 at `http://127.0.0.1:4200`. Direct and proxied `/api/health` both returned only sanitized health data with HTTP 200; shell HTTP 200. These handles require revalidation before reuse. Manual visual check is pending: browser connector unavailable, native Chrome binding stopped on URL-confidence enforcement. HTTP evidence is not being counted as visual evidence.
- C2 complete: frozen server schemas and explicit frontend DTO, complete synthetic result/event example, probability/date/enum/unknown-field/partial-resolution/event-identity tests, sanitized error mapping, bidirectional frontend/server type checks. Twelve API tests and TypeScript passed. Independent Terra review passed after one corrective cycle. C6 must normalize unsupported detailed claims to unresolved; C7 owns event sequencing and one terminal result.
- C3 policy implemented with boundary and cumulative-blocker tests. Independent review found missing prerequisite reasons and weak policy-content checks; coordinator added failing fixtures and fixes. C3/C6 focused checks currently pass 36 tests together; independent recheck pending. C5 images/sessions correction and trust review are in progress.
- C4 MiMo intake invocation timed out after 600.4 seconds with no final report or intake files. No automatic retry, provider or billing change. Harness step-cost telemetry reported zero; actual billing is unknown. See [execution record](research/mimo-intake-execution.md). Coordinator escalated the same bounded UI brief to Luna.
- C6 separate Decisions/ordinary-model adapters implemented by Terra under protocol/SDK complexity escalation. Tests use injected synthetic responses only. Independent review identified optional usage metadata and post-header transport classification defects; coordinator fixed both with failing fixtures. Live model identity, metadata and SDK/provider compatibility remain unverified. No live integration is claimed.
- C7 assessment lifecycle implemented with 22 orchestration tests (progress, immutable result, one escalation, grounded first message, abort/deadline/stale checks). Review fixes landed; independent recheck passed for reported findings and added coverage. Live browser and provider smoke checks remain pending.
- C8 assessment view implemented in `web/src/app/assessment-view/`; focused suite 7/7 and Angular build green. Visible result, blockers, observations, limitations, model/version and revision status outside chat.
- Codex quota limit hit mid-run on 2026-11-06 after C7/C8 work; work continued in OpenCode with the coordinator (Sol role) executing sequentially under the plan's mechanism-failure clause. Worker substitution disclosed: OpenCode implementation subagents replace the unavailable Codex Luna/Terra workers; independent review and human acceptance remain required.
- C9 revision-bound chat route implemented in `api/src/server/chat/` plus `api/src/app/api/chat/route.ts` under the frozen `.agent-briefs/c9.md` brief (OpenCode worker, coordinator-verified). Red->green: 11 failing tests first, then green; 12 chat behavior tests total. Focused suite 12/12, full API suite 104/104, typecheck clean. Plan-generated buffered validation before trusted UI stream; no assessment mutation on conversational failures; stable-id idempotency/interruption semantics covered. No live integration is claimed.
- C1-C8 work committed as per-task slices on branch `App-Implementation` (coordinator Git writes only): scaffold, tooling configs, contracts, policy, intake, images/sessions, providers, assessment, result view.
- C10 client integration brief frozen at `.agent-briefs/c10.md`; worker executed with one corrective cycle (test-scaffolding only). Red->green: 18 new tests failed first for expected reasons, then 35/35 web tests green across 3 consecutive runs; typecheck and build clean (known `@ai-sdk/gateway` CommonJS and 908 kB bundle-size warnings, out of scope). Committed as `C10 Client` slice. Findings recorded: `GET /api/assessments/[caseId]` is a JSON snapshot, not an event stream (the POST is the event stream); the AI SDK transport clobbers a custom `messageId` body field, resolved with `prepareSendMessagesRequest` rebuilding the exact allowed envelope. Chat mounts only for completed results; one Chat per revision with dispose/abort; results are replaced only from server events. Manual keyboard/narrow-screen browser run remains PENDING: the repo's Playwright MCP is disabled in `.mcp.json` and no Playwright package is installed; a network install was not authorized. Build/unit passes are not being counted as startup or visual evidence.

### Verified command registry

Run from repository root using the explicit prefix (there is no root package manifest):

| Label | Actual command |
| --- | --- |
| V-web-build | `npm --prefix web run build` |
| V-api-build | `npm --prefix api run build` |
| V-unit | `npm --prefix api run test:unit` and `npm --prefix web run test:unit` |
| V-typecheck | `npm --prefix api run typecheck` and `npm --prefix web run typecheck` |
| V-api-lint | `npm --prefix api run lint` |
| V-start-web | `npm --prefix web run dev` |
| V-start-api | `npm --prefix api run dev` |
| V-browser | Not registered yet; browser test runner/manual acceptance remains pending |

| Requested item | Result and evidence |
| --- | --- |
| Context7 before web | Added to root AGENTS.md. Resolve then query; use web only for a documented gap or an explicitly requested source. Local code remains the authority for repository behavior. |
| CLI built-in help first | Added to AGENTS.md. Verified installed `opencode --help`, `opencode run --help`, `opencode models --help` and `codex --help`; OpenCode invocation needs no web-derived syntax. |
| Research agent during ADR | Completed with `gpt-6.1-terra` worker `adr_research_review`; read PRD and all current ADRs, identified the rationale-contract mismatch and failure-routing/streaming/starter caveats. Standing ADR instruction added. |
| Desktop questions | Structured question was displayed and the user's selected answer returned to this chat. The user accepted nullable initial rationale and conditional detailed LLM analysis. This confirms the question-panel round trip in this Desktop chat. |
| Separate named Question mode / CLI comparison | Not independently verified. This chat remained in Default collaboration mode and used the asynchronous question tool; no mode-switch test or side-by-side CLI comparison was performed. Do not label the panel test as proof of every product mode. |
| Multi-agent plan with Luna and Terra | Created docs/plan.md using `gpt-6-luna` outline worker and Terra research review. The orchestrator assigns implementation workers by complexity and exclusive file ownership; no application implementation tasks were started. |
| OpenCode/MiMo delegation | One explicit headless review invocation used `xiaomi-token-plan-ams/mimo-v2.6-flash`, stopped at 120 seconds with exit 124 and no final report. No retry/fallback; cost unknown. Review incomplete. See [execution record](research/mimo-plan-review.md). |
| PRD/ADR/Plan consistency review | Research findings incorporated: accepted rationale exception and A21; malformed-output versus unavailable-provider paths; explicit buffered streaming; starter adaptation; 10-20 evaluation cases and local memory limits. Independent Terra review passed for the earlier plan after corrections. The current [C0-C12 draft](plans/hardware-assessment-chat-implementation-plan.md) now also passed a fresh independent Terra AGENTS/PRD/ADR/Plan review after baseline, secret-access, synthetic loader-test, evidence-sanitization and punctuation fixes; see the [review record](research/agents-prd-adr-plan-consistency-review.md). Human approval remains pending; the MiMo timeout is not counted as a review pass or app QA. |
| Optional removal of Polish-only instruction | No Polish-only instruction exists in the root AGENTS.md; no removal needed. Existing tone and brevity preferences preserved. |

## Review findings and corrections

1. **Initial evidence contract:** PRD formerly required written evidence for every initial finding; typed Decisions return probabilities without prose. The user explicitly accepted missing initial rationale through the Desktop panel. PRD section 6.2 and A21 now record that decision; ADR-002 and the plan agree. No provider explanation or abstention is invented.
2. **Provider failures:** malformed/missing typed answers trigger at most one detailed analysis but retain a provider-failure review blocker. Authentication/transport/outage/timeout/missing configuration requires review directly. Later chat errors do not rewrite a completed assessment. PRD A08/A13 and the plan now state the same behavior as the ADR.
3. **Starter completeness:** the official Angular example supplies a basic chat UI/streaming client and Express sample. Angular Material, Next.js routes, OpenRouter and Decisions still require explicit implementation; source inspection is not an integration smoke test.
4. **Stream claim:** answer-bearing generation may be buffered for validation and only then delivered through the AI SDK UI stream. Neither the ADR nor plan promises immediate unchecked provider tokens.
5. **Threshold authorization:** version-1 routing and acceptance boundaries remain 0.15/0.85. Candidate thresholds are offline research only; active changes require product approval, versioned PRD/ADR/fixtures and fresh held-out evaluation. A false-clear live route blocks a clean-condition demo; a restricted review-only demo is not full acceptance.
6. **Evaluation limits:** target 20 cases within the accepted 10-20 range; record actual count, coverage and held-out split. Clear results on the five criteria do not prove that every unsupported condition is absent or that probabilities are calibrated.

7. **Vision terminology:** the separate ordinary-model smoke check verifies image input/vision, not image generation.
8. **Evaluation timing:** representative live threshold evaluation happens before demo acceptance, after the provider integration exists; it is not a prerequisite to writing implementation code.

## Remaining gates

- The current AGENTS/PRD/ADR/C0-C12 Plan review passed under the latest language/data rules after corrections and an independent Terra recheck. Human plan approval remains required before execution; the separate MiMo attempt still timed out.
- User plan approval must cover the local-only assumption, scaffold adaptation and proposed evaluation budget. A passed document review does not authorize app initialization.
- Actual dependency resolution/builds and all three live smoke paths are future implementation work. Fixtures, CLI help and model names do not establish successful paid-provider access.
- If a separate named Question/Plan mode must be tested, explicitly select that mode in Desktop and run another question round trip; the current test did not switch collaboration modes. Context7's [request_user_input handler reference](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input.rs) confirms that availability depends on the active collaboration mode, so CLI help alone cannot settle the Desktop UI behavior.


## Current planning handoff

The canonical [draft](plans/hardware-assessment-chat-implementation-plan.md) now uses one C0-C12 dependency matrix, Luna/MiMo bounded coding and test work, Sol decision and acceptance authority, explicit provider/time/invocation limits, durable just-in-time briefs, coordinator-only Git writes, and a human approval gate. The local baseline has no app manifests, entry points or tests; no application baseline pass is claimed. The new draft and brief links/row counts/whitespace were checked. Actual MiMo review output remains unavailable after the bounded attempt.


## Latest guidance consistency review

The current [four-document review](research/agents-prd-adr-plan-consistency-review.md) passed after corrections and independent recheck. Real credential access is confined to human/isolated application runtime, while agents use synthetic inputs and sanitized evidence. C1 now owns synthetic loader tests; no secret files were inspected. The plan still requires human approval before initialization. Earlier review passes and the timed-out MiMo attempt are not application QA.
