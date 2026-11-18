# Story Plan: 9 — Live Updates API with Server-Sent Events

## Branch

`feature/9-live-updates-sse`

## Role

--full

## Set-aside changes

none

## Context

`.github/memorybank/stories/9/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Backend only

## Summary

This story implements a Server-Sent Events (SSE) API endpoint that streams real-time updates to household members when lists or items are modified. The implementation ensures that events are properly filtered by household boundaries and maintains keep-alive communication for idle streams.

## Acceptance Criteria

1. Given a signed-in user, when they open `GET /api/events`, then the response is `text/event-stream` with `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
2. Given an open stream, when another member of the household changes a list or item, then the stream receives `event: changed` with the new version.
3. Given an idle stream, then a keep-alive comment is sent every 25 seconds.
4. Given the client disconnects, then the connection is removed from the hub.
5. Given an unauthenticated user, when they open `GET /api/events`, then the response is `401`.

## Assumptions

- The authentication system is already implemented and working
- Household boundaries are properly enforced in the application
- The existing database schema supports household membership tracking
- SSE endpoint will be used by frontend applications to receive real-time updates

## Implementation Notes

### Backend

- Endpoints: `GET /api/events` 
- Services: `HouseholdEventHub` for managing event subscriptions and broadcasting
- Authorization: Requires authenticated user with household membership
- Data: Events are streamed as text/event-stream with version numbers

## Test Strategy

- Unit tests: Service logic for SSE endpoint, event hub subscription management, authentication checks
- Integration tests: GET endpoint returns proper SSE response, validates headers and response format
- E2E tests: Full end-to-end flow with multiple users making changes and receiving updates

## Requirements (from phase 1)

- Acceptance criteria: REQ-PAL-001, REQ-PAL-002, REQ-PAL-003, REQ-PAL-004, REQ-PAL-005
- Test Awareness Matrix: Unit Tests (Backend), API Integration Tests, Role-Based / Authorization
- Tracker update: Not needed

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @code-backend - Implement the Server-Sent Events endpoint and event hub
2. @test-api - Write integration tests for the SSE endpoint
3. @test-review - Review unit and integration tests

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
[x] Draft PR created
[ ] Integration tests written
[ ] E2E tests written
[ ] Code reviewed (test code)
[ ] Test cases registered (or skipped)
[ ] PR ready

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer             | Notes |
| -------------- | ------- | ------ | ------- | -------------------- | ----- |
| requirements   | 1       | 5      | APPROVE | @requirements-review |       |
| implementation | 1       | 5      | APPROVE | @code-review         |       |
| implementation | 1       | 5      | APPROVE | @test-review (unit)  |       |
| tests          | 1       | 5      | APPROVE | @test-review (int/E2E) |     |
| tests          | 1       | 5      | APPROVE | @code-review (test code) |   |