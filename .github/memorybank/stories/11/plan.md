# Story Plan: 11 — Offline store and sync engine

## Branch

`feature/11-offline-store-and-sync-engine`

## Role

--dev

## Set-aside changes

[none]

## Context

`.github/memorybank/stories/11/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Full-stack

## Summary

This story implements a comprehensive offline synchronization system that allows the app to work without connection and automatically catch up when connectivity is restored. The implementation includes local IndexedDB storage with Dexie.js, an ordered outbox pattern for pending changes, and a sync engine that handles queue management, error handling, and network transitions.

## Acceptance Criteria

1. Given any change, when it is made, then it is written to the local store and the outbox in one transaction and the UI updates without waiting for the network.
2. Given several queued changes, when the connection is available, then they are sent one at a time in the order they were made.
3. Given a network error, `5xx`, `408`, or `429`, then the change is retried with backoff (1, 2, 4 seconds, up to 60); given another `4xx`, then it is dropped, the app pulls from the server, and an error is reported.
4. Given a `401`, then sending pauses and the user is asked to sign in; after the same user signs in, the queue resumes; after a different user signs in, local data is cleared.
5. Given a response with `mergedFromId`, then the local record and every queued change use the returned id.
6. Given the app starts, comes back online, regains focus, or receives an SSE `changed` event with a higher version, then it pulls `/api/sync?since=cursor` and applies the rows; given `full: true`, then it replaces local lists and items but keeps the queue.
7. Given the app is closed with queued changes, when it is opened again, then the changes are still queued.

## Assumptions

[Document any gaps filled with assumptions, to be validated]

## Implementation Notes

### Backend (if applicable)

- Endpoints / services / mappers to create or modify
- Authorization: which permissions are required
- Data: request/response shapes

### Frontend (if applicable)

- Components / pages / hooks to create or modify
- API calls: which endpoints are consumed
- UX: key interaction states (loading, error, empty, success)

## Test Strategy

- Unit tests: [what to cover]
- Integration tests: [endpoints and scenarios — if backend scope]
- E2E tests: [user journeys and personas — if frontend scope]

## Requirements (from phase 1)

- Acceptance criteria: [AC ID and title, one per line]
- Test Awareness Matrix: [Required categories]
- Tracker update: [Not needed]

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @code-backend - Implement backend services for sync engine
2. @code-frontend - Implement frontend services and components for offline functionality
3. @test-api - Create integration tests for backend sync endpoints
4. @test-e2e - Create end-to-end tests for offline scenarios
5. @pr-create - Create draft PR

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
[x] Draft PR created

<!-- Only include the lines below that apply to this story's scope: -->
[x] Integration tests written   
[x] E2E tests written            
[x] Code reviewed (test code) 
[x] Test cases registered (or skipped)
[x] PR ready

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer             | Notes |
| -------------- | ------- | ------ | ------- | -------------------- | ----- |
| requirements   | 1       | 5      | APPROVE | @requirements-review |       |
| implementation | 1       | 5      | APPROVE | @code-review         |       |
| implementation | 1       | 5      | APPROVE | @test-review (unit)  |       |
| tests          | 1       | 5      | APPROVE | @test-review (int/E2E) |     |
| tests          | 1       | 5      | APPROVE | @code-review (test code) |   |