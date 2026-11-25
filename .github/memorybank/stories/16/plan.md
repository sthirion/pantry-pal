# Story Plan: 16 — End-to-end tests for the core journeys

## Branch

`feature/16-core-journeys-e2e-tests`

## Role

--dev (test-only story: the E2E tests are the implementation, so phases 4-6 run in this pass)

## Set-aside changes

none (branch renamed from `feature/16-items-page` locally and on origin)

## Context

`.github/memorybank/stories/16/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Full-stack coverage, test-only delivery: Playwright against the real API and built frontend; no `src/` application code changes (work is in `src/pantry-pal.E2ETests/` and `.github/workflows/ci.yml`).

## Summary

End-to-end tests for the core journeys (sign in/out, lists, items, suggestions, keyboard-only pass) on Chromium (Pixel 7) and WebKit (iPhone 14), with household isolation and axe checks on every screen, and a separate CI job. A first version exists in commit 1bc5e8d; remaining gaps are listed in `requirements.md` section 0a.

## Acceptance Criteria

Refined AC-1..AC-5 (J1-J7 journeys, concrete 403/401 statuses, screen inventory, verification level per negative) are in `requirements.md` section 2.

## Assumptions

Full list in `requirements.md` sections 5-6. Key points:

1. Journeys J1-J6 come from the first-run story text and parent feature scope; J7 (keyboard-only) is an added scope item.
2. "Every screen" = `/sign-in`, `/lists`, `/lists/:listId`, `*` plus the in-screen states listed in AC-4.
3. Nothing in `src/` application code changes; `server/start.mjs` is E2E tooling.
4. Item-level cross-household writes are covered by the API suite, not repeated.
5. DECISION-1 (needs confirmation): helper functions with role locators instead of Page Object classes and `data-testid`, because `data-testid` would need app changes.
6. Open: should the `e2e` job be a required check on `main` (repository setting, non-blocking).

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

- Acceptance criteria: AC-1 Environment initialisation; AC-2 Journeys on both browsers; AC-3 Household isolation; AC-4 Accessibility of every screen; AC-5 CI job
- Test Awareness Matrix: Required: E2E / Playwright, Accessibility (WCAG 2.1 AA), Role-Based / Authorization, Security (OWASP); Recommended: i18n (English strings)
- Tracker update: Needed — Applied

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @requirements - done (attempt 2 approved)
2. @test-e2e - close the gaps in `requirements.md` section 0a (start.mjs env overrides and script check, J7, API-level isolation, extra axe states)
3. @test-review (E2E) and @code-review (test code) in parallel
4. @pr-create - commit, push, create PR

No app-code implementation phase: the work is test-only.

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] E2E tests written
[x] Code reviewed (test code)
[x] Test cases registered (or skipped) — skipped: GitHub tracker has no test case concept
[ ] PR ready

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer             | Notes |
| -------------- | ------- | ------ | ------- | -------------------- | ----- |
| requirements   | 1       | 3      | REFINE  | @requirements-review | Must Fix: Background contradiction, AC-2 examples, AC-3 write status, negative verification levels |
| requirements   | 2       | 4      | APPROVE | @requirements-review | Should Fix: record DECISION-1; add E2E_API_DIST/E2E_FRONTEND_DIST; verify trace/if: failure()/no needs by inspection; create the foreign list in-test |
| tests          | 1       | 4      | APPROVE | @test-review (int/E2E) | Should Fix: assert all 3 seeded suggestions; J7 Tab reachability proven on Chromium only (WebKit uses .focus()); reload persistence after rename/delete; empty `expected` in tracker-testcases |
| tests          | 1       | 4      | APPROVE | @code-review (test code) | Should Fix: `clickRowControl` uses dispatchEvent (skips actionability checks) |