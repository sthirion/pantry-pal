# Requirements Analysis for Story 12: Lists screen

## Requirements

REQ-APP-LIST-001: The system shall display household lists in case-insensitive alphabetical order using Intl.Collator with sensitivity: 'base'
- Precondition: User is on the home screen
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-002: The system shall show the number of items not crossed off for each list
- Precondition: Lists exist in the household
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-003: The system shall allow creating new lists with valid names that appear immediately online or offline
- Precondition: User is on home screen
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-004: The system shall validate list names and show inline errors for invalid inputs
- Precondition: User attempts to create or rename a list
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-005: The system shall allow renaming and deleting lists with immediate updates
- Precondition: List exists in the household
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-006: The system shall display an empty state when no lists exist, inviting user to create one
- Precondition: No lists exist for the household
- Actor: Household member
- Priority: Must
- Tracker Story: 12

REQ-APP-LIST-007: The system shall allow navigation to a list screen by tapping on a list item
- Precondition: User is on home screen with lists displayed
- Actor: Household member
- Priority: Must
- Tracker Story: 12

## Acceptance Criteria

AC-001: Given lists "pharmacy", "Garden Center", and "Market", when the screen opens, then they appear as "Garden Center", "Market", "pharmacy" (case-insensitive order), each with its number of items not crossed off.
- Negative: Given invalid list names (empty, over 100 chars, duplicate), when user attempts to create a list, then inline error is shown and nothing is created.

AC-002: Given I create a list with a valid name, then it appears immediately, online or offline.
- Negative: Given invalid name input, when user creates list, then inline validation error shown and no list created.

AC-003: Given an empty name, a name over 100 characters, or a name that matches an existing list ignoring case and spacing, then I see an inline error and nothing is created.
- Negative: Given duplicate names (case insensitive), when user creates/renames list, then inline error shown and no action taken.

AC-004: Given I rename or delete a list (delete after confirming), then the change shows immediately.
- Negative: Given failed sync operation, when user renames/deletes list, then error message shown and changes reverted.

AC-005: Given no lists, then I see an empty state that invites me to create one.
- Negative: Given network failure during load, when user opens screen, then appropriate loading/error state shown.

AC-006: Given I tap a list, then its list screen opens.
- Negative: Given invalid list ID or missing data, when user taps list, then appropriate error handling occurs.

## BDD Acceptance Test Scenarios

Feature: Lists screen

  Scenario: Display lists in correct alphabetical order
    Given the household has lists "pharmacy", "Garden Center", and "Market"
    When the home screen opens
    Then lists appear as "Garden Center", "Market", "pharmacy" in case-insensitive alphabetical order
    And each list shows the number of items not crossed off

  Scenario: Create new list with valid name
    Given I am on the home screen
    When I enter a valid list name and submit
    Then the new list appears immediately on the screen
    And the list is available offline

  Scenario: Attempt to create list with invalid name
    Given I am on the home screen
    When I enter an empty name, name over 100 characters, or duplicate name and submit
    Then I see an inline error message
    And no new list is created

  Scenario: Rename existing list
    Given I have an existing list
    When I rename the list with a valid name
    Then the list name updates immediately on screen
    And the change is synchronized to backend

  Scenario: Delete list with confirmation
    Given I have an existing list
    When I tap delete and confirm the action
    Then the list disappears from the screen immediately
    And the deletion is synchronized to backend

  Scenario: View empty state when no lists exist
    Given there are no lists in the household
    When I open the home screen
    Then I see an empty state message inviting me to create a list

  Scenario: Navigate to list screen
    Given I am on the home screen with lists displayed
    When I tap on a list item
    Then the list screen for that list opens

## Test Awareness Matrix

## Test Awareness Matrix

| Category                          | Applicable?    | Notes / What to Test |
|-----------------------------------|----------------|----------------------|
| **Unit Tests (Backend)**          | Required       | [Test list CRUD operations, validation logic, sorting functions] |
| **Unit Tests (Frontend)**         | Required       | [Test component rendering with lists, empty state handling, input validation] |
| **API Integration Tests**         | Required       | [Test PUT/DELETE endpoints for list operations, sync engine integration] |
| **E2E / Playwright Tests**        | Required       | [Test full user journey: home screen load, create list, rename list, delete list] |
| **Accessibility (WCAG 2.1 AA)**   | Required       | [Ensure proper focus management when navigating lists, screen reader support for list items and counts] |
| **Translations / i18n**           | Recommended    | [Verify all UI text is translatable, especially empty state message] |
| **Role-Based / Authorization**    | To Clarify     | [Determine if different roles have different access to lists] |
| **Security (OWASP)**              | Required       | [Validate input sanitization for list names, prevent injection attacks] |

## Assumptions Made

- The application uses Dexie.js for local storage and sync engine integration
- All list operations are implemented through the sync engine with PUT/DELETE endpoints
- The UI components will be built using React or similar framework
- The `Intl.Collator` with `sensitivity: 'base'` is used correctly for case-insensitive sorting
- The application handles offline scenarios by queuing operations until connection is restored
- Empty state messages are consistent with other empty states in the application