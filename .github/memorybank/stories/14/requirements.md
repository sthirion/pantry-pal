# Requirements Analysis for Story 14: Item suggestions

Source: tracker story #14 (fetched 2026-11-19). Scope: frontend. Effort: S.

## Level 1: Requirements

REQ-PANTRY-001: The system shall suggest previously used item names under the add field as the shopper types, matching where the typed text starts the name or any word in it, case-insensitively.
- Precondition: The add field contains at least one non-blank character
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

REQ-PANTRY-002: The system shall show at most 8 suggestions, ordered by use count (highest first), then by most recent use.
- Precondition: More than 8 names match
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

REQ-PANTRY-003: The system shall not suggest an item that is already active on the current list.
- Precondition: An active item on the list has the same name (case-insensitive)
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

REQ-PANTRY-004: The system shall add the item when the shopper chooses a suggestion by tap or keyboard.
- Precondition: Suggestions are shown
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

REQ-PANTRY-005: The system shall match suggestions from local data so they appear offline, including names added while offline.
- Precondition: The device is offline
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

REQ-PANTRY-006: The add field and its suggestions shall follow the ARIA combobox pattern.
- Precondition: A screen reader or keyboard is in use
- Actor: Shopper
- Priority: Must
- Tracker Story: #14

## Acceptance Criteria

- Given suggestions "ice cream", "iced tea", and "rice", when I type "ic", then "ice cream" and "iced tea" are shown and "rice" is not; when I type "cre", then "ice cream" is shown (word start).
- Given more than 8 matches, then the top 8 by use count, then most recent use, are shown.
- Given an item is already active on the list, then it is not suggested.
- Given I choose a suggestion by tap or keyboard, then that item is added.
- Given I am offline, then suggestions still appear, including names I added while offline.
- Given a screen reader, then the field and suggestions follow the combobox pattern.

## Design Decisions

- Choosing a suggestion goes through the same path as typing the name and pressing Enter, so choosing a crossed-off item restores it and choosing an active one is not offered.
- The cache in `db.suggestions` is replaced from `GET /api/suggestions` when the add field mounts; a failed request leaves the cache as it is.
- Names that exist only in local items (added offline, not yet synced) are merged in at read time, so no write path changes.

## Definition of Done

- WireMock stub for `GET /api/suggestions` with enough entries to test ranking: `wiremock/mappings/suggestions-stubs.json`.

## API Contract

`GET /api/suggestions` returns `{ "suggestions": [{ "name", "useCount", "lastUsedAt" }] }`, at most 2000, most recently used first.
