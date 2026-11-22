# Requirements Analysis for Story #16 — End-to-end tests for the core journeys

## 1. Requirements

REQ-PANTRY-001: The system shall execute end-to-end tests for all core user journeys against the real API and built frontend
- Precondition: The application is built and available at a test URL
- Actor: CI/CD pipeline or developer running tests
- Priority: Must
- Tracker Story: 16

REQ-PANTRY-002: The system shall support testing on multiple browser projects (Chromium and WebKit) 
- Precondition: Playwright is configured with multiple browser projects
- Actor: Test runner
- Priority: Must
- Tracker Story: 16

REQ-PANTRY-003: The system shall test sign-in and sign-out functionality for all personas
- Precondition: Test personas are available in the system
- Actor: Test runner
- Priority: Must
- Tracker Story: 16

REQ-PANTRY-004: The system shall validate that household A's lists are not visible to household B persona
- Precondition: Two households with different users exist in test data
- Actor: Test runner
- Priority: Must
- Tracker Story: 16

REQ-PANTRY-005: The system shall perform accessibility checks on all screens using axe-core
- Precondition: Accessibility testing tools are configured
- Actor: Test runner
- Priority: Must
- Tracker Story: 16

REQ-PANTRY-006: The system shall execute E2E tests as a separate job in CI pipeline for pull requests
- Precondition: CI pipeline is configured with E2E test jobs
- Actor: CI system
- Priority: Must
- Tracker Story: 16

## 2. Refined Acceptance Criteria

AC-1: Given the E2E suite, when it runs, then it starts the API with a temporary SQLite database, seeded personas (two members of household A, one of household B), and the built frontend.
- Negative: Given an invalid test setup, when the E2E suite attempts to run, then it fails gracefully with descriptive error messages

AC-2: Given Chromium (Pixel 7) and WebKit (iPhone 14) projects, then every journey passes on both: sign in and out, wrong password, create, rename, and delete a list, add, cross off, restore, rename, and delete an item, clear crossed off, choose a suggestion.
- Negative: Given invalid user input or state, when the E2E tests attempt to execute journeys, then they fail with clear error messages

AC-3: Given the household B persona, then household A's lists are never visible.
- Negative: Given a household A user, when they access household B's data, then they receive appropriate authorization errors

AC-4: Given each screen, then an axe check reports no violations.
- Negative: Given a screen with accessibility violations, when the E2E tests run, then they report specific violation details

AC-5: Given a pull request, then CI runs the E2E suite in a separate job.
- Negative: Given a failed CI job, when the E2E tests are executed, then they fail and provide failure details

## 3. BDD Acceptance Test Scenarios

Feature: End-to-end testing for core journeys

  Scenario: Test suite initialization with test data
    Given the E2E test suite is configured
    When it starts up with a temporary SQLite database
    And personas are seeded (two members of household A, one of household B)
    And the built frontend is available
    Then the test environment is ready for execution

  Scenario: Test execution on Chromium and WebKit browsers
    Given Chromium (Pixel 7) and WebKit (iPhone 14) browser projects are configured
    When E2E tests run on both browsers
    Then all core journeys pass successfully on both browsers:
      - Sign in and out
      - Wrong password handling
      - Create, rename, and delete a list
      - Add, cross off, restore, rename, and delete an item
      - Clear crossed off items
      - Choose a suggestion

  Scenario: Household data isolation
    Given the household B persona is active
    When attempting to access household A's lists
    Then household A's lists are never visible to household B users

  Scenario: Accessibility compliance check
    Given each screen in the application
    When axe-core accessibility checks are performed
    Then no violations are reported for any screen

  Scenario: CI pipeline execution
    Given a pull request is submitted
    When CI runs E2E tests in a separate job
    Then all core journeys are tested and validated

## 4. Test Awareness Matrix

## Test Awareness Matrix

| Category                          | Applicable?    | Notes / What to Test |
|-----------------------------------|----------------|----------------------|
| **Unit Tests (Backend)**          | Not Applicable | This is an E2E story, not backend unit tests |
| **Unit Tests (Frontend)**         | Not Applicable | This is an E2E story, not frontend unit tests |
| **API Integration Tests**         | Not Applicable | This is an E2E story, not API integration tests |
| **E2E / Playwright Tests**        | Required       | All core journeys including sign-in/out, list/item management, suggestions, and accessibility checks must be tested across multiple browsers |
| **Accessibility (WCAG 2.1 AA)**   | Required       | Axe-core checks must be run on each screen to verify WCAG 2.1 AA compliance |
| **Translations / i18n**           | Recommended    | Check that localized strings are properly displayed in different locales |
| **Role-Based / Authorization**    | Required       | Test that users can only access their own household data and not cross-contaminate between households |
| **Security (OWASP)**              | Required       | Test that unauthorized access attempts fail appropriately |

## 5. Assumptions Made

- The existing Playwright setup and testing infrastructure is already in place
- The backend API and frontend are built and can be served for testing  
- Test personas (users) have been defined with appropriate household memberships
- The core functionality of the application has been implemented to support these journeys
- The CI pipeline is already configured to run E2E tests
- The existing fixtures and test patterns are sufficient for this implementation
- Browser projects for Chromium and WebKit are properly configured in Playwright

## 6. Open Questions and Clarifications Needed

1. **Test Data Management**: What is the exact mechanism for seeding personas into the temporary SQLite database? Are there specific seed scripts or methods?

2. **Browser Configuration Details**: Are there specific device emulations needed beyond Pixel 7 and iPhone 14, or are these sufficient for testing core journeys?

3. **Error Handling Coverage**: Should error scenarios (like wrong password) be tested in isolation, or is it sufficient to test them as part of the main journey flow?

4. **Suggestion Functionality Tests**: What specific functionality should be tested regarding suggestions? How many suggestions should be validated?

5. **Test Coverage Scope**: Are there any additional journeys beyond those explicitly mentioned that should be included in the core journeys coverage?

6. **Accessibility Testing**: Should accessibility checks include all WCAG 2.1 AA criteria, or are there specific ones that are more critical to test first?

7. **CI Pipeline Details**: What exactly constitutes a "separate job" for E2E tests in the CI pipeline - should it be a dedicated workflow or just a separate step?

8. **Test Parallelization**: How will the tests be parallelized across different browsers and test scenarios?