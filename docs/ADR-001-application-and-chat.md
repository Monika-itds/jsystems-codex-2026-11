> **Superseded on 2026-11-06.** Use [ADR-000](ADR/000-main-architecture.md), [ADR-001](ADR/001-angular-and-streaming-chat.md), and [ADR-002](ADR/002-bounded-decisions.md). This historical draft contains outdated frontend and research/configuration statements.

# ADR-001: Application shell, streaming chat, and assessment orchestration

Status: Proposed; implementation requires plan approval. Research date: 2026-11-05.
Source requirements: [PRD](PRD.md). Related decision: [ADR-002](ADR-002-bounded-decisions.md).

## Decision

Use a minimal Next.js App Router application with strict TypeScript, AI SDK v7, the OpenRouter provider, and assistant-ui's current AI SDK runtime. Keep the assessment pipeline in application services with explicit states; do not introduce an autonomous agent framework. Select one ordinary vision-capable conversational model through configuration, subject to a live capability check, for both escalation and conversation. The Decisions model is configured independently.

The current [AI SDK documentation](https://ai-sdk.dev/docs) identifies v7, and the [repository](https://github.com/vercel/ai) is the upstream source. Resolve and pin mutually compatible released package versions before implementation rather than copying old API examples.

## Alternatives and rationale

| Option | Fit and decision |
| --- | --- |
| AI SDK plus OpenRouter provider | Selected: standard server generation and client stream transport, while retaining our form and deterministic workflow. The [OpenRouter integration guide](https://openrouter.ai/docs/guides/community/vercel-ai-sdk) documents `createOpenRouter` and `streamText`. |
| Chat SDK at chat-sdk.dev | The [current site](https://chat-sdk.dev/) describes a cross-platform bot SDK for services such as Slack and Teams, not the ready-made web chat template described in the request. Those adapters are unnecessary here. Do not initialize from this URL under the assumption it is a Next.js chat starter. |
| Direct OpenRouter Responses API | Viable, but adds protocol handling without a required feature benefit. The [current Responses documentation](https://openrouter.ai/docs/api_reference/responses/overview) says it is stateless: send full history; `store: true` and non-null `previous_response_id` are rejected. It is not the Decisions endpoint or the browser UI stream protocol. |
| AI SDK UI alone | Its `useChat` hook handles conversation state and transport, but visual components still need to be supplied. |
| AI Elements | Good composable streaming components, but the [current site](https://elements.ai-sdk.dev/) announces migration to shadcn/ui and deprecation at the end of November 2026. Avoid starting on that retiring distribution. |
| assistant-ui | Selected for ready chat primitives and streaming runtime; keep intake and assessment cards custom. The [runtime matrix](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview) pairs `ai@^7` and `@ai-sdk/react@^4` with `@assistant-ui/ai-sdk`. Cloud persistence is unnecessary. |

## Initialization after approval

From the workspace root, create a new application directory; preserve the existing documentation:

```powershell
npx create-next-app@latest hardware-service-copilot --ts --eslint --tailwind --app --src-dir --use-npm --import-alias "@/*"
```

These flags are documented by [create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app). Verify `compilerOptions.strict: true` in the generated configuration. Choose a supported Node runtime compatible with the resolved dependencies. Install AI SDK, its React binding, the OpenRouter provider, assistant-ui runtime/components, schema validation, and an image processing library only after approval. Lock versions and record them in the implementation PR. Do not initialize a full chat template carrying authentication, databases, or upload infrastructure that this PoC defers.

## Components and routes

| UI / endpoint | Responsibility |
| --- | --- |
| `IntakeForm` | Required fields, complaint-specific reason, one image preview, edit and submit. |
| `POST /api/assessments` | Multipart validation; create assessment ID and revision; start bounded processing. Return a recoverable validation error before any model call when invalid. |
| `GET /api/assessments/:id` | Return stage, immutable current result, blockers, and first message when ready. Poll during processing to show actual progress. |
| `AssessmentStatus` and `EvidenceDetails` | Display code-owned status, probabilities with their meaning, missing evidence, policy version, revision, and escalation provenance outside chat. |
| `POST /api/chat` | Validate assessment/revision and messages; load trusted context; generate ordinary conversation. Never invoke Decisions or modify policy outcome. |
| assistant-ui thread/composer | Streaming message rendering, stop/retry/error states, accessible interaction. Disable composer until initial assessment and first message are ready. |

For this local demo, run a single long-lived Node process with a bounded, expiring in-memory session store and session-bound opaque identifiers. Background assessment work must remain in that process; do not deploy this design unchanged to ephemeral serverless functions. Restart or expiry visibly requires reassessment. SQLite persistence, distributed jobs, and durable histories remain deferred.

The server validates file bytes, decoded dimensions, size and count, then strips metadata and compresses to JPEG/PNG before either image provider. Bound decoded pixel count to prevent excessive resource use. Retain only compressed evidence for the active session and delete it on expiry. Use the PRD's provisional size targets, with a test for detail lost during compression.

Server processing order: validation → image preparation → Decisions assessment → at most one multimodal escalation → deterministic policy evaluation → initial explanation → chat. Check dates in calendar arithmetic using Europe/Warsaw and preserve the PRD's inclusive boundaries and leap-day rule. Load separate versioned complaint/return policies and prompts from server files. Missing policies block the recommendation.

## Streaming and multimodal integration

Use `useChat` with `DefaultChatTransport` targeting `/api/chat`; connect that chat instance to the assistant-ui runtime rather than creating two independent histories. Follow the [current assistant-ui v7 integration](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v7).

The current [AI SDK chatbot pattern](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot) converts validated UI messages with `convertToModelMessages`, calls `streamText`, then returns `createUIMessageStreamResponse` around `toUIMessageStream({ stream: result.stream })`. Render message parts; support submitted, streaming, ready, and error states. Do not forward raw OpenRouter SSE directly to `useChat`.

For escalation, construct model messages containing text and the compressed image using the current SDK's multimodal file content format; see [AI SDK prompts](https://ai-sdk.dev/docs/foundations/prompts). This is a different serialization from Decisions `state` parts. Use schema-validated escalation output with resolved labels, visible evidence, limitations and unresolved conflicts. Invalid output remains unresolved.

The first explanation needs a release gate: buffer generation, check structured facts/status and allowed observation references, and render its recommendation/status/next steps from trusted templates. Fall back to a fixed message on conflict. Seed the resulting assistant message into the same chat history. Never display unvalidated assessment conclusions token by token. Follow-up explanatory text can stream, but any response presenting a new recommendation or changing assessed facts must be buffered and validated instead. A regex cannot prove arbitrary prose is grounded; constrain consequential wording to templates and never grant the model a status-changing tool.

Every request supplies trusted form data, initial typed results, escalated analysis, current revision, policy version/text, first message and full session history. Treat client data as untrusted; server session state owns assessment facts and history. Prevent stale revisions and duplicate message submission. If full context no longer fits, report the limitation instead of silently truncating evidence. Cancel upstream generation on stop when supported. A failed stream is visibly incomplete, never a new successful recommendation.

## Configuration and outstanding research

The requested `.env.example` was not found under `D:/labuser`; no existing contract could be reconciled. Proposed names are in ADR-002. Obtain its intended location before implementing configuration, preserving any existing names rather than silently replacing them.

The Context7 skill was read, but no `resolve-library-id` or `query-docs` tool is exposed in this session. The required Context7 verification is incomplete. Before approval is treated as implementation-ready, resolve **Vercel AI SDK** by name, then query the returned ID separately for v7 streaming, multimodal input, and evaluation models. Record the actual returned library ID and version; no ID is assumed here. `$write-adr` was also not found in the available local skill locations. These ADRs use a conventional decision-record format.

## Verification before delivery of the application

Run strict type checking, build, deterministic policy boundary tests, and the PRD acceptance scenarios. Exercise real UI streaming, stop/retry, assessment progress, expiry, stale revisions, image compression, injected instructions, provider errors, and blocked recommendations. Perform the separate paid-provider smoke checks in ADR-002 after implementation; mocks alone do not demonstrate either integration.
