# Story 17 Requirements: End-to-End Tests for Sync, Offline, and Speed

## Source and Scope

 Classification: frontend story using E2E tests against the built frontend and real API. After the tests exposed the SSE payload mismatch, the user approved expanding scope to include the minimal frontend parser correction and a focused frontend unit regression test; the backend contract remains unchanged.
 Out of scope: backend code or unit tests, and separate API integration tests.

## Existing Repository Evidence

The E2E journey helpers define Sam and Alex as distinct users in household A and open the second user in a separate browser context. The Playwright configuration starts a temporary real API and serves the built frontend; journey tests use that real API. Existing item tests expose accessible item-action buttons and an “Add an item” combobox. Existing offline tests observe the offline notice and pending-change count, but use mocked API responses.

The repository therefore provides browser-visible, testable readiness signals for AC-4. The story alone did not define a timing origin or the meaning of “usable.” This refinement resolves those gaps: start timing when navigation to the prepared list begins, and define usable as the list heading visible, the add-item input enabled, and an enabled action button for a known list item available. The list is pre-populated with 200 items, and the test runs in Chromium with 4x CPU throttling. This is observable using the existing accessible UI conventions and a monotonic elapsed-time measurement. It does not assert that every one of the 200 rows is simultaneously visible.

## Comparison With Current Acceptance Criteria

The current criteria in `context.md` cover all five intended outcomes and retain their numeric thresholds: 19 of 20 updates within 2 seconds, five offline changes, latest-change conflict behavior, 200 items with 4x CPU throttling and a 1-second threshold, and three repeated passing runs.

The refined criteria preserve those goals and thresholds while adding testable definitions that are currently absent:

- AC-001 preserves the issue's broad “20 changes” intent by counting independently observable mutations across supported list operations, including at least one of each operation named in AC-002; it also defines the observation point, receiving user, and 2-second clock start.
- AC-002 defines what “all 5 changes appear” means by assigning each operation a distinct target, including separate items for cross-off and clear-crossed-off, and asserting the resulting shared-list state after offline reload and replay. It orders clear-crossed-off before crossing off the separate target so the pre-crossed target is absent while the separate target remains crossed off.
- AC-003 resolves “latest change” as preserving both the later rename and the earlier cross-off field update.
- AC-004 defines when timing starts and which visible/enabled controls constitute usable.
- AC-005 requires every test in the full E2E suite to pass in all three repetitions; an implementer's `--scope created` check is separate and does not satisfy this criterion.

**Tracker update verdict: Needed**

Reason: AC-002 in the refined requirements differs from the issue snapshot by requiring clear-crossed-off to run before crossing off the separate target. This ordering is necessary for the asserted outcome: the pre-crossed target is absent after clear, while the separately crossed-off target remains crossed off. The refined AC also define “20 changes” as independently observable mutations across supported operations (including add, cross-off, rename, delete, and clear-crossed-off), specify the separate final states that prove all five offline operations survive reload and replay, and require the full E2E suite rather than only created tests to pass in each repetition. The AC retain the clarified conflict outcome and performance readiness/timing definitions. These material interpretations should be reflected in the issue. No tracker update is performed as part of this task.

## Level 1: Requirements

### REQ-SYNC-001: Verify bounded synchronization between household members

- Precondition: Sam and Alex are authenticated in separate browser contexts in the same household and have the same prepared list open.
- Actor: The developer runs the E2E scenario; Sam performs the mutations and Alex is the receiving user.
- Requirement: The real-API E2E test shall verify that at least 19 of 20 independently observable mutations made by Sam across supported list operations are reflected in Alex's shared-list state within 2 seconds after Sam's final mutation is acknowledged in the UI. The 20 mutations shall include at least one addition, cross-off, rename, deletion, and clear-crossed-off operation.
- Priority: Must
- Tracker Story: 17

### REQ-OFFLINE-002: Verify persisted offline mutations replay after reload

- Precondition: Sam and Alex are authenticated in separate contexts and can access the same prepared list; Sam's browser can be taken offline while the built app remains available for reload.
- Actor: The developer runs the E2E scenario; Sam makes offline mutations and Alex verifies the resulting shared state.
- Requirement: The E2E test shall verify that an offline addition, rename, deletion, and clear-crossed-off operation, followed by crossing off a separate target, survive an offline page reload and are reflected in the shared list after reconnect and synchronization. Clear-crossed-off shall run before crossing off the separate target.
- Priority: Must
- Tracker Story: 17

### REQ-CONFLICT-003: Verify field-level conflict preservation

- Precondition: The same existing item is loaded by two authenticated household members; Sam can be taken offline while Alex remains online.
- Actor: The developer runs the E2E scenario; Sam crosses off the item offline and Alex renames it online afterward.
- Requirement: After Sam reconnects and synchronization completes, the item shall have Alex's new name and remain crossed off, preserving both field updates.
- Priority: Must
- Tracker Story: 17

### REQ-PERF-004: Verify observable list readiness within one second

- Precondition: A prepared list contains 200 items; the browser is Chromium with 4x CPU throttling; the E2E server and built frontend are running.
- Actor: The developer runs the performance E2E scenario.
- Requirement: Measured from the start of navigation to the prepared list, the list heading shall become visible, the add-item input shall be enabled, and an enabled item-action button for a known item shall be available within 1 second.
- Priority: Must
- Tracker Story: 17

### REQ-REPEAT-005: Verify repeatability

- Precondition: The full configured E2E suite is run with the project's deterministic test runner and `--scope all --repeat 3`.
- Actor: The developer runs the suite.
- Requirement: Every test in the full E2E suite shall pass in all three repetitions. An implementer's `--scope created` test check is separate and does not satisfy this requirement.
- Priority: Must
- Tracker Story: 17

## Level 2: Acceptance Criteria

### AC-001: At least 19 of 20 changes synchronize within two seconds

Given Sam and Alex are signed in through separate browser contexts as members of the same household, and both can access the same prepared list,
when Sam makes 20 independently observable changes across supported list operations, including at least one addition, cross-off, rename, deletion, and clear-crossed-off operation, and Sam's UI acknowledges the final change,
then Alex's shared-list state reflects at least 19 of those 20 changes within 2 seconds of that acknowledgement.

Rationale: the issue says “20 changes” without restricting the count to additions, so the criterion samples the supported change types rather than narrowing the intent to additions alone.

Negative: Given Alex's shared-list state reflects only 18 of Sam's 20 changes by the 2-second deadline, when the synchronization assertion is evaluated, then the E2E scenario fails with the observed count below the required minimum of 19.

### AC-002: Five offline changes survive reload and synchronize

Given Sam and Alex are signed in through separate browser contexts and can access the same list, with distinct items prepared for cross-off, rename, deletion, and clear-crossed-off, and the clear-crossed-off target is already crossed off,
when Sam goes offline, adds one item, renames the rename target, deletes the deletion target, clears crossed-off items, crosses off the separate cross-off target, reloads the page while still offline, and reconnects,
then after synchronization Alex's list shows the added item as active, the cross-off target still crossed off, and the renamed item under its new name; the deleted item and the separate clear-crossed-off target are absent; and no pending changes remain for Sam.

Negative: Given one or more of Sam's five operations are lost during offline reload or replay, when Alex's list is checked after synchronization, then at least one expected final item state is absent or incorrect, including the cross-off target not remaining crossed off, and the E2E scenario fails.

### AC-003: A later rename preserves the earlier offline cross-off

Given Sam and Alex are signed in as members of the same household and have the same active item,
when Sam goes offline and crosses off that item, Alex remains online and renames that item afterward, and Sam then reconnects and synchronizes,
then the shared item has Alex's new name and remains crossed off.

Negative: Given synchronization completes, when the shared item is inspected, then the scenario fails if the new name is lost or the item is restored to active state.

### AC-004: The 200-item list becomes usable within one second

Given a prepared list contains 200 items and the Chromium browser is configured for 4x CPU throttling,
when navigation to that list starts,
then within 1 second the list heading is visible, the add-item input is enabled, and an enabled item-action button for a known item is available.

Negative: Given any of those three readiness signals is absent or disabled at the 1-second deadline, when the readiness assertion is evaluated, then the E2E scenario fails and reports which signal missed the deadline.

### AC-005: Three repeated full E2E suite runs pass

Given the full configured E2E suite is invoked with `node .github/scripts/test/test.mjs e2e --scope all --repeat 3`,
when the deterministic runner completes all three repetitions,
then every test in every repetition passes.

The implementer's `--scope created` check is a separate development check and does not replace this full-suite acceptance criterion.

Negative: Given any test in the full suite fails in any repetition, when the runner reports the result, then AC-005 fails; a passing repetition does not compensate for a failing one.

## Level 3: BDD Acceptance Test Scenarios

```gherkin
Feature: End-to-end confidence in synchronization, offline use, conflict handling, and list readiness

  Scenario: Most changes reach a second household member within two seconds
    Given Sam and Alex are signed in in separate browser contexts in the same household
    And both can access the same prepared list
    When Sam makes 20 independently observable changes across supported list operations
    And the changes include at least one addition, cross-off, rename, deletion, and clear-crossed-off operation
    And Sam's UI acknowledges the final change
    Then Alex's shared-list state reflects at least 19 of those changes within 2 seconds

  Scenario: Synchronization below the required count is rejected
    Given Sam and Alex are signed in in separate browser contexts in the same household
    And Sam has made 20 independently observable changes across supported list operations
    When the 2-second observation deadline passes
    And Alex's shared-list state reflects only 18 of those changes
    Then the E2E scenario fails the minimum synchronization threshold

  Scenario: Offline mutations survive reload and are reflected for the other user
    Given Sam and Alex are signed in in separate browser contexts and share a prepared list
    And the list has distinct items available for cross-off, rename, and deletion
    And a separate clear-crossed-off target is already crossed off
    When Sam goes offline
    And Sam adds an item, renames an item, and deletes an item
    And Sam clears crossed-off items, removing the pre-crossed clear target
    And Sam then crosses off the separate cross-off target
    And Sam reloads the page while still offline
    And Sam reconnects
    Then Alex sees the added item as active
    And Alex sees the separately crossed-off item still crossed off
    And Alex sees the renamed item under its new name
    And Alex does not see the deleted item or the separate item removed by clear-crossed-off
    And Sam has no pending changes

  Scenario: A lost offline mutation is detected after reload and replay
    Given Sam has made the five specified mutations while offline
    When Sam reloads while offline, reconnects, and synchronization completes
    And Alex's shared-list state is missing or misrepresents one expected result, including the cross-off target no longer being crossed off
    Then the E2E scenario fails the offline-replay assertion

  Scenario: A later online rename and earlier offline cross-off are both retained
    Given Sam and Alex share the same active item
    When Sam crosses off the item while offline
    And Alex renames the item online afterward
    And Sam reconnects and synchronization completes
    Then the item has Alex's new name
    And the item remains crossed off

  Scenario: Conflict resolution does not discard either field update
    Given Sam crossed off the item while offline
    And Alex renamed that item online afterward
    When synchronization completes
    Then the E2E scenario fails if the rename is missing or the item is active

  Scenario: The prepared 200-item list becomes usable within one second
    Given the prepared list contains 200 items
    And Chromium is configured for 4x CPU throttling
    When navigation to the list starts
    Then the list heading is visible within 1 second
    And the add-item input is enabled within 1 second
    And an enabled item-action button for a known item is available within 1 second

  Scenario: A missing readiness signal fails the one-second threshold
    Given the prepared list contains 200 items
    And Chromium is configured for 4x CPU throttling
    When any defined readiness signal is not ready at the 1-second deadline
    Then the performance scenario fails and identifies the missed signal

  Scenario: Every repetition of the full E2E suite passes
    Given the full configured E2E suite is invoked with `--scope all --repeat 3`
    When the deterministic runner completes three repetitions
    Then every test in every repetition passes

  Scenario: A failure in any full-suite repetition fails the repeatability criterion
    Given the full configured E2E suite is invoked with `--scope all --repeat 3`
    When any test fails in any one of the three repetitions
    Then the repeatability criterion fails

  Scenario: The created-test check does not substitute for the full suite
    Given the implementer runs E2E tests with `--scope created`
    When the full E2E suite has not been run three times
    Then AC-005 remains unmet
```

## Test Awareness Matrix

| Category | Applicability | What to test, why, and watch-outs |
| --- | --- | --- |
| Unit Tests (Backend) | Not Applicable | No backend implementation changes are in scope. The required sync and conflict observations exercise the real API through E2E; do not add backend unit tests for this test-only story. |
| Unit Tests (Frontend) | Not Applicable | No application/frontend implementation changes are in scope. Existing frontend unit coverage is not a substitute for the two-user, browser-context, offline-reload scenarios. |
| Unit Tests (Frontend) | Required | What: verify the realtime client accepts the server's bare numeric SSE version payload and initiates a pull, and rejects malformed/non-numeric payloads. Why: the authorized frontend parser correction needs a focused regression test. Watch out: unit coverage supplements but does not replace the two-user browser-context and offline-reload E2E scenarios. |
| API Integration Tests | Not Applicable | This story adds browser E2E scenarios, not a separate API integration suite. The E2E journey scenarios must use the real API as required by the plan; do not confuse mocked API offline-indicator tests with the real-API acceptance coverage. |
| E2E / Playwright Tests | Required | What: implement AC-001 through AC-005 with separate authenticated contexts, event-driven assertions, offline mode plus reload/reconnect, Chromium 4x CPU throttling, and repeat-three execution. Why: all five tracker AC are end-to-end behavior or test-suite reliability. Watch out for shared database state across repetitions, distinct item names, test cleanup/isolation, clearing the already-crossed-off clear target before crossing off the separate target, starting the sync deadline only after the final mutation is acknowledged, and avoiding fixed sleeps. |
| Accessibility (WCAG 2.1 AA) | Recommended | What: use accessible roles/names for item actions, heading, and add-item control; preserve keyboard-operable controls in the new paths. Why: AC-002 through AC-004 operate on user-facing controls. Watch out: this story changes tests, not UI layout; a new broad axe audit or responsive-breakpoint test is not required unless implementation changes reveal a UI/accessibility issue. |
| Translations / i18n | Not Applicable | No UI strings or translations are introduced by this test-only story. Use existing accessible names and text as they are; do not add string resources. |
| Translations / i18n | Not Applicable | No UI strings or translations are introduced. Use existing accessible names and text as they are; do not add string resources. |
| Role-Based / Authorization | Required | Test level: E2E. What: authenticate Sam and Alex independently in separate contexts and verify they are both members of the shared household and see the expected shared-list state. Why: AC-001 through AC-003 require distinct users, not one shared session. Watch out for accidentally reusing cookies/storage state or using Jo from another household, which would change the scenario into an authorization test. |
| Security (OWASP) | Recommended | What: keep real authentication and same-origin API behavior in the E2E path; ensure the second user's context is independent and no test bypasses authorization. Why: synchronization crosses authenticated browser contexts and must not be an artifact of shared browser state. Watch out: this story does not add an OWASP security suite or expand household-isolation coverage beyond the identity prerequisites. |

## Assumptions

- ASSUMPTION-1: For AC-001, “20 changes” is represented by 20 independently observable mutations across supported list operations, including at least one addition, cross-off, rename, deletion, and clear-crossed-off operation. The tracker does not prescribe a distribution among mutation types.
- ASSUMPTION-2: The AC-001 2-second interval begins when Sam's UI acknowledges the final addition; test setup and item creation before the measured sequence are outside the interval.
- ASSUMPTION-3: For AC-002, “all 5 changes appear” means Alex sees the resulting shared-list state, not five items appearing: the added item is active, the separate cross-off target remains crossed off, the renamed item has its expected name, and the deleted and separately cleared items are absent. To preserve both crossed-off-item assertions, clear-crossed-off runs before the separate cross-off operation.
- ASSUMPTION-4: The offline scenario can reload the built application while offline, and the pre-existing list/items, including the already-crossed-off clear target, are prepared before the offline sequence begins. The clear target is removed by clear-crossed-off before the separate target is crossed off.
- ASSUMPTION-5: For AC-004, the 1-second measurement begins when navigation to the already prepared list starts and includes frontend readiness; the local E2E API is available during the measured navigation.
- ASSUMPTION-6: For AC-004, “usable” is the confirmed observable state: list heading visible, add-item input enabled, and an enabled item-action button for a known item available. The acceptance criterion does not require all 200 item rows to be simultaneously visible.
- ASSUMPTION-7: AC-005 is executed with the repository's deterministic runner command against the full configured E2E suite using `--scope all --repeat 3`; the implementer's `--scope created` check is separate.

## Confirmed Decisions

- AC-003 conflict semantics: preserve both updates. After Sam's offline cross-off and Alex's later online rename, the item has Alex's new name and remains crossed off.
- AC-002 operation ordering: “Clear first, then cross off” — clear the pre-crossed target first, then cross off the separate target; assert one is absent and the other remains crossed off.
- AC-004 readiness and timing: the user confirmed that “usable within 1 second” means the list heading, enabled add-item input, and at least one enabled item action are ready within 1 second of navigation starting.

## Open Questions

- None. The AC-002 operation ordering, timing origin, observable readiness state, and AC-003 conflict outcome were confirmed during refinement. The remaining fixture-specific interpretations are stated as assumptions above.
