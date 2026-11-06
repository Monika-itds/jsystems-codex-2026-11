# AGENTS, PRD, ADR and Plan Consistency Review

Date: 2026-11-06. Reviewer: independent `gpt-6.1-terra` subagent `guidance_document_consistency_review`.

**Result: passed after corrections and independent recheck.** This is the current review under the English-only, ASCII-punctuation and synthetic-data rules. Earlier review records describe earlier document versions.

## Sources reviewed

- [AGENTS.md](../../AGENTS.md)
- [PRD](../PRD.md), including A01-A21
- [ADR-000](../ADR/000-main-architecture.md), [ADR-001](../ADR/001-angular-and-streaming-chat.md), [ADR-002](../ADR/002-bounded-decisions.md)
- [Canonical C0-C12 plan](../plans/hardware-assessment-chat-implementation-plan.md), [plan pointer](../plan.md) and [workflow tracker](../workflow-checklist.md)
- [Design guidance](../design-guidelines.md), for relevant presentation constraints

## Issues corrected

1. Distinguished backend application runtime configuration loading from agent access. Agents/workers never inspect secret files or values. A human or credential-isolated runtime supplies credentials for live checks; agents receive synthetic inputs and sanitized outcomes only.
2. Reconciled the local configuration contract for key and model settings without inspecting the file. Process environment wins; template defaults do not overwrite supplied selections.
3. Assigned C1 backend loader ownership and failing synthetic tests for configuration precedence and missing settings.
4. Required sanitized worker briefs, results, diffs and reports. OpenCode events are consumed without storing/displaying the raw stream; only allowlisted metadata and sanitized final reports may be retained. Suspected sensitive output is withheld and the affected task stops.
5. Clarified Sol's architecture/acceptance authority and Terra's complex implementation/review role. Future research remains delegated to Luna with Context7 first, or installed CLI help first for CLI questions. Historical source lists are explicitly not future research instructions.
6. Extended the standing pre-implementation review gate to include AGENTS.md alongside PRD, ADR and Plan.
7. Normalized ASCII punctuation in active documents, including indexes, tracker and design prose, preserving threshold meaning with >= and <= and retaining Polish letters where needed.
8. Replaced stale current-review labels with this record; previous reviews remain labeled historical rather than counted as approval of the latest rules.

The independent reviewer re-read saved substantive corrections and found AGENTS, PRD, current ADRs and plan consistent. A08/A13/A21, code-owned status, fixed thresholds, synthetic-only scope, session constraints, source order, worker roles, separate real smoke checks and human approval gate align. The coordinator then reconciled review-status metadata and checked local links, fences, punctuation and whitespace.

## Limits and next gate

No secret files, participant data or customer records were read. No application initialization, implementation, build/test/startup check, provider call, new OpenCode inference, commit or publication was performed. This document review does not establish app/provider integration. The earlier MiMo review remains incomplete after its recorded timeout.

The plan remains a draft requiring human approval before C1. Actual runtime verification, independent implementation review and final human acceptance remain future gates.