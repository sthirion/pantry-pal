# Story Plan: 37 — Merge non-conflicting offline item updates

## Branch

`feature/37-offline-item-field-merge` (stacked on `feature/17-sync-offline-speed-e2e`)

## Role

`--full` — explicit full flow

## Set-aside changes

None

## Context

`.github/memorybank/stories/37/context.md` — tracker snapshot. Refined requirements will be in `requirements.md`.

## Scope

Full-stack: preserve changed-field intent and base version in the frontend outbox; record/query server-versioned item changes and merge non-overlapping patches in the backend; verify through unit, API integration, and real-API E2E tests.

## Summary

Ensure an offline item edit to one field is not lost when another household member changes a different field before the offline client reconnects. Retain sufficient versioned change history for the supported offline window and handle older clients safely.

## Acceptance Criteria

1. AC-001: Merge a non-conflicting offline cross-off with an online rename using `itemRevision` while preserving the household sync cursor.
2. AC-002: Persist exact item ID, base item revision, stable mutation ID, and only changed fields; replay same-item edits in order and block dependents after non-acceptance.
3. AC-003: Merge non-overlapping fields, atomically recording item revision, household sync version, journal entry, and idempotency outcome.
4. AC-004: For same-field conflicts, keep the server value, apply non-conflicting fields, and retain the attempted offline value for reconciliation.
5. AC-005: Prune hourly while retaining at least 25 hours; update the per-item pruning watermark atomically.
6. AC-006: For expired or future bases, return a recoverable conflict and retain the pending patch.
7. AC-007: Make retries idempotent and reject mutation-ID reuse with different content.
8. AC-008: Enforce household-scoped item, journal, and idempotency access.
9. AC-009: Accept no-op mutations without advancing revisions or adding a journal entry.

## Assumptions

- DECISION-1 (same-field conflict policy): Server wins; keep the offline value recoverable for reconciliation.
- DECISION-2 (same-item offline queue): Keep distinct mutations and replay them in creation order, with at most one in flight per item. An unsent mutation uses its predecessor's accepted `itemRevision`; a non-accepted outcome blocks later same-item mutations until reconciliation.
- ASSUMPTION-1: The existing `PUT /api/lists/:listId/items/:itemId` endpoint is extended for this mutation contract; the household is derived from the session, not the request body.
- ASSUMPTION-2: The current mutable item fields are `name` and `crossedOff`, matching the shared item request schema; other item fields are not patchable under this story.
- ASSUMPTION-3: Each item's server-managed `itemRevision` begins at 1 and increases monotonically within that item's household. The existing household-wide `version` sync cursor retains its current shared-counter semantics; client timestamps are not used to order changes.
- ASSUMPTION-4: Hourly pruning retains every journal entry for at least 25 hours, using a one-hour margin above the issue's 24-hour minimum; a per-item `prunedThroughItemRevision` watermark identifies history that has been removed.
- ASSUMPTION-5: A base older than retained history is not automatically rebased; the API responds with a recoverable 409 and the client retains the mutation for reconciliation.
- ASSUMPTION-6: Idempotency receipts are retained for the lifetime of the item, and a retry is identical only when household, item, base item revision, mutation ID, and patch match.
- ASSUMPTION-7: Any authenticated member of the item's household may edit it; household membership is checked before item or journal access, with 401 for unauthenticated and 403 for cross-household access.
- Open Questions: None.

## Implementation Notes

### Backend

- Apply explicit item-field patches against the latest row and distinguish disjoint field edits from same-field conflicts.
- Record accepted item changes atomically with the row update, using server-managed monotonic versions and household-scoped queries.
- Prune history without losing the ability to identify when a client's base version is outside the retained horizon.

### Frontend

- Extend the persisted outbox mutation to carry item ID, base version, stable mutation ID, and only changed fields.
- Preserve pending changes across retries and reconnects; handle server conflict/expired-history outcomes without dropping queued intent.

## Test Strategy

- Unit: validate mutation patch creation, merge rules, same-field conflict policy, idempotency, and retention-horizon behavior.
- API integration: verify atomic journal writes, field-level merge outcomes, conflict response/policy, duplicate retries, household isolation, and expired history behavior.
- E2E: use two authenticated browser contexts to verify AC-001 cross-field preservation alongside issue 17's synchronization journey.

## Requirements (from phase 1)

- Acceptance criteria: AC-001 disjoint offline merge; AC-002 exact mutation intent and ordered replay; AC-003 atomic journal/version behavior; AC-004 server-wins for same-field conflicts while preserving offline intent; AC-005 25-hour minimum retention and hourly pruning; AC-006 recoverable expired/future-base handling; AC-007 idempotent retries; AC-008 403 for foreign lists and same 404 for foreign/missing items on an authorized list; AC-009 no-op behavior.
- Test Awareness Matrix: backend/frontend unit, API integration, E2E, accessibility, role-based authorization, and OWASP security checks are Required; translations/i18n are Recommended.
- Tracker update: Needed — Applied with user approval. AC-008 specifies 403 for an explicitly foreign list and the same scoped 404 for a foreign or missing item under an authorized list.

## Agent Sequence

1. `@requirements` refine the story, resolve unspecified conflict/retention behaviors, and write `.github/memorybank/stories/37/requirements.md`.
2. `@requirements-review` gate the refined contract.
3. `@code-backend` implement journal persistence, merge policy, and focused backend unit tests.
4. `@code-frontend` implement explicit outbox patches and client handling of merge/conflict outcomes.
5. `@code-review` and `@test-review` gate application code and unit tests.
6. `@test-api` and `@test-e2e` add integration and E2E coverage in parallel.
7. `@test-review` and `@code-review` gate the integration and E2E tests.
8. Register test cases if the phase-4 gate approves, then `@pr-create` create a PR targeting the issue-17 branch.

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
[x] Integration tests written
[x] E2E tests written
[x] Code reviewed (test code)
[x] Test cases registered (or skipped)
[ ] PR ready

## Review Gate Status

| Phase | Attempt | Rating | Verdict | Reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| requirements | 1 | 3 | REFINE | `@requirements-review` | LOW confidence; revision addressed cursor separation, queue ordering, same-field policy, no-op, and security-level findings. |
| requirements | 2 | 5 | APPROVE | `@requirements-review` | User approved server-wins with recoverable offline value; no findings. |
| requirements | 3 | 4 | APPROVE | `@requirements-review` | AC-008 status distinction approved; Should Fix tracker-count and plan-status records reconciled. |
| implementation | 1 | 2 | REFINE | `@code-review` | Must Fix: authorize before foreign item lookup; update impacted database/API expectations; preserve missing-item recovery intent. |
| implementation | 1 | 3 | REFINE | `@test-review` (unit) | Must Fix: shared mutation-schema boundary tests and future-base recovery UI assertion; manifest completeness disputed. |
| implementation | 2 | 3 | REFINE | `@code-review` | LOW confidence: Must Fix empty 2xx can lose queued mutation; impacted frontend list-rename test failed. Human escalation required. |
| implementation | 2 | 5 | APPROVE | `@test-review` (unit) | Schema boundaries, scoped authorization, future-base UI, and recovery coverage approved. |
| implementation | 3 | 2 | REFINE | `@code-review` | Must Fix: validate complete/matching 2xx mutation response; scope legacy PUT lookup for AC-008. Retry limit reached. |
| implementation | 3 | 3 | REFINE | `@test-review` (unit) | Must Fix: reject incomplete/malformed 2xx bodies and retain blocked mutation/dependent edits. Retry limit reached. |
| implementation | 4 | 2 | REFINE | `@code-review` | Fixes verified; Must Fix: update legacy PUT integration expectations from 403 to AC-008 404. |
| implementation | 4 | 5 | APPROVE | `@test-review` (unit) | Fresh-response omission, queue retention, and dependent-edit coverage approved. |
| implementation | 5 | 5 | APPROVE | `@code-review` | Legacy PUT expectations aligned; scoped lookup and complete response validation approved. |
| implementation | 5 | 5 | APPROVE | `@test-review` (unit) | Fresh-response, queue retention, and backend acceptance coverage approved. |
| tests | 1 | 2 | REFINE | `@test-review` (int/E2E) | Must Fix: exact name bounds; prune rollback; expired-history E2E; authorization-before-lookup integration assertion. |
| tests | 1 | 3 | REFINE | `@code-review` (test code) | Must Fix: unresolved Node type diagnostics in changed E2E helper; Should Fix: blocked-recovery accessibility check. |
| tests | 2 | 5 | APPROVE | `@test-review` (int/E2E) | API and E2E criteria covered; expired recovery, pruning rollback, and authorization query order verified. |
| tests | 2 | 4 | APPROVE | `@code-review` (test code) | Should Fix recorded: close Jo's browser context on assertion failure. |
