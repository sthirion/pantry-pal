# Requirements for Story #6 - Lists API: create, rename, and delete lists

## Reconciliation

The refreshed issue snapshot (2026-11-13; issue updated 2026-11-11) has the same backend-only scope and the same eight list API acceptance criteria as the story plan. The new issue comment adds a test awareness matrix, but its frontend unit and accessibility categories do not apply to this backend-only story. This document aligns test applicability with the plan without changing the issue or plan.

## Assumptions Made

- ASSUMPTION-1: The request name is normalized by trimming and collapsing whitespace before applying the 1-to-100-character limit; this follows the existing shared `displayName` schema.
- ASSUMPTION-2: Same-name comparison uses the normalized household `name_key` and only live lists, as required by the issue and the existing partial unique index.
- ASSUMPTION-3: The response `ShoppingList` projection follows the shared type: `id`, `name`, numeric `version`, string `updatedAt`, and nullable string `deletedAt`; a live list has `deletedAt: null`.
- ASSUMPTION-4: Household members with either existing membership role (`owner` or `member`) can manage lists; the issue names household members and specifies no role distinction.
- ASSUMPTION-5: The shared write version assigned to an applied list change is the version announced to that household's event-hub subscribers. Event-stream framing remains in the live-updates story.
- ASSUMPTION-6: Last-write-wins ignores a `changedAt` instant only when it is older than the stored change instant; equality is applied, consistent with the feature design's rule that an older value is the only unapplied case.
- ASSUMPTION-7: `PUT` is an upsert: an unknown valid UUID creates a list; a soft-deleted list with the same UUID is restored when its `changedAt` is not older than the stored change time, consistent with the feature API design's last-write-wins rule.
- ASSUMPTION-8: Same-name lookup considers live lists only. A soft-deleted same-name list is not a merge target, so the request creates a new live list with the requested UUID.
- ASSUMPTION-9: A same-name merge targets and applies to the existing live list. Its clamped `changedAt` is compared with that row's `updated_at`: an equal or newer timestamp applies the write and assigns a new version, while only an older timestamp is ignored. The approved design does not specify whether the merge changes the stored display-name spelling/casing.
- ASSUMPTION-10: A successful same-name merge preserves the existing row's display-name spelling/casing because the merge returns that existing row; names remain stored as typed, with no casing conversion.

## Requirements

REQ-BACKEND-LIST-001: The system shall let an authenticated household member create or rename a list through `PUT /api/lists/{listId}`. Precondition: the request targets the caller's household and has an accepted client-generated UUID and list name. Actor: household member. Priority: Must. Tracker Story: #6.

REQ-BACKEND-LIST-002: The system shall apply list writes using the shared version counter and last-write-wins rules, clamp future `changedAt` values to server time, and publish the resulting household version to SSE subscribers for applied writes. Precondition: the write is authorized. Actor: household member. Priority: Must. Tracker Story: #6.

REQ-BACKEND-LIST-003: The system shall merge a create request into an existing live same-name list within the household, and reject a rename that conflicts with another live list using `409 name_taken`. Precondition: the caller belongs to the target household. Actor: household member. Priority: Must. Tracker Story: #6.

REQ-BACKEND-LIST-004: The system shall soft-delete a list and its items atomically through `DELETE /api/lists/{listId}`, return `204`, and make repeated deletes idempotently return `204`. Precondition: the caller belongs to the target household. Actor: household member. Priority: Must. Tracker Story: #6.

REQ-BACKEND-LIST-005: The system shall deny access to another household's list with `403` for any list endpoint. Precondition: the target list belongs to a different household. Actor: authenticated household member. Priority: Must. Tracker Story: #6.

## Acceptance Criteria

### API Contract

- `PUT /api/lists/{listId}` accepts a client-generated UUID in the path and a JSON body with required `name` (string) and `changedAt` (ISO 8601 date-time string with an offset). The name is normalized by trimming and collapsing whitespace, then must contain 1 to 100 characters. `changedAt` must be a valid date-time; a future value is clamped as described by AC-003.
- `DELETE /api/lists/{listId}?changedAt={iso}` takes the list UUID in the path and an ISO 8601 `changedAt` query parameter; it has no request body.
- Successful `PUT` responses use the feature design's exact `{ "list": ShoppingList, "applied": boolean, "mergedFromId"?: string }` envelope. The list fields are `id` and `name` (strings), `version` (integer), `updatedAt` (UTC ISO 8601 with millisecond precision and trailing `Z`), and `deletedAt` (the same timestamp format or `null`). Creation returns `201` with `applied: true`; replay, rename, stale write, and same-name merge return `200`. For an existing live same-name list, `mergedFromId` equals the requested UUID and the merge targets that existing row. Compare the clamped `changedAt` with the row's `updated_at`: an equal or newer timestamp applies the write, returns `applied: true`, assigns a new shared version, and publishes that version; only an older timestamp returns `applied: false` with the unchanged row and no new version or event.
- `PUT` is an upsert: a valid UUID not present in the caller's household creates a list (`201`). A same-ID soft-deleted list is restored when `changedAt` is equal to or later than its stored change time (`200`, `applied: true`, `deletedAt: null`); an older timestamp returns `200`, `applied: false`, and the unchanged stored projection. A same-name create checks live lists only and does not merge into a soft-deleted same-name list.
- Validation failures, including invalid path UUID, invalid/missing name, and invalid/missing `changedAt`, return `400` with `{"error":{"code":"validation_failed","message":"Request is invalid.","details":[{"path":"...","message":"..."}]}}`; details identify each failing input path. Invalid JSON is also `400 validation_failed` with a root-path detail. The name-length detail uses the existing schema message `Must be 1 to 100 characters.`
- A missing or invalid session returns `401` with `{"error":{"code":"unauthenticated","message":"Authentication required."}}`. An authenticated user without household membership or targeting another household's list receives `403` with `{"error":{"code":"forbidden","message":"Forbidden."}}`. Household members have no additional list-specific role restriction in the issue or current guard.
- Mutating `PUT` and `DELETE` requests follow the design's shared Origin check: a present `Origin` must equal configured `PUBLIC_ORIGIN`; when `Origin` is absent, `Sec-Fetch-Site: cross-site` is rejected. A failed check returns `403 forbidden` before body parsing or mutation.
- A rename conflict returns `409` with `{"error":{"code":"name_taken","message":"Name is already in use."}}`. `DELETE` returns `204` with no body when it soft-deletes the list and its items, or when the valid UUID identifies a caller-household list already soft-deleted or a list missing globally. If `changedAt` is older than the live list's stored change time, it returns `200` with `{"list":<current ShoppingList>,"applied":false}` and makes no change. A list belonging to another household returns `403`, not `204`. A malformed UUID or invalid/missing `changedAt` returns `400 validation_failed` with the corresponding detail path (`listId` or `changedAt`). Thus valid unknown `PUT` IDs create, while valid unknown `DELETE` IDs are idempotent. An unknown `/api/*` route returns `404` with `{"error":{"code":"not_found","message":"Not found."}}` under the shared API error contract.

### AC-001: Create a list idempotently and validate its request

Given an authenticated household member supplies a UUID not present in their household and a JSON body with a normalized name of 1 to 100 characters and an ISO 8601 `changedAt`, when they call `PUT /api/lists/{listId}`, then the API returns `201` with `{"list":{"id":"<requested UUID>","name":"<normalized name>","version":<integer>,"updatedAt":"<UTC ISO 8601 with milliseconds and Z>","deletedAt":null},"applied":true}`. When the identical request is replayed, then it returns `200` with the stored projection, `applied: false`, and the same version; it makes no further change or event. A valid unknown UUID is a create, not a `404`. If the path UUID is malformed, the normalized name is empty or longer than 100 characters, or `changedAt` is missing or malformed, then the API returns `400 validation_failed` with a detail for each invalid input and does not create or change a list.

### AC-002: Rename with last-write-wins

Given an existing list belongs to the caller's household, when the caller submits a valid rename with a `changedAt` instant equal to or later than the stored change instant, then the API returns `200` with `{"list":<resulting ShoppingList>,"applied":true}`, increments the shared version, and returns UTC-millisecond `updatedAt`. When `changedAt` is older than the stored instant, then it returns `200` with `{"list":<unchanged stored ShoppingList>,"applied":false}`, leaves the stored name, timestamps, and version unchanged, and publishes no household version. Timestamp comparison is by instant, so equivalent ISO 8601 values with different offsets are equal.

### AC-003: Clamp future change time and accept the clock boundary

Given an authorized list write has a valid `changedAt` later than server time, when the write is applied, then the list's `updatedAt` is stored as server time, not the future client time. As a boundary case, when a newer write's `changedAt` equals server time, then the write is accepted and `updatedAt` is that time without future-time clamping.

### AC-004: Merge a same-name create into the existing live list only within the household

Given a live list named `Market` exists in the caller's household, when the caller creates a list with a different id and normalized name `market`, then the API returns `200` with the existing live list and `mergedFromId` equal to the requested UUID. If the request's `changedAt`, after clamping to server time, is equal to or newer than the existing row's `updated_at`, then the merge applies to that existing row, returns `applied: true`, assigns it a new shared version, and publishes that version. If the clamped timestamp is older, then the API returns `applied: false` with the unchanged existing row and does not assign a version or publish an event. If only another household has a live list with that name, or only a soft-deleted list in the caller's household has that name, then the caller's create returns `201` with the requested UUID and does not expose or merge the other/soft-deleted list. The approved design does not settle whether a successful merge changes the existing row's display-name spelling/casing.

### AC-005: Reject a conflicting rename

Given another live list in the caller's household already uses the requested normalized name, when the caller renames a list to that name, then the API returns `409 name_taken` and does not apply the rename or change its version.

### AC-006: Soft-delete a list and its items idempotently

Given a live list in the caller's household exists, when the caller invokes `DELETE /api/lists/{listId}?changedAt={iso}` with a valid `changedAt` equal to or later than the stored change time, then the list and its items are soft-deleted in one transaction and the API returns `204` with no body. A repeated delete or a delete of a caller-household list already soft-deleted also returns `204`; a valid UUID with no list anywhere in the system also returns `204`. If `changedAt` is older than the live list's stored change time, the API returns `200` with the current list and `applied: false`, without changing the list or items. A malformed UUID returns `400 validation_failed` with a detail path of `listId`; a missing or malformed `changedAt` returns `400 validation_failed` with a detail path of `changedAt`. Neither validation failure changes any list or item. A list owned by another household returns `403`.

### AC-007: Enforce household isolation and mutation origin checks

Given a list belongs to another household, when an authenticated caller targets it through any list endpoint, including `DELETE /api/lists/{listId}`, then the API returns `403 forbidden` and does not expose or modify the list. For mutating `PUT` and `DELETE` requests, a present `Origin` that differs from configured `PUBLIC_ORIGIN`, or an absent `Origin` with `Sec-Fetch-Site: cross-site`, also returns `403 forbidden` before body parsing or mutation. This is distinct from a globally missing UUID, which follows AC-006 and returns `204` for DELETE.

### AC-008: Publish applied writes only, including successful same-name merges

Given one or more SSE subscribers are connected for the caller's household, when a list write is applied, including a same-name merge whose clamped `changedAt` is equal to or newer than the existing row's `updated_at`, then every subscriber receives the new version through the event hub. When a same-name merge's clamped timestamp is older than the existing row's `updated_at`, or any other stale write is ignored with `applied: false`, then it does not advance or publish a new version.

## BDD Acceptance Test Scenarios

```gherkin
Feature: Lists API create, rename, and delete

  Scenario: Create a list and replay the same request
    Given an authenticated household member and a new client-generated UUID
    When they create a list with a valid JSON body containing name and changedAt
    Then the API returns 201 with the ShoppingList fields and a new version
    When they replay the identical request body
    Then the API returns 200 and the stored list and version do not change again

  Scenario: Reject invalid list request inputs
    Given an authenticated household member
    When they send a malformed list UUID, an empty or over-100-character normalized name, or a missing or malformed changedAt
    Then the API returns 400 validation_failed with details identifying invalid inputs
    And no list is created or changed

  Scenario: Reject a malformed DELETE UUID
    Given an authenticated household member
    When they call DELETE /api/lists/not-a-uuid with a valid changedAt query parameter
    Then the API returns 400 validation_failed with a detail path of listId
    And no list or item is changed

  Scenario: Apply a newer rename and ignore an older rename
    Given a list exists in the caller's household
    When the caller submits a rename with a newer changedAt
    Then the API returns 200 with applied true
    When the caller submits a rename with an older changedAt
    Then the API returns 200 with applied false and the stored list remains unchanged

  Scenario: Apply a write with an equal stored change timestamp
    Given a list exists in the caller's household with a stored change timestamp
    When the caller submits a different name with changedAt equal to that stored instant
    Then the API returns 200 with the updated list and applied true
    And its version advances and the household event hub publishes the new version

  Scenario: Restore a soft-deleted list by UUID with a newer write
    Given a soft-deleted list exists in the caller's household
    When the caller sends a valid PUT for the same UUID with a strictly newer changedAt
    Then the API returns 200 with applied true and deletedAt null
    And the restored list receives the new shared version

  Scenario: Clamp a future changedAt
    Given a list exists in the caller's household
    When the caller applies a write with changedAt later than server time
    Then the stored updatedAt is server time

  Scenario: Accept changedAt at the server-time boundary
    Given a list exists and the caller's changedAt is newer than its stored change
    When the caller applies a write with changedAt equal to server time
    Then the write is accepted
    And updatedAt is that time without future-time clamping

  Scenario: Apply a same-name merge with an equal or newer clamped timestamp
    Given a live list named Market exists in the caller's household
    And its updated_at is not later than the request's changedAt after server-time clamping
    When the caller creates a different id with the name " market "
    Then the API returns 200 with the existing list and applied true
    And mergedFromId is the requested id
    And the existing list receives a new shared version
    And the household event hub publishes that version

  Scenario: Ignore a stale same-name merge
    Given a live list named Market exists in the caller's household
    And its updated_at is later than the request's changedAt after server-time clamping
    When the caller creates a different id with the name " market "
    Then the API returns 200 with the unchanged existing list and applied false
    And mergedFromId is the requested id
    And the existing list receives no new version
    And the household event hub publishes no new version for that write

  Scenario: Do not merge a same-name list from another household
    Given only another household has a live list named Market
    When the caller creates a list named market with their own UUID
    Then the API returns 201 with the caller's requested id
    And it does not expose or merge the other household's list

  Scenario: Do not merge a new UUID into a soft-deleted same-name list
    Given only a soft-deleted list named Market exists in the caller's household
    When the caller creates a different UUID with the normalized name market
    Then the API returns 201 with the requested UUID
    And the deleted list is not returned or modified

  Scenario: Reject a rename that conflicts with another live list
    Given another live list has the requested name in the caller's household
    When the caller renames a list to that name
    Then the API returns 409 with error code name_taken
    And the rename is not applied

  Scenario: Delete a list and replay the delete
    Given a list with items exists in the caller's household
    When the caller deletes the list with a valid changedAt that is not older than the stored change time
    Then the API returns 204 and the list and items are soft-deleted atomically
    When the caller repeats the delete
    Then the API returns 204

  Scenario: Delete a caller-household list that is already soft-deleted
    Given the list UUID belongs to a list in the caller's household that is already soft-deleted
    When the caller deletes that UUID with a valid changedAt
    Then the API returns 204 with no body

  Scenario: Delete a globally missing list idempotently
    Given an authenticated household member
    When they delete a valid UUID with no list record in any household
    Then the API returns 204 with no body

  Scenario: Do not treat another household's list as missing
    Given the target list belongs to another household
    When the caller deletes that list with a valid UUID and changedAt
    Then the API returns 403 forbidden
    And the target list and its items are neither exposed nor modified

  Scenario: Do not apply a stale list delete
    Given a live list in the caller's household has a stored change time newer than the delete changedAt
    When the caller deletes the list
    Then the API returns 200 with the current list and applied false
    And the list and its items remain unchanged

  Scenario: Notify every household SSE subscriber of an applied write
    Given multiple SSE subscribers are connected for the household
    When an authorized list write is applied
    Then every subscriber receives the new household version through the event hub

  Scenario: Do not publish an ignored stale write
    Given an SSE subscriber is connected and a list has a newer stored change
    When the caller submits an older write and the API reports applied false
    Then the stored version does not advance
    And the event hub publishes no new version for that write

  Scenario: Reject an unauthenticated list request
    Given a caller has no valid session
    When they call a list endpoint
    Then the API returns 401 unauthenticated

  Scenario: Return the shared not-found error for an unknown API route
    Given an authenticated caller
    When they request an unknown /api route
    Then the API returns 404 with {"error":{"code":"not_found","message":"Not found."}}

```

## Test Awareness Matrix

| Category | Applicable? | What to test, why, and watch-outs |
| --- | --- | --- |
| Unit Tests (Backend) | Required | Automated level: Vitest unit tests. Test shared name/UUID/timestamp validation and normalization, last-write-wins decisions, future-time clamping, and version/event publication decisions. Driven by AC-001 through AC-005 and AC-008. Watch out for normalized 1/100/101-character boundaries, malformed timestamps, stale writes including same-name merges, and equality at the server-time boundary. |
| Unit Tests (Frontend) | Not Applicable | This story is backend-only; no list-management UI is in scope. |
| API Integration Tests | Required | Automated level: Vitest API/database integration tests. Exercise `PUT` and `DELETE` over the app with authenticated household fixtures; assert schemas/status/error bodies, merge/conflict behavior, atomic soft delete, 401/403 authorization, and event-hub publication. Driven by AC-001 through AC-008. Watch out for cross-household fixtures, equal/newer versus older same-name merge timestamps, rollback, and unchanged state on rejected or unapplied writes. |
| E2E / Playwright Tests | Required | Automated level/scope: a Playwright API-level end-to-end scenario against the running app, without requiring a browser UI journey. Exercise create, rename, delete, and the HTTP-write-to-event-hub version flow through real route, middleware, database, and event-hub wiring. Driven by AC-001, AC-002, AC-006, and AC-008. Watch out for deterministic timestamps, isolated household fixtures, and asserting events without arbitrary sleeps. |
| Accessibility (WCAG 2.1 AA) | Not Applicable | No user interface or accessibility behavior is changed in this backend-only story. |
| Translations / i18n | Not Applicable | This story adds no localized UI copy; list names are user data and should not be translated. |
| Role-Based / Authorization | Required | Automated level: Vitest API integration tests. Cover `401 unauthenticated`, `403 forbidden` for cross-household access and authenticated users without household membership, plus access by the supported household membership roles; no separate list role is specified. Driven by AC-001 and AC-007. Watch out for resolving household identity from the session/database, not client input, before resource access. |
| Security (OWASP) | Required | Automated levels: Vitest unit tests for input validation and Vitest API integration tests for auth, household isolation, CSRF, and error responses. Cover malformed UUID/name/timestamp rejection, name text treated as data, authorization before list access, the shared Origin/`Sec-Fetch-Site` rules on mutations, and detail-free errors outside validation details. Driven by AC-001, AC-005, and AC-007. Watch out for no mutation on invalid input or failed origin checks, no cross-household disclosure, and no leakage of SQL or internal error details. |

## Open Questions

None. The same-name merge display-name spelling/casing decision is recorded in ASSUMPTION-10.