# Story Plan: 17 — End-to-end tests for sync, offline, and speed

## Branch

`feature/17-sync-offline-speed-e2e`

## Role

`--full` — explicit full flow

## Set-aside changes

Original branch `main`, stash `adlc: set aside for story 17` — restore when the run ends

## Context

`.github/memorybank/stories/17/context.md` — tracker snapshot. Refined AC live in `requirements.md`.

## Scope

Frontend scope: add Playwright E2E coverage against the real API and built frontend, and fix the frontend SSE version parser to match the server's existing numeric event payload. The user approved this scope expansion after the tests exposed a deterministic sync defect.

## Summary

Fix realtime sync event parsing with a focused unit regression test, and add repeatable end-to-end coverage proving two-user synchronization, offline mutation replay and conflict resolution, and list-screen usability under CPU throttling.

## Acceptance Criteria

1. At least 19 of 20 independently observable list-operation changes reach the second user within 2 seconds of the first user's final-change acknowledgement.
2. Five offline changes survive reload and synchronization: add, rename, delete, clear a pre-crossed item, then cross off a separate item; both crossed-off final states are verified.
3. A later online rename preserves an earlier offline cross-off.
4. With Chromium at 4x CPU throttling, a 200-item list shows its heading, enabled add-item input, and enabled item action within 1 second of navigation.
5. The full configured E2E suite passes three repetitions; implementer created-scope verification is separate.

## Assumptions

- Scope expanded with user approval to include the minimal frontend SSE parser correction and a focused unit regression test; the backend event contract remains unchanged.
- ASSUMPTION-1: For AC-001, “20 changes” is represented by 20 independently observable mutations across supported list operations, including at least one addition, cross-off, rename, deletion, and clear-crossed-off operation. The tracker does not prescribe a distribution among mutation types.
- ASSUMPTION-2: The AC-001 2-second interval begins when Sam's UI acknowledges the final addition; test setup and item creation before the measured sequence are outside the interval.
- ASSUMPTION-3: For AC-002, “all 5 changes appear” means Alex sees the resulting shared-list state, not five items appearing: the added item is active, the separate cross-off target remains crossed off, the renamed item has its expected name, and the deleted and separately cleared items are absent.
- ASSUMPTION-4: The offline scenario can reload the built application while offline, and the pre-existing list/items, including the already-crossed-off clear target, are prepared before the offline sequence begins.
- ASSUMPTION-5: For AC-004, the 1-second measurement begins when navigation to the already prepared list starts and includes frontend readiness; the local E2E API is available during the measured navigation.
- ASSUMPTION-6: For AC-004, “usable” is the confirmed observable state: list heading visible, add-item input enabled, and an enabled item-action button for a known item available. The acceptance criterion does not require all 200 item rows to be simultaneously visible.
- ASSUMPTION-7: AC-005 is executed with the repository's deterministic runner command against the full configured E2E suite using `--scope all --repeat 3`; the implementer's `--scope created` check is separate.
- Open Questions: None. The timing origin, observable readiness state, and AC-003 conflict outcome were confirmed during refinement. The remaining fixture-specific interpretations are stated as assumptions above.

## Implementation Notes

### Frontend

- Update the frontend SSE client to handle the server's numeric event payload and trigger sync; add a focused unit regression test.
- Extend the existing Playwright E2E tests and helpers; exercise the built frontend against the real API.
- Use event-driven waits, not fixed sleeps; preserve existing persona and page-object patterns.
- Cover two independent browser contexts, offline reload/reconnect, latest-change conflict behavior, and Chromium 4x CPU throttling.

## Test Strategy

- Unit: verify the realtime client handles a numeric SSE version payload and initiates a pull.
- E2E: focused Playwright scenarios for each acceptance criterion, including repeatability with `--repeat 3`.

## Requirements (from phase 1)

- Acceptance criteria: AC-001 at least 19 of 20 changes synchronize within two seconds; AC-002 clear the pre-crossed target before crossing off the separate target, then verify both final states after offline replay; AC-003 a later rename preserves the earlier offline cross-off; AC-004 the 200-item list becomes usable within one second; AC-005 three repeated full E2E suite runs pass.
- Test Awareness Matrix: Required categories are E2E / Playwright and Role-Based / Authorization.
- Tracker update: Needed — Applied with user approval, including the AC-002 order clarification. Refined criteria define observable mutation mix and offline outcomes, clarify the conflict and performance boundaries, and require the full E2E suite to pass on each of three repetitions.

## Agent Sequence

1. `@requirements` refine the issue and write `.github/memorybank/stories/17/requirements.md`.
2. `@requirements-review` gate the refined requirements.
3. `@code-frontend` fix the SSE parser and add a focused unit regression test.
4. `@code-review` and `@test-review` gate the frontend implementation and unit test.
5. `@test-e2e` fix the in-scope E2E harness findings, validate all scenarios, and run created tests three times.
6. `@test-review` and `@code-review` gate the E2E tests.
7. `@test-e2e` prepare E2E test-case registration data.
8. `@pr-create` create a ready PR.

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
<!-- [ ] Draft PR created omitted for full flow -->
[x] E2E tests written
[ ] Code reviewed (test code)
[ ] Test cases registered (or skipped)
[ ] PR ready

## Review Gate Status

| Phase | Attempt | Rating | Verdict | Reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| requirements | 1 | 3 | REFINE | `@requirements-review` | One refinement pass applied reviewer findings; human approved and tracker updated. |
| requirements | 2 | 4 | APPROVE | `@requirements-review` | User-directed AC-002 order clarified; user approved and tracker updated. |
| implementation | 1 | 4 | APPROVE | `@code-review` | Should Fix recorded: requirements scope reconciled with user-authorized frontend parser fix. |
| implementation | 1 | 3 | REFINE | `@test-review` (unit) | Must Fix: add coercible invalid SSE payload above cursor to prove numeric-format guard. |
| implementation | 2 | 4 | APPROVE | `@code-review` | Should Fix: replace fixed 20 ms settle delay in parser unit tests when practical. |
| implementation | 2 | 5 | APPROVE | `@test-review` (unit) | Coercible invalid payload now proves numeric-format guard. |
| tests | 1 | 3 | REFINE | `@test-review` (int/E2E) | AC-005 blocked by deterministic sync failures; frontend parser fix authorized. |
| tests | 1 | 3 | REFINE | `@code-review` (test code) | Must Fix: E2E Node type declarations; Should Fix: close Alex context if sign-in fails. |
