# Story Plan: 4 — Shared contracts, API skeleton, and database

## Branch

`feature/4-shared-contracts-api-database`

## Role

--full — set from the command flag

## Set-aside changes

none

## Context

`.github/memorybank/stories/4/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

Feature spec: `.github/memorybank/features/shopping-lists-mvp/` — `design.md` (data model, error format, API contract) and `tasks.md` (TASK-003, TASK-004).

## Scope

Backend — the shared package (`src/pantry-pal.Shared`) and the API workspace (`src/pantry-pal`). No frontend application code; static serving only hosts a built PWA.

## Summary

Delivers the shared types, Zod schemas and `nameKey`/`displayName` helpers, plus a running Hono API on SQLite (Drizzle schema, migrations at startup) with health endpoint, error handling, security headers, CSRF protection and SPA static serving.

## Acceptance Criteria

1. Empty `DB_PATH` on boot: migrations create every table and index in design.md; `GET /api/health` returns `200 {"status":"ok"}`.
2. `nameKey("  Ice   Cream ")` and `nameKey("ICE CREAM")` both return `"ice cream"`.
3. A body violating a shared schema returns `400 validation_failed` with field `details`.
4. An unexpected error returns `500 internal_error` with no stack trace.
5. A cross-origin state-changing request returns `403`.
6. With `STATIC_DIR` set, `/lists/abc` returns `index.html`; unknown `/api/x` returns a `404` JSON error.
7. Every response carries HSTS, CSP `default-src 'self'`, `X-Content-Type-Options`, `Referrer-Policy`.

## Assumptions

- Story passes the Clarity Gate; no category gaps recorded before Phase 1.
- TASK-003 and TASK-004 in `tasks.md` are the detailed implementation contract (pragmas, caching headers, structured logs).
- @story decisions (requirements attempt 2), pending human validation at Human Checkpoint 1:
  - ASSUMPTION-1: story 4 creates the Better Auth `user` table (core columns) so `household_member.user_id → user.id` exists from the first migration; story 5 adds `session`, `account`, `verification`.
  - ASSUMPTION-5: custom Origin check on every unsafe method against config `PUBLIC_ORIGIN` (default `http://localhost:3100`); absent `Origin` rejected only when `Sec-Fetch-Site: cross-site`; no CORS headers. Replaces Hono `csrf()` (form content types only).
  - ~~ASSUMPTION-11~~ removed: the user decided logging is out of scope (no request logs, no exception logs; AC-13 dropped, TASK-004 "structured JSON logs" deferred).
- From `requirements.md`: ASSUMPTION-4 production fails startup unless `HOST` is `127.0.0.1`; ASSUMPTION-12 every design.md code (400/401/403/404/409/429/500) has a fixed `HTTPException` mapping, other statuses → `500`; ASSUMPTION-2/3/6–10/13 (see file).
- Spec drift to fix later: design.md still names Hono `csrf()` and Better Auth CLI for `user`; story 5's description should note `user` already exists.

## Implementation Notes

### Backend

- Shared: `types.ts`, `schemas.ts`, `name-key.ts`, `index.ts` in `src/pantry-pal.Shared/src/`.
- API: `server.ts`, `app.ts`, `config.ts`, `db/schema.ts`, `db/client.ts`, `drizzle/` migrations, `routes/health.ts`, `routes/static.ts`, `middleware/errors.ts` in `src/pantry-pal/`.
- Authorization: none in this story (health is public; auth arrives in story 5).
- Data: error format and table definitions per design.md.

## Test Strategy

- Unit tests: `nameKey`/`displayName` edge cases, every schema boundary, error handler mapping.
- Integration tests: health on a fresh DB (tables and indexes exist), validation `400`, `500` without stack, CSRF `403`, security headers, SPA fallback, unknown `/api/*` `404` JSON, cache headers.

## Requirements (from phase 1)

- Acceptance criteria: AC-1 fresh DB boot (8 tables, FKs, indexes, health) · AC-2 SQLite pragmas · AC-3 server config · AC-4 shared types and error type · AC-5 `nameKey`/`displayName` · AC-6 Zod schemas and boundaries · AC-7 `400 validation_failed` · AC-8 `500 internal_error` and safe exception logging · AC-9 unknown `/api/*` `404` JSON · AC-10 CSRF Origin check · AC-11 security headers · AC-12 static PWA serving and caching · AC-13 structured request logs
- Test Awareness Matrix: Required — Unit (Backend), API Integration, Security (OWASP), Observability
- Tracker update: Needed — pending approval (not approved when the user chose to skip the gate; issue #4 left unchanged)

## Agent Sequence

1. `@requirements` — refine AC; gate `@requirements-review`.
2. `@code-backend` — shared package then API skeleton with unit tests; gate `@code-review` + `@test-review` (unit).
3. `@test-api` — integration tests; gate `@test-review` (int) + `@code-review` (test code).
4. Test-case registration (Human Checkpoint 6).
5. `@pr-create` — PR, ready for review.

## Status

[x] Branch created
[x] Requirements clear
[ ] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
[x] Integration tests written
[x] Code reviewed (test code)
[x] Test cases registered (or skipped) — skipped: GitHub Issues has no test-case concept (`tracker-adapter.mjs` `createTestCases` throws); `tracker-testcases-api.json` (37 entries) not registered
[x] PR ready — https://github.com/sthirion/pantry-pal/pull/20

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer                 | Notes |
| -------------- | ------- | ------ | ------- | ------------------------ | ----- |
| requirements   | 1       | 3      | REFINE  | @requirements-review     | Must Fix: `user` FK omitted; CSRF form-only; raw error messages logged; BDD gaps (AC-4, AC-8, AC-11) |
| requirements   | 2       | 3      | REFINE  | @requirements-review     | Must Fix: production `HOST=0.0.0.0` allowed; `409` mapped to `500` |
| requirements   | 3       | 3      | REFINE  | @requirements-review     | Must Fix: AC-8 intro says no exception log for `HTTPException`, table logs for 500/unmapped. Should Fix: revision says attempt 2. Escalated (retries exhausted) |
| requirements   | —       | —      | SKIPPED | human                    | User chose "Skip this gate" and removed logging from scope; one ungated @requirements pass drops AC-13 and logging rules |
| implementation | 1       | 3      | REFINE  | @code-review             | Must Fix: `sinceQuerySchema` (schemas.ts:36) parses long digit strings to `Infinity` |
| implementation | 1       | 2      | REFINE  | @test-review (unit)      | Must Fix: AC-4 type contracts partial; AC-10 PATCH/DELETE rejection untested; AC-12 sw.js/manifest body + MIME not asserted |
| implementation | 2       | 2      | REFINE  | @code-review             | Must Fix: misplaced `@ts-expect-error` at types.test.ts:45, :89 — shared type-check exits 2. Escalated (rating 2 after a retry) |
| implementation | 2       | 3      | REFINE  | @test-review (unit)      | Must Fix: `ApiError.details`/`ApiErrorDetail` not type-tested; `parsePublicOrigin` fragment/password guards untested |
| implementation | 3       | 5      | APPROVE | @code-review             | User chose one more refinement after escalation; all findings addressed |
| implementation | 3       | 5      | APPROVE | @test-review (unit)      | All findings addressed |
| tests          | 1       | 2      | REFINE  | @test-review (int)       | Must Fix: missing AC-1/2 DB enforcement, AC-3 production startup, AC-7/8 partitions, AC-9 no STATIC_DIR, AC-10 matrix, AC-11 headers, AC-12 bodies; tracker JSON alignment |
| tests          | 1       | 4      | APPROVE | @code-review (test code) | Should Fix: api.spec.ts:83-105 cleanup not failure-safe if boot() fails |
| tests          | 2       | 4      | APPROVE | @test-review (int)       | Should Fix: api.errors.spec.ts:233 asserts only status/type for unset-STATIC_DIR `/api/x`, tracker entry promises exact body |
| tests          | 2       | 4      | APPROVE | @code-review (test code) | Should Fix: api.startup.spec.ts:21-38 leaves startServer's SQLite handle open (Windows temp dir leak) |
