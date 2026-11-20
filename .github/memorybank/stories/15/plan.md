# Story Plan: 15 — Issue: Sync status, screen wake lock, and accessibility

## Branch

`feature/15-offline-status-wake-lock-accessibility`

## Role

--dev

## Set-aside changes

[none]

## Context

`.github/memorybank/stories/15/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Frontend

## Summary

This story implements offline status indicators, screen wake lock functionality, and accessibility improvements for the frontend application to enhance user experience when shopping offline or when using the app on mobile devices.

## Acceptance Criteria

1. Given I am offline, then an offline indicator shows the number of changes waiting to sync; given I am online with nothing pending, then it is hidden.
2. Given the server rejects a change, then a non-blocking message explains it in plain language.
3. Given a list screen is open on a browser that supports Wake Lock, then the screen does not turn off; when I leave the screen, then the lock is released; when I return to the app, then it is requested again.
4. Given a browser without Wake Lock, then nothing breaks.
5. Given any screen, then icon buttons have accessible names, the crossed-off state is announced, focus is visible, touch targets are at least 44x44 px, and an axe check reports no violations.

## Assumptions

- The existing frontend application structure will allow for implementing offline status indicators without major architectural changes.
- The screen wake lock API is available in the target browsers and can be gracefully handled when not supported.
- Accessibility improvements will not break existing functionality.

## Implementation Notes

### Frontend

- Components/pages to create or modify:
  - Offline indicator component that shows pending count
  - Screen wake lock implementation for list screens
  - Accessibility improvements across all screens (ARIA labels, focus management, touch targets)
- API calls: None (this is a frontend-only feature)
- UX: Key interaction states (loading, error, empty, success)

## Test Strategy

- Unit tests: 
  - Offline status component rendering and behavior
  - Wake lock functionality with browser support detection
  - Accessibility checks using axe
- Integration tests: N/A
- E2E tests: N/A

## Requirements (from phase 1)

- Acceptance criteria: 
  - AC-1: Offline Indicator
  - AC-2: Server Rejection Messages
  - AC-3: Screen Wake Lock
  - AC-4: Browser Compatibility
  - AC-5: Accessibility Compliance
- Test Awareness Matrix: 
  - Unit Tests (Frontend)
  - E2E / Playwright Tests
  - Accessibility (WCAG 2.1 AA)
- Tracker update: Not needed

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @requirements - Analyze the requirements and acceptance criteria
2. @code-frontend - Implement offline status indicators, screen wake lock, and accessibility improvements
3. @test-e2e - Write E2E tests for the new functionality (if needed)
4. @pr-create - Create draft PR

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[ ] Code reviewed (app code)
[ ] Draft PR created
[ ] Integration tests written
[ ] E2E tests written
[ ] Code reviewed (test code)
[ ] Test cases registered (or skipped)
[ ] PR ready

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer             | Notes |
| -------------- | ------- | ------ | ------- | -------------------- | ----- |
| requirements   | 1       | 5      | APPROVE | @requirements-review | Comprehensive and well-structured requirements with complete coverage of acceptance criteria, testability, and proper negative case handling |
| implementation | 1       | 5      | APPROVE | @code-review         | Implementation is complete, follows established patterns, and fully addresses all acceptance criteria. Code quality is high with proper error handling and memory management. |
| implementation | 1       | 5      | APPROVE | @test-review (unit)  | All unit tests pass and provide comprehensive coverage of the implemented functionality with appropriate edge case handling. |
| implementation | 1       | —      | —       | @code-review         |       |
| implementation | 1       | —      | —       | @test-review (unit)  |       |
| tests          | 1       | —      | —       | @test-review (int/E2E) |     |
| tests          | 1       | —      | —       | @code-review (test code) |   |