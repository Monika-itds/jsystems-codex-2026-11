# GitHub sync verification

Date: 2026-11-06. Scope: publish remaining local application changes, planning documents, repository instructions, configuration and third-party notices to `App-Implementation` and PR #1.

## Checks

| Check | Result |
| --- | --- |
| `npm --prefix web run test:unit` | 40 tests passed in 6 files; no skips reported |
| `npm --prefix api run test:unit` | 104 tests passed in 9 files; no skips reported |
| Both `typecheck` scripts | Passed |
| `npm --prefix api run lint` | No errors; 5 warnings in unchanged API files |
| `npm --prefix web run build` | Passed; 914.16 kB initial bundle exceeds the 500 kB warning budget; CommonJS warning for `@vercel/oidc` via `@ai-sdk/gateway` |
| `npm --prefix web run dev` | Started successfully at `http://127.0.0.1:4200/` |
| Real Chrome smoke check through Playwright CLI | Entered a synthetic equipment name, clicked Start new case and verified the input became empty |
| Browser console | No errors; NG0956 warning about recreating the one-element intake view on reset |
| Visual check | Opened and checked [the intake screenshot](sync-intake.png); this is limited smoke evidence, not full design acceptance |

No API server, provider calls or full intake-to-result-to-chat E2E were run during this sync. API production build was not rerun; API runtime source was unchanged in this pending diff. Previous checklist items about absent scaffolding and pending initial plan approval are historical, not the current application state.

## Independent review findings still open

A read-only Terra review of pending changes identified these frontend edge cases. They are recorded rather than silently treated as fixed while publishing the requested snapshot:

1. Starting a new case before an initial assessment response establishes a case ID can abort locally without deleting the server case. An interrupted server case may retain evidence until expiry.
2. A failed case DELETE switches the UI to intake while preserving the old result in memory, leaving no direct control to reopen it.

These findings, the reset warning, live provider smoke checks, full flow manual QA and final human acceptance remain pending. Passing synthetic tests does not establish a completed provider integration or a release-ready application.
