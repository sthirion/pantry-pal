## Requirements

REQ-PANTRY-001: The system shall display a sign-in screen when the user is not authenticated
- Precondition: User is not signed in
- Actor: Household member
- Priority: Must
- Tracker Story: #10

REQ-PANTRY-002: The system shall support installable PWA functionality on mobile devices
- Precondition: Production build is available
- Actor: Household member
- Priority: Must
- Tracker Story: #10

REQ-PANTRY-003: The system shall automatically apply light or dark theme based on device preferences
- Precondition: Device has theme preference set
- Actor: Household member
- Priority: Must
- Tracker Story: #10

REQ-PANTRY-004: The system shall provide sign-in flow with appropriate error handling
- Precondition: User is not signed in
- Actor: Household member
- Priority: Must
- Tracker Story: #10

REQ-PANTRY-005: The system shall provide sign-out functionality that clears local data
- Precondition: User is signed in
- Actor: Household member
- Priority: Must
- Tracker Story: #10

## Acceptance Criteria

AC-001: Given the production build, when opened in Chrome on Android or Safari on iOS, then it can be added to the home screen and opens full screen; the Lighthouse installability check passes.
- Negative: Given a non-compliant manifest or missing service worker, when the app is loaded, then it fails the Lighthouse installability check

AC-002: Given the device prefers dark (or has no preference), then the dark theme is shown; given it prefers light, then the light theme is shown; text contrast meets WCAG AA in both.
- Negative: Given a device with unsupported theme preference, when the app loads, then it defaults to dark theme

AC-003: Given I am not signed in, when I open any page, then I am sent to the sign-in screen.
- Negative: Given an error in authentication state detection, when I open a page, then I am not redirected properly

AC-004: Given valid credentials, when I sign in, then I land on the lists screen; given wrong credentials, then I see "Email or password is incorrect"; given `429`, then I see "Too many attempts, try again in a minute".
- Negative: Given an unexpected HTTP status code during sign-in, when I attempt to sign in, then I see a generic error message

AC-005: Given I am signed in, when I sign out, then local data is cleared and I return to the sign-in screen.
- Negative: Given a failure during data clearing, when I sign out, then local data remains and I am not redirected properly

AC-006: Given WireMock is running with the stubs in `src/pantry-pal.Frontend/wiremock/`, when the dev server proxies `/api` to it, then every scenario above can be exercised without the real API.
- Negative: Given WireMock stubs are missing or misconfigured, when I run tests, then scenarios fail to execute properly

## BDD Acceptance Test Scenarios

Feature: App shell, installable PWA, and sign-in screen

  Scenario: PWA installation on mobile devices
    Given the production build is available
    And I am using Chrome on Android or Safari on iOS
    When I open the app
    Then it can be added to the home screen
    And it opens full screen
    And the Lighthouse installability check passes

  Scenario: Theme preference handling
    Given the device prefers dark theme
    When I open the app
    Then I see the dark theme applied
    And text contrast meets WCAG AA standards

  Scenario: Theme preference handling - light theme
    Given the device prefers light theme
    When I open the app
    Then I see the light theme applied
    And text contrast meets WCAG AA standards

  Scenario: Redirect to sign-in when not authenticated
    Given I am not signed in
    When I open any page in the app
    Then I am redirected to the sign-in screen

  Scenario: Successful sign-in redirects to lists screen
    Given valid credentials are entered
    When I attempt to sign in
    Then I land on the lists screen

  Scenario: Failed sign-in with incorrect credentials shows error
    Given invalid credentials are entered
    When I attempt to sign in
    Then I see "Email or password is incorrect"

  Scenario: Failed sign-in with rate limiting shows error
    Given too many attempts have been made recently
    When I attempt to sign in
    Then I see "Too many attempts, try again in a minute"

  Scenario: Successful sign-out clears local data and redirects
    Given I am signed in
    When I sign out
    Then local data is cleared
    And I am redirected to the sign-in screen

  Scenario: WireMock stubs enable testing without real API
    Given WireMock is running with the required stubs
    And the dev server proxies /api to WireMock
    When I exercise any sign-in/sign-out scenario
    Then it can be tested without the real API

## Test Awareness Matrix

| Category                          | Applicable?    | Notes / What to Test |
|-----------------------------------|----------------|----------------------|
| **Unit Tests (Backend)**          | Required       | [Test authentication endpoints, session management logic] |
| **Unit Tests (Frontend)**         | Required       | [Test theme preference detection, sign-in/out components, redirect logic] |
| **API Integration Tests**         | Required       | [Test API calls to /api/auth/* and /api/me with WireMock stubs] |
| **E2E / Playwright Tests**        | Required       | [Test full sign-in flow, PWA installation on mobile browsers, theme switching] |
| **Accessibility (WCAG 2.1 AA)**   | Required       | [Test text contrast ratios in both light and dark themes, keyboard navigation through sign-in form] |
| **Translations / i18n**           | Recommended    | [Check that error messages are properly internationalized] |
| **Role-Based / Authorization**    | To Clarify     | [Determine if there are different roles for sign-in, or if all users have same access] |
| **Security (OWASP)**              | Required       | [Test input validation on email/password fields, prevent injection attacks] |

## Assumptions Made
- For AC-2 (theme preferences): If device has no preference or an unsupported theme preference, we'll default to dark theme as it's generally preferred for PWAs
- For AC-4 (sign-in errors): We'll implement standard error handling for 401 and 429 codes, with a fallback generic error message for other status codes
- For AC-5 (local data clearing): During sign-out, we'll clear user session data, cached items, and local storage entries related to the current session
- For AC-1 (installability): The PWA must pass Lighthouse's core installability checks including manifest requirements, service worker registration, and proper web app capabilities