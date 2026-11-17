# Story Plan: 8 — Sync, suggestions, and purge API

## Branch

`feature/8-sync-suggestions-purge`

## Role

--dev

## Set-aside changes

none

## Context

`.github/memorybank/stories/8/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

## Scope

Backend only

## Summary

This story implements three backend features: a delta sync endpoint to efficiently synchronize changes since a given version, a suggestions endpoint for auto-completion of item names, and a daily tombstone purge functionality that removes old deleted items after 30 days.

## Acceptance Criteria

1. Given `since=0`, when sync is called, then it returns every live and deleted list and item of the household and the highest `version`.
2. Given `since=n`, then it returns only rows with `version > n`, including soft-deleted rows with `deletedAt` set.
3. Given rows of another household, then they are never returned.
4. Given `since` lower than the household's purge horizon, then the response has `full: true` and contains only live rows.
5. Given a non-numeric or negative `since`, then `400 validation_failed`.
6. Given suggestions exist, when `GET /api/suggestions` is called, then it returns up to 2,000 entries, most recently used first.
7. Given rows deleted 31 days ago and 29 days ago, when the daily purge runs (in-process at 03:30 UTC, at startup when overdue, or via `maintenance:daily`), then only the 31-day-old rows are removed and the purge horizon is updated.

## Assumptions

- The version counter and last-write-wins logic from previous stories (#6 and #7) will be reused
- The implementation will follow existing patterns for household isolation in API endpoints
- The purge functionality will run as a scheduled job or via CLI command
- The suggestions endpoint should return items sorted by usage frequency (most recent first)

## Implementation Notes

### Backend

- Endpoints: 
  - `GET /api/sync?since={version}` for delta sync
  - `GET /api/suggestions` for item suggestions
- Services:
  - `SyncService` for handling sync logic and version management
  - `SuggestionService` for managing item suggestions
  - `MaintenanceService` for daily purge functionality
- Database:
  - Maintain existing tables with appropriate indexes for version queries
  - Add `maintenance_state` table to track purge horizons per household
  - Implement tombstone purging logic that removes rows older than 30 days
- Authorization: All endpoints must validate user belongs to the household they're requesting data for

## Test Strategy

- Unit tests: 
  - Test delta sync logic with various `since` values
  - Test suggestions endpoint behavior (limit, sorting, filtering)
  - Test purge functionality with different age scenarios
- Integration tests:
  - End-to-end validation of all acceptance criteria
  - Test household isolation in all endpoints
  - Verify version management and last-write-wins behavior
- E2E tests: N/A

## Requirements (from phase 1)

- Acceptance criteria: [AC ID and title, one per line]
- Test Awareness Matrix: [Required categories]
- Tracker update: [Not needed]

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. @requirements - Refine acceptance criteria and identify open questions
2. @code-backend - Implement sync, suggestions, and purge functionality
3. @test-api - Write integration tests for the backend endpoints
4. @pr-create - Create a draft PR with all changes

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