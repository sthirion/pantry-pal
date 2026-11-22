# Story Plan: 16 — End-to-end tests for the core journeys

## Branch

`feature/16-core-journeys-e2e-tests`

## Role

--dev

## Set-aside changes

[none]

## Context

`.github/memorybank/stories/16/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Full-stack

## Summary

This story implements end-to-end tests for the core journeys of the Pantry Pal application. The tests will cover sign-in/out, list management (create, rename, delete), item management (add, cross off, restore, rename, delete, clear crossed off), and suggestion functionality using Playwright against the real API and built frontend. Tests will be run on both Chromium (Pixel 7) and WebKit (iPhone 14) projects with accessibility checks.

## Acceptance Criteria

1. Given the E2E suite, when it runs, then it starts the API with a temporary SQLite database, seeded personas (two members of household A, one of household B), and the built frontend.
2. Given Chromium (Pixel 7) and WebKit (iPhone 14) projects, then every journey passes on both: sign in and out, wrong password, create, rename, and delete a list, add, cross off, restore, rename, and delete an item, clear crossed off, choose a suggestion.
3. Given the household B persona, then household A's lists are never visible.
4. Given each screen, then an axe check reports no violations.
5. Given a pull request, then CI runs the E2E suite in a separate job.

## Assumptions

1. The existing Playwright setup and testing infrastructure is already in place
2. The backend API and frontend are built and can be served for testing
3. Test personas (users) have been defined with appropriate household memberships
4. The core functionality of the application has been implemented to support these journeys
5. The CI pipeline is already configured to run E2E tests

## Implementation Notes

### Backend (if applicable)

- API endpoints: `/api/me`, `/api/sync`, `/api/suggestions`, `/api/lists`
- Database: temporary SQLite database for testing
- Authentication: session-based with signed-in personas
- Data seeding: two members of household A, one of household B

### Frontend (if applicable)

- Components: sign-in screen, lists screen, items screen
- API calls: all endpoints mentioned above
- UX states: loading, error, empty, success
- Accessibility: axe checks on each screen

## Test Strategy

- Unit tests: None required for this story - it's focused on E2E tests
- Integration tests: None required for this story - it's focused on E2E tests  
- E2E tests: Core journeys including sign-in/out, list management, item management, suggestions, and accessibility checks

## Requirements (from phase 1)

- Acceptance criteria: AC-1, AC-2, AC-3, AC-4, AC-5
- Test Awareness Matrix: E2E / Playwright Tests, Accessibility (WCAG 2.1 AA), Role-Based / Authorization, Security (OWASP)
- Tracker update: Not needed

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @requirements - Analyze the story and refine acceptance criteria
2. @test-e2e - Implement end-to-end tests for core journeys
3. @test-review - Review E2E test adequacy
4. @code-review - Review test code quality
5. @pr-create - Create draft PR

## Status

[ ] Branch created
[ ] Requirements clear
[ ] Tracker story updated (or confirmed not needed)
[ ] Implementation complete (app code + unit tests)
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
| requirements   | 1       | —      | —       | @requirements-review |       |
| implementation | 1       | —      | —       | @code-review         |       |
| implementation | 1       | —      | —       | @test-review (unit)  |       |
| tests          | 1       | —      | —       | @test-review (int/E2E) |     |
| tests          | 1       | —      | —       | @code-review (test code) |   |