# Requirements: 37 — Merge non-conflicting offline item updates

## Scope and source comparison

This is a full-stack refinement of issue 37. Issue 17 is listed as related work in the issue snapshot and is cited there as exposing the behavior in an existing real-API E2E scenario. This refinement preserves the issue's goal: a stale offline edit to one item field must not overwrite another household member's edit to a different field.

The snapshot requests changed-field patches, a base version, stable mutation IDs, field-level merging, deterministic conflict reporting, an atomic server-versioned journal, at least 24 hours of history, safe handling of older bases, idempotency, household isolation, and focused unit/API/E2E coverage. It does not specify the request/response fields, field conflict outcome, pruning cadence and margin, expired-history response, or duplicate-key behavior. The criteria below make those contracts testable and record the confirmed choices. They also preserve the existing household-wide sync cursor and define a separate per-item revision for journal conflict checks.

**Tracker verdict: Needed.** The issue snapshot's AC-008 says a member addressing another household's item receives 403, which conflicts with the confirmed decision to return the same 404 for a foreign or missing item on an authorized list while retaining 403 for an explicitly foreign list. Issue 37's acceptance criteria need updating to match this decision and the other operational/API contracts. No tracker update is performed here.

## Requirements

### REQ-OFFLINE-MERGE-001: Preserve mutation intent

- Precondition: An authenticated household member edits an item while the client is offline.
- Actor: The household member's client.
- Priority: Must.
- Tracker story: 37.
- The persisted outbox mutation identifies the item, carries its base `itemRevision`, has a stable UUID mutation ID, and contains only the fields changed by that mutation. The patch is non-empty and contains only `name` and/or `crossedOff`.
- `name` uses the existing display-name normalization and must contain 1–200 characters after normalization. `crossedOff` must be a boolean. Client wall-clock timestamps are not version cursors.
- The item revision and mutation payload are available after reload. Multiple offline edits to one item remain distinct and are replayed in creation order, with at most one mutation in flight per item. Before a queued mutation's first submission, its `baseItemRevision` is set to the preceding accepted mutation's returned `itemRevision`. A conflict-resolved HTTP 200 is accepted; a non-accepted outcome blocks that mutation and later edits for the item until reconciliation. Once submitted, retries use the same mutation ID and identical payload.

### REQ-OFFLINE-MERGE-002: Merge by item revision and preserve sync cursor

- Precondition: The server has an item at `itemRevision` `r`, and the authenticated member submits a valid mutation based on `baseItemRevision` `b` where `b <= r` and the relevant history is retained.
- Actor: The server handling the authenticated member's request.
- Priority: Must.
- Tracker story: 37.
- Each item has a server-managed, monotonically increasing `itemRevision` scoped to that item and household, initially 1. Each accepted mutation that changes one or more fields advances it once. The existing household-wide synchronization cursor (currently exposed as `version`) retains its existing semantics and remains separate; `itemRevision` is not used as a `since` cursor.
- The server finds journal entries for the item with `itemRevision` greater than the submitted `baseItemRevision`. If none of the submitted fields appear in those entries, it applies the patch to the current row, preserving all other current fields. It atomically persists the row, the existing sync cursor update, any journal entry for actual changed fields, and the idempotency outcome.
- If a valid mutation leaves the row unchanged after normalization and conflict resolution, it is accepted and its idempotency outcome is recorded, but it does not advance `itemRevision` or the household sync cursor and creates no journal entry. Item reads and synchronization responses expose `itemRevision` for future mutations while retaining the existing household sync cursor for synchronization.

### REQ-OFFLINE-MERGE-003: Resolve same-field conflicts

- Precondition: A submitted field appears in an item journal entry newer than the mutation's `baseItemRevision`.
- Actor: The server, followed by the submitting client's member.
- Priority: Must.
- Tracker story: 37.
- The server value wins for each overlapping field. The server applies any non-overlapping fields in the same patch. It returns HTTP 200 with the current item, `itemRevision`, existing household sync cursor (`version`), applied field names, and a conflict entry for each overlapping field containing its name, attempted value, and server value.
- The client records the conflicting offline intent in a recoverable conflict state and presents the server value and attempted value for review. It does not silently discard the attempted value or automatically retry the same mutation. A member may discard the attempted value or submit it after refreshing the base `itemRevision` as a new mutation ID.

### REQ-OFFLINE-MERGE-004: Retain and prune journal history

- Precondition: Accepted item changes have corresponding journal entries.
- Actor: The server's scheduled maintenance task.
- Priority: Must.
- Tracker story: 37.
- Journal entries use server-assigned `itemRevision` values for ordering and server-recorded UTC timestamps only for age-based pruning. A scheduled pruning task runs hourly and must not delete any entry younger than 25 hours, providing a one-hour safety margin over the required 24-hour minimum.
- Pruning and updating the item's `prunedThroughItemRevision` watermark are atomic. The watermark records the greatest deleted item revision per item so requests can distinguish a complete history from pruned history.
- Journal entries identify the household, item, mutation ID, `itemRevision`, changed field names, and server timestamp. The journal and item update are committed or rolled back together; the household sync cursor (`version`) continues to be managed according to its existing semantics and is never replaced by `itemRevision`.

### REQ-OFFLINE-MERGE-005: Recover from an expired or future base

- Precondition: A valid mutation references a `baseItemRevision` older than `prunedThroughItemRevision`, or a `baseItemRevision` greater than the current `itemRevision`.
- Actor: The server and submitting client's member.
- Priority: Must.
- Tracker story: 37.
- For a base older than retained history, the server applies none of the patch and returns HTTP 409 with code `BASE_VERSION_EXPIRED`, the current item, its `itemRevision`, and existing household sync cursor (`version`). The client keeps the complete mutation intent in a blocked, recoverable outbox state and offers refresh/reconciliation; it does not automatically apply, rebase, or discard the patch.
- For a future base item revision, the server applies none of the patch and returns HTTP 409 with code `BASE_VERSION_AHEAD`, the current `itemRevision`, and existing household sync cursor; the outbox intent remains recoverable.

### REQ-OFFLINE-MERGE-006: Make retries idempotent and isolate households

- Precondition: A client submits an item mutation with a mutation ID.
- Actor: The server handling the authenticated household member's request.
- Priority: Must.
- Tracker story: 37.
- The idempotency key is scoped to the authenticated household. For an identical retry, the server does not apply the mutation again and returns the recorded mutation outcome, marked `replayed: true`; the current item, `itemRevision`, and household sync cursor (`version`) in the response reflect current server state. A mutation ID reused in the same household with different item or request content returns HTTP 409 with code `MUTATION_ID_REUSED` and has no effect.
- Idempotency receipts remain available for the lifetime of the item, so a delayed retry cannot reapply an accepted mutation after journal pruning. Reuse of the same UUID in another household is independent and reveals no data across households.
- Every list and item read/write is scoped using the authenticated session's household ID, never a client-supplied household ID. The server authenticates and authorizes the route list against the session household before looking up the item. An explicitly foreign list returns 403 before item, journal, or receipt lookup. For an authorized list, the item lookup is constrained by session household ID, route list ID, and item ID; a missing item and an item that is not in that list (including an item belonging to another household or list) return the same 404 response without a global item lookup. Journal reads/writes are scoped to the authenticated household and authorized item, and idempotency receipts are household-scoped and are not disclosed before list and item authorization. Requests without a session return 401.

## API contract

The existing item mutation endpoint is `PUT /api/lists/:listId/items/:itemId`. Authentication uses the existing session. `listId` and `itemId` are UUIDs; household scope comes from the authenticated session.

Request body:

```json
{
  "mutationId": "8c82c043-3ab7-4e1f-b5e5-80c96b66c761",
  "baseItemRevision": 14,
  "changes": {
    "crossedOff": true
  }
}
```

`baseItemRevision` is a positive safe integer and is distinct from the existing household-wide `version` synchronization cursor. `changes` must be an object containing at least one allowed field (`name`, `crossedOff`); unknown fields, `null` values, missing fields, invalid types, and an empty patch return 400 with field-level validation details. `name` follows the existing normalization and 1–200 character limit. `crossedOff` is boolean. The mutation contract does not use client `changedAt` as its history cursor. The existing `version` cursor remains authoritative for `since` synchronization requests; clients use `itemRevision` only as the base for field-level mutation merging.

For an accepted mutation, the response is HTTP 200; `itemRevision` is the item's merge revision and `version` retains its existing household-wide sync-cursor meaning:

```json
{
  "mutationId": "8c82c043-3ab7-4e1f-b5e5-80c96b66c761",
  "item": {
    "id": "4d3e2ba0-8313-4f75-bdf2-552bab7f1a8b",
    "name": "Apples",
    "crossedOff": true
  },
  "itemRevision": 15,
  "version": 28,
  "appliedFields": ["crossedOff"],
  "conflicts": [],
  "replayed": false
}
```

On an overlapping-field merge, `conflicts` contains entries shaped as `{ "field": "name", "attemptedValue": "Offline name", "serverValue": "Online name" }`; the server value remains on the item and the client retains the attempted value for reconciliation. On an identical retry, the original mutation outcome is returned with `replayed: true`, alongside the current item, `itemRevision`, and existing sync cursor. A valid no-op returns HTTP 200 without advancing either revision/cursor or adding a journal entry. An expired/future base or mismatched mutation-ID reuse returns HTTP 409 with a stable `code`, current item, `itemRevision`, and sync cursor when authorized and available, and no stack trace or internal database detail. Unauthenticated requests return 401; an explicitly foreign list returns 403 before item, journal, or receipt lookup; a missing or foreign item on an authorized list returns the same 404; malformed requests return 400.

| Request condition | Response | Lookup and disclosure requirement |
| --- | --- | --- |
| No valid session | 401 | Do not perform household resource lookups. |
| Authenticated request names an explicitly foreign list | 403 | Authorize the list against the session household before item, journal, or receipt lookup. |
| Authorized list; item is missing or is not in that exact list, including a foreign item | 404 | Return the same 404 response in both cases. Query by session household ID, route list ID, and item ID; do not globally look up the item to distinguish the cases. |
| Authorized list and item belongs to that list | Continue mutation processing | Scope journal lookups to the authenticated household and item, and idempotency lookups to the authenticated household, after list and item authorization. |
| Malformed request | 400 | Return field-level validation details without changing item or journal state. |

## Acceptance criteria

### AC-001: Preserve disjoint offline edits

Given Sam and Alex are authenticated members of the same household and both have `itemRevision` 14, when Sam goes offline and changes only `crossedOff` to `true`, Alex changes `name` online, and Sam reconnects while the relevant journal history is retained, then the server applies Sam's `crossedOff` patch to the current item and preserves Alex's `name`; the response and synchronized item include the current `itemRevision` and existing household sync cursor (`version`).

- Negative: If Sam submits a malformed or empty patch, the server returns 400 and neither the item nor its journal changes.

### AC-002: Persist exact mutation intent

Given a member changes an item offline, when the client stores the mutation, then its outbox record contains the item ID, `baseItemRevision`, stable UUID `mutationId`, and only the changed `name` and/or `crossedOff` fields; the record survives client reload and its retry payload is unchanged. Multiple edits to the same item are distinct and replay in creation order, with at most one in flight; each unsent edit uses its preceding accepted mutation's returned `itemRevision` as its base before first submission. A non-accepted outcome blocks later edits for that item until reconciliation.

- Negative: If the patch includes an unsupported field, invalid value, or no changed fields, the API rejects it with 400 and field-level details without modifying the item.

### AC-003: Merge non-overlapping fields

Given an item's journal contains only `name` changes after the submitted `baseItemRevision`, when the client submits a valid `crossedOff` change, then the server updates `crossedOff`, preserves the current `name`, advances `itemRevision` once, advances the existing household sync cursor (`version`) using its current shared-counter semantics, and atomically records the row, revision, journal entry, and idempotency outcome. A later sync request using a cursor from before the accepted mutation returns that mutation; `itemRevision` is never used as the `since` cursor.

- Negative: If the item update or journal/receipt write fails, the transaction leaves the row, `itemRevision`, household sync cursor (`version`), journal, and idempotency outcome unchanged.

### AC-004: Report same-field conflict without losing intent

Given `name` changed after the offline mutation's `baseItemRevision`, when the member replays an offline mutation changing `name` and `crossedOff`, then the server retains the current server `name`, applies `crossedOff` if it is non-conflicting, and returns HTTP 200 identifying applied and conflicting fields with both attempted and server values; the client preserves the attempted name in a recoverable conflict state for reconciliation and does not retry the same mutation automatically.

- Negative: If the client receives this conflict response and reloads, the unresolved attempted value remains available; it is not replaced by the server value or silently deleted.

### AC-005: Retain history and prune on schedule

Given journal entries exist for accepted item mutations, when the hourly pruning task runs, then it deletes only entries at least 25 hours old, advances `prunedThroughItemRevision` atomically to the greatest deleted item revision, and retains at least the latest 24 hours of history.

- Negative: If pruning or watermark persistence fails, the transaction leaves both the journal entries and watermark unchanged; the task must not partially prune history.

### AC-006: Recover safely outside retained history

Given the submitted `baseItemRevision` is below `prunedThroughItemRevision`, when the client replays the mutation, then the server applies none of its changes and returns 409 `BASE_VERSION_EXPIRED` with the current item, `itemRevision`, and existing household sync cursor; the client preserves the patch in a blocked recovery state until the member reconciles it.

- Negative: A `baseItemRevision` greater than the current `itemRevision` returns 409 `BASE_VERSION_AHEAD` without applying or dropping the pending patch.

### AC-007: Make retries idempotent

Given a mutation has been accepted, when the client retries the identical item, mutation ID, `baseItemRevision`, and patch one or more times, then the mutation is applied at most once and every retry reports the recorded outcome with `replayed: true`.

- Negative: Reusing the same mutation ID in the same household for different content returns 409 `MUTATION_ID_REUSED` and causes no additional change; the receipt remains usable after journal pruning.

### AC-008: Enforce household isolation

Given two households have lists, items, and mutations, when an authenticated member requests or retries a mutation through a list, then the server authorizes the route list against the member's session household before looking up the item; for an authorized list, item lookups are constrained by session household ID, route list ID, and item ID, journal lookups by session household and authorized item, and version/idempotency lookups by session household, so no other household's data is returned or changed. A missing item and an item not in that authorized list, including a foreign item, return the same 404 response.

- Negative: An unauthenticated request returns 401. A member addressing an explicitly foreign list receives 403 before any item, journal, or receipt lookup. On an authorized list, a missing item and a foreign item produce the same 404 response, with no global item lookup or item/journal data disclosure. Identical UUID mutation IDs in different households remain independent.

### AC-009: Accept no-op mutations without advancing revisions

Given a valid mutation's normalized values already match the current item, when the server accepts the mutation, then it returns HTTP 200 and records the idempotency outcome without advancing `itemRevision` or the household sync cursor (`version`) and without adding a journal entry.

- Negative: Retrying that same no-op mutation returns its stored outcome with `replayed: true` and still does not advance either cursor or add a journal entry.

## BDD acceptance scenarios

```gherkin
Feature: Merge non-conflicting offline item updates

  Scenario: Merge a crossed-off change with an online rename
    Given Sam and Alex are members of the same household
    And both clients have itemRevision 14 with name "Apples" and crossedOff false
    When Sam goes offline and changes only crossedOff to true
    And Alex changes the item name to "Granny Smith apples" online
    And Sam reconnects and submits the mutation based on itemRevision 14
    Then the server keeps the name "Granny Smith apples"
    And the server sets crossedOff to true
    And the response includes the resulting itemRevision, existing household sync cursor, and applied field crossedOff

  Scenario: Reject an empty or invalid patch
    Given a household member is authenticated
    When the member submits an empty patch or a patch with an unsupported field
    Then the server returns 400 with field-level validation details
    And the item and journal remain unchanged

  Scenario: Persist only changed fields and stable mutation identity
    Given a member changes crossedOff while offline
    When the client persists the outbox mutation and reloads
    Then the mutation contains the item ID, base itemRevision, stable UUID, and crossedOff only
    And any retry sends the identical mutation ID and payload

  Scenario: Replay same-item offline edits in order
    Given a member queues two distinct edits to the same item while offline
    When the client reconnects
    Then it submits only the first mutation
    And after that mutation is accepted, it submits the second using the returned itemRevision as its base
    And if the first mutation is not accepted, it keeps the second blocked until reconciliation

  Scenario: Apply a disjoint patch atomically
    Given the item journal records a name change after the client's base itemRevision
    When the client submits a crossedOff change
    Then the server preserves the current name and applies crossedOff
    And itemRevision advances once while the existing household sync cursor retains its current shared-counter semantics
    And a sync request using a cursor from before the mutation returns that mutation
    And the row, journal entry, and idempotency outcome commit atomically

  Scenario: Accept a no-op without advancing revisions or adding history
    Given a valid mutation's normalized values already match the current item
    When the server accepts the mutation
    Then it records the idempotency outcome without advancing itemRevision or the household sync cursor
    And it adds no journal entry

  Scenario: Replay an accepted no-op without advancing revisions
    Given the server has accepted a no-op mutation and stored its receipt
    When the client retries the same mutation
    Then the server returns replayed true without advancing either cursor or adding a journal entry

  Scenario: Keep server value and preserve attempted same-field edit
    Given the item name changed online after the offline mutation's base itemRevision
    When the offline mutation changes name and crossedOff
    Then the server keeps the online name and applies the non-conflicting crossedOff change
    And the response identifies the attempted and server name values
    And the client keeps the server name and retains the attempted offline name for reconciliation

  Scenario: Do not partially prune history
    Given the hourly journal pruning task selects entries at least 25 hours old
    When journal deletion or watermark update fails
    Then no selected journal entry or watermark change is committed
    And entries younger than 25 hours are never deleted

  Scenario: Recover an expired base without applying the patch
    Given the client's base itemRevision is below the item's prunedThroughItemRevision
    When the client submits its offline mutation
    Then the server returns 409 with code BASE_VERSION_EXPIRED and the current item, itemRevision, and household sync cursor
    And the server applies none of the patch
    And the client keeps the mutation available for reconciliation

  Scenario: Reject a future item revision
    Given the client's base itemRevision is greater than the current itemRevision
    When the client submits its offline mutation
    Then the server returns 409 with code BASE_VERSION_AHEAD
    And the client retains the pending patch

  Scenario: Return the prior outcome for an identical retry
    Given the server has accepted a mutation and stored its receipt
    When the client retries the identical mutation ID, base itemRevision, and patch one or more times
    Then the server does not apply it again
    And the response reports the original mutation outcome and replayed true

  Scenario: Reject mutation ID reuse with different content
    Given a mutation ID has an accepted receipt in a household
    When the same household submits that ID with different content
    Then the server returns 409 with code MUTATION_ID_REUSED
    And the item and journal do not change

  Scenario: Reject an explicitly foreign list before item lookup
    Given a member is authenticated and the requested list belongs to another household
    When the member submits an item mutation through that list
    Then the server returns 403
    And it performs no item, journal, or receipt lookup for that request

  Scenario: Return the same not-found response for a foreign or missing item on an authorized list
    Given a member is authenticated and the requested list belongs to that member's household
    When the member submits a mutation for either a nonexistent item or an item outside that list
    Then the server returns the same 404 response for both cases
    And the item lookup is constrained by the session household ID, route list ID, and item ID
    And the server does not globally look up the item or disclose item or journal data

  Scenario: Keep item history and mutation receipts household-scoped
    Given two households have independent lists, items, and mutation IDs
    When a member reads or mutates an authorized item or retries its mutation
    Then item, journal, version, and idempotency lookups are scoped to that member's household
    And no item, journal, version, or idempotency data from the other household is returned or changed

  Scenario: Require authentication before resource lookup
    Given an item mutation request has no valid session
    When the request reaches the item mutation endpoint
    Then the server returns 401
    And it performs no household resource lookup
```

## Frontend state decision matrix

| Condition | Required client behavior |
| --- | --- |
| Mutation queued offline | Persist item ID, base `itemRevision`, stable mutation ID, and changed-field patch; retain across reload and replay same-item edits in order, at most one in flight. |
| Request in progress | Keep the mutation pending until a definitive server outcome; do not create a new ID for a retry. |
| Accepted without conflicts | Replace local server-backed item, `itemRevision`, and household sync cursor (`version`) with response state and remove the resolved mutation from the active outbox. |
| Accepted with same-field conflicts | Keep the attempted values in a recoverable conflict record; show attempted and current server values; do not auto-retry. |
| `BASE_VERSION_EXPIRED` or `BASE_VERSION_AHEAD` | Keep this mutation and later same-item mutations blocked and actionable; refresh current item state and require reconciliation before creating a new mutation ID. |
| `MUTATION_ID_REUSED` | Keep intent available for diagnosis; do not retry unchanged content with that ID. |
| 401 | Preserve local intent and require sign-in before retry. |
| 403 | Preserve local intent and show an access error for an explicitly foreign list; do not expose other household data or discard the patch. |
| 404 | Preserve local intent and show the same not-found state for a missing item or an item outside the authorized list; do not expose other household data or discard the patch. |
| 400 | Preserve the local draft and expose validation details for correction. |
| 5xx/network failure | Keep the mutation pending and retry with the same ID and exact payload. |
| No pending mutations | No conflict/recovery state is shown. |

## Decisions and assumptions
### Confirmed decisions

- DECISION-1 (same-field conflict policy, user decision verbatim): `Server wins; keep offline value recoverable`. The server retains its value for the stored item, while the client preserves the attempted offline value for reconciliation.
- DECISION-2 (same-item offline queue): Keep distinct mutations and replay them in creation order, with at most one in flight per item. An unsent mutation uses its predecessor's accepted `itemRevision`; a non-accepted outcome blocks later same-item mutations until reconciliation.
- DECISION-3 (item-access status, user decision verbatim): `Use 404 for foreign/missing item on own list` — return the same 404 for both; keep 403 for an explicitly foreign list.

## Assumptions Made

- ASSUMPTION-1: The existing `PUT /api/lists/:listId/items/:itemId` endpoint is extended for this mutation contract; the household is derived from the session, not the request body.
- ASSUMPTION-2: The current mutable item fields are `name` and `crossedOff`, matching the shared item request schema; other item fields are not patchable under this story.
- ASSUMPTION-3: Each item's server-managed `itemRevision` begins at 1 and increases monotonically within that item's household. The existing household-wide `version` sync cursor retains its current shared-counter semantics; client timestamps are not used to order changes.
- ASSUMPTION-4: Hourly pruning retains every journal entry for at least 25 hours, using a one-hour margin above the issue's 24-hour minimum; a per-item `prunedThroughItemRevision` watermark identifies history that has been removed.
- ASSUMPTION-5: A base older than retained history is not automatically rebased; the API responds with a recoverable 409 and the client retains the mutation for reconciliation.
- ASSUMPTION-6: Idempotency receipts are retained for the lifetime of the item, and a retry is identical only when household, item, base item revision, mutation ID, and patch match.
- ASSUMPTION-7: Any authenticated member of the item's household may edit it. The route list is authorized against the session household before item lookup; an explicitly foreign list returns 403, while an item missing from or outside an authorized list returns the same 404. Item lookups are scoped by session household ID and route list ID before item or journal data is read.

## Open Questions

None. The previously open same-item queue strategy is resolved by DECISION-2.

## Test Awareness Matrix

| Category | Applicable? | What to test, why, and watch out for |
| --- | --- | --- |
| **Unit Tests (Backend)** | Required | Test item-revision comparisons, field intersection, server-wins conflict resolution, no-op behavior, separation from the household sync cursor, atomic journal/watermark updates, idempotency receipt matching, expired/future bases, and household-scoped lookups. Driven by AC-003–AC-009. Watch for revision boundaries, sync pagination, and transaction rollback leaving no partial row/journal/receipt state. |
| **Unit Tests (Frontend)** | Required | Test patch construction from changed fields, persistence across reload, ordered same-item replay with dependent bases, blocking dependent edits after a non-accepted outcome, stable retry payload/ID, accepted response handling, conflict and expired-base states, and 400/401/403/404/5xx handling. Driven by AC-001, AC-002, AC-004, AC-006, AC-007. Watch for accidentally serializing unchanged fields or deleting intent on non-success outcomes. |
| **API Integration Tests** | Required | Exercise `PUT /api/lists/:listId/items/:itemId` for validation, disjoint merge, overlapping merge, replay, no-op behavior, changed-content ID reuse, expired/future base, journal pruning watermark behavior, transaction atomicity, and 401/403/404. Verify `itemRevision` is separate from the existing household `version` cursor and that a `since` request using a previous cursor returns later accepted mutations; verify cross-household isolation. Driven by AC-001–AC-009. Watch that authorization occurs before querying item/journal data and that response fields agree with the frontend contract. |
| **E2E / Playwright Tests** | Required | Extend issue 17's real-API two-member journey: Sam edits offline, Alex renames online, Sam reconnects, and both values survive. Also cover same-field conflict visibility and intent persistence, expired-history recovery, retry, and household separation. Driven by AC-001, AC-004, AC-006–AC-008. Include keyboard-only use of conflict/recovery controls and responsive breakpoints if their layout changes. |
| **Accessibility (WCAG 2.1 AA)** | Required | Automated/component and E2E checks for keyboard access to conflict/recovery actions, visible focus, accessible labels and announced conflict/error status, and contrast for status indicators. Driven by AC-004 and AC-006. Watch that the attempted and server values are understandable without color alone. |
| **Translations / i18n** | Recommended | Check conflict, expired-history, validation, access-denied, and retry messaging through the existing localization approach. Driven by AC-004 and AC-006. Watch for hard-coded user-facing status text and untranslated field labels. |
| **Role-Based / Authorization** | Required | **API integration tests:** verify unauthenticated requests return 401 without resource lookup; same-household members can access authorized lists/items; explicitly foreign lists return 403 before item, journal, or receipt lookup; and foreign/missing items on an authorized list return the same 404. Driven by AC-008. Watch that client-provided household IDs cannot change scope and that authorization precedes item and journal access. |
| **Security (OWASP)** | Required | **API integration tests:** validate UUIDs, safe integer item revisions, non-empty allowlisted patches, name length/normalization, boolean types, and mutation-ID content binding; verify session-derived household authorization, item queries scoped by household/list/item, journal queries scoped by household/item, same 404 response for foreign-versus-missing items on an authorized list, 403 for explicitly foreign lists before item/journal/receipt lookups, no cross-household data leakage, and safe generic 5xx errors/logging. Driven by AC-002, AC-005–AC-008. Watch for replay, mass assignment, IDOR, global item-existence probes, and leakage of internal database details. |

## Tracker comparison

The issue snapshot's nine criteria are represented by AC-001 through AC-009. The snapshot's AC-008 currently says a member addressing another household's item receives 403. The confirmed decision changes this: an explicitly foreign list remains 403, but on an authorized list a foreign item and a missing item return the same 404. Item and journal lookups remain scoped by authenticated household and route list before foreign data can be read. The refined criteria also add explicit request/response contracts, the confirmed field conflict rule, separate item revisions and household sync cursors, ordered same-item replay, no-op behavior, hourly pruning with 25-hour retention, recoverable expired/future-base behavior, and content-bound lifetime idempotency receipts.

**Tracker verdict: Needed.** Reason: issue 37's acceptance criteria, including previously approved AC-008, must be updated to reflect the confirmed foreign/missing-item 404 decision and preserve 403 for an explicitly foreign list, in addition to the testable contracts above. No tracker change has been performed.
