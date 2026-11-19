# Requirements Analysis for Story 13: List items screen

## Level 1: Requirements

REQ-PANTRY-001: The system shall display an add field at the top of the list screen for adding new items
- Precondition: User is on a list items screen
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-002: The system shall allow users to add items by typing in the add field and pressing Enter or clicking the + button
- Precondition: Add field is visible on the screen
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-003: The system shall validate item names for empty inputs or inputs over 200 characters and display inline error messages
- Precondition: User attempts to add an item
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-004: The system shall restore existing items instead of creating duplicates when adding a name that matches an existing item (case-insensitive)
- Precondition: An item with the same name (case-insensitive) already exists in either active or crossed-off sections
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-005: The system shall move active items to the crossed-off section when tapped, and restore crossed-off items back to active status when tapped
- Precondition: User interacts with an item in either active or crossed-off section
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-006: The system shall display crossed-off items in reverse chronological order (most recent first)
- Precondition: There are crossed-off items in the list
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-007: The system shall provide a menu for each item to rename or delete that item
- Precondition: User is viewing an item
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-008: The system shall allow users to clear all crossed-off items at once
- Precondition: There are crossed-off items in the list
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

REQ-PANTRY-009: The system shall update the screen in under 100ms for all user interactions, both online and offline
- Precondition: User performs any interaction with the list items screen
- Actor: Shopper
- Priority: Must
- Tracker Story: #13

## Level 2: Acceptance Criteria

AC-001: Given the add field, when I type a name and press Enter or `+`, then the item appears in the active section and the field stays focused and empty.
- Negative: Given an invalid name (empty or over 200 characters), when I press Enter or click `+`, then I see an inline error and nothing is added.

AC-002: Given an empty name or one over 200 characters, then I see an inline error and nothing is added.
- Negative: Given a valid item name, when I press Enter or click `+`, then the item is added to the active list.

AC-003: Given a crossed-off item "milk", when I add "Milk", then the existing item is restored instead of a duplicate; given an active "milk", then nothing is added and the existing item is highlighted.
- Negative: Given two different items, when I add both, then both are added to the list.

AC-004: Given an active item, when I tap it, then it moves to "Crossed Off" with strikethrough; when I tap a crossed-off item, then it moves back.
- Negative: Given a list with no items, when I tap on the list area, nothing happens.

AC-005: Given several crossed-off items, then the most recently crossed off is first.
- Negative: Given multiple items crossed off at different times, then they appear in chronological order (oldest to newest).

AC-006: Given the item menu, when I rename (same validation, inline error on a duplicate) or delete, then the change shows immediately.
- Negative: Given an item with a valid name, when I attempt to rename it to a name that already exists in the list, then I see an inline error and the name is not changed.

AC-007: Given crossed-off items, when I confirm "Clear crossed off", then exactly the items shown as crossed off are removed.
- Negative: Given crossed-off items, when I tap on the clear button, then only those specific items are removed from the list.

AC-008: Given any of these actions, then the screen updates in under 100 ms, online or offline.
- Negative: Given a large list with many items, when I perform an action, then the UI update completes within 100ms.

## Level 3: BDD Acceptance Test Scenarios

Feature: List Items Screen

  Scenario: Add new item to active section
    Given the add field is visible on the screen
    When I type "apples" and press Enter
    Then the item "apples" appears in the active section
    And the add field stays focused and empty

  Scenario: Add item with invalid name
    Given the add field is visible on the screen
    When I type "" (empty string) and press Enter
    Then I see an inline error message
    And nothing is added to the list

  Scenario: Add item exceeding character limit
    Given the add field is visible on the screen
    When I type a name over 200 characters and press Enter
    Then I see an inline error message
    And nothing is added to the list

  Scenario: Restore existing item instead of creating duplicate
    Given there is a crossed-off item "milk"
    When I add "Milk" (same name, different case)
    Then the existing "milk" item is restored to active status
    And no new duplicate item is created

  Scenario: Cross off active item
    Given there is an active item "bread"
    When I tap on the "bread" item
    Then the item moves to crossed-off section
    And the item is displayed with strikethrough

  Scenario: Restore crossed-off item
    Given there is a crossed-off item "milk"
    When I tap on the "milk" item
    Then the item moves back to active section
    And the item is displayed without strikethrough

  Scenario: Crossed-off items appear in reverse chronological order
    Given there are multiple crossed-off items
    When I view the crossed-off section
    Then the most recently crossed off item appears first

  Scenario: Rename item through menu
    Given I am viewing an item with a menu
    When I select rename from the menu and enter "bananas"
    Then the item name changes to "bananas"
    And the change is shown immediately

  Scenario: Delete item through menu
    Given I am viewing an item with a menu
    When I select delete from the menu
    Then the item is removed from the list immediately

  Scenario: Clear all crossed-off items
    Given there are several crossed-off items
    When I confirm "Clear crossed off"
    Then exactly the items shown as crossed off are removed from the list

  Scenario: Screen updates within 100ms threshold
    Given I am interacting with the list screen
    When I perform an action (add, cross off, delete, etc.)
    Then the screen updates in under 100 ms

## Test Awareness Matrix

## Test Awareness Matrix

| Category                          | Applicable?    | Notes / What to Test |
|-----------------------------------|----------------|----------------------|
| **Unit Tests (Backend)**          | Required       | Service logic for item creation, cross-off/restore, duplicate detection, validation, clear crossed-off functionality |
| **Unit Tests (Frontend)**         | Required       | Component rendering of active items, crossed-off items, add form, item menu, performance testing within 100ms threshold |
| **API Integration Tests**         | Required       | Testing endpoints for item PUT, DELETE, and delete-batch operations through sync engine |
| **E2E / Playwright Tests**        | Required       | Complete flow from adding items to crossing them off, renaming, deleting, and clearing crossed-off |
| **Accessibility (WCAG 2.1 AA)**   | Required       | Keyboard navigation through list items, screen reader announcements for item states, focus management during interactions |
| **Translations / i18n**           | Recommended    | Labels, error messages, item names - check for hardcoded strings |
| **Role-Based / Authorization**    | To Clarify     | Which roles can interact with items? Are personal elections visible to all roles? |
| **Security (OWASP)**              | Required       | Input validation on item names, no injection in name fields |

## Assumptions Made

- The existing sync engine and database layer are properly implemented and working
- The UI will use the existing component structure with components like ListRow.tsx for displaying items
- All item operations follow the existing patterns established in mutations.ts and db.ts
- Performance requirements can be met with current implementation approach
- Cross-platform compatibility is handled by the existing PWA framework

## Open Questions

1. What is the exact character limit for item names? (200 characters mentioned, but what's the actual requirement?)
2. Should case-sensitive or case-insensitive matching be used for duplicate detection?
3. How should validation errors be displayed in different UI states (empty field, over-length, etc.)?
4. What are the specific requirements for the "most recently crossed off is first" ordering?
5. Should there be a limit on the number of crossed-off items displayed?
6. Are there any specific accessibility requirements beyond WCAG 2.1 AA that need to be considered?
7. How should the UI behave when offline vs online?
8. What are the specific performance testing requirements for the 100ms threshold?
