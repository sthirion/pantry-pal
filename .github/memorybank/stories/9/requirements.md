## Requirements

REQ-PAL-001: The system shall provide a Server-Sent Events (SSE) endpoint at `GET /api/events` that streams updates to household members
- Precondition: User is authenticated and part of a household
- Actor: Authenticated household member
- Priority: Must
- Tracker Story: 9

REQ-PAL-002: The system shall broadcast list and item changes to all subscribers in the same household
- Precondition: A change occurs in a list or item within the household
- Actor: System (event publisher)
- Priority: Must
- Tracker Story: 9

REQ-PAL-003: The system shall ensure that events are only sent to members of the same household
- Precondition: A change occurs in another household
- Actor: System (event publisher)
- Priority: Must
- Tracker Story: 9

REQ-PAL-004: The system shall maintain keep-alive communication for idle streams
- Precondition: An SSE stream is open but idle
- Actor: System (event publisher)
- Priority: Must
- Tracker Story: 9

REQ-PAL-005: The system shall remove disconnected clients from the event hub
- Precondition: A client disconnects from an SSE stream
- Actor: System (event publisher)
- Priority: Must
- Tracker Story: 9

## Acceptance Criteria

AC-1: Given a signed-in user, when they open `GET /api/events`, then the response is `text/event-stream` with `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- Negative: Given an unauthenticated user, when they open `GET /api/events`, then the response is `401`.

AC-2: Given an open stream, when another member of the household changes a list or item, then the stream receives `event: changed` with the new version.
- Negative: Given a member of another household changes data, then no event is sent to this stream.

AC-3: Given an idle stream, then a keep-alive comment is sent every 25 seconds.
- Negative: Given no activity for more than 25 seconds, then the connection should not be closed abruptly.

AC-4: Given the client disconnects, then the connection is removed from the hub.
- Negative: Given a client reconnects after disconnecting, then they should receive events from the current state.

AC-5: Given no session, then `401`.
- Negative: Given an invalid or expired session, then `401` is returned.

## BDD Acceptance Test Scenarios

Feature: Live Updates API (Server-Sent Events)

  Scenario: User opens events endpoint with valid session
    Given a signed-in user
    When they open GET /api/events
    Then the response is text/event-stream
    And Cache-Control header is set to no-cache
    And X-Accel-Buffering header is set to no

  Scenario: User receives list/item change events
    Given an open stream
    When another member of the household changes a list or item
    Then the stream receives event: changed with the new version

  Scenario: User does not receive events from other households
    Given a user in one household
    When a member of another household makes changes
    Then no event is sent to this user's stream

  Scenario: Keep-alive messages are sent
    Given an idle stream
    When no activity occurs for 25 seconds
    Then a keep-alive comment is sent

  Scenario: Disconnected clients are removed from hub
    Given a client connected to an SSE stream
    When the client disconnects
    Then the connection is removed from the hub

  Scenario: Unauthorized access is rejected
    Given an unauthenticated user
    When they open GET /api/events
    Then response is 401

## Test Awareness Matrix

## Test Awareness Matrix

| Category                          | Applicable?    | Notes / What to Test |
|-----------------------------------|----------------|----------------------|
| **Unit Tests (Backend)**          | Required       | Service logic for SSE endpoint, event hub subscription management, authentication checks |
| **Unit Tests (Frontend)**         | Recommended    | Component that handles SSE connections, connection status indicators |
| **API Integration Tests**         | Required       | GET endpoint returns proper SSE response, validates headers and response format |
| **E2E / Playwright Tests**        | Recommended    | Full end-to-end flow with multiple users making changes and receiving updates |
| **Accessibility (WCAG 2.1 AA)**   | Not Applicable | SSE is a backend feature without UI elements |
| **Translations / i18n**           | Not Applicable | SSE endpoint does not contain user-facing text |
| **Role-Based / Authorization**    | Required       | Testing that only authenticated users can access the endpoint, and that household boundaries are enforced |
| **Security (OWASP)**              | Required       | Input validation on session handling, CSRF protection for SSE endpoint |