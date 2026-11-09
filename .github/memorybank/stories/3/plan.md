# Story Plan: 3 — Monorepo, tooling, and CI

## Branch

`feature/3-monorepo-tooling-ci`

## Role

--full — set from the command flag

## Set-aside changes

None. The stash `adlc: set aside for story 3` (the `gemm4:e2b` model typo in 15 `.github/agents/*` files, plus the untracked root `.gitignore` with `scratchpad/` and `.github/memorybank/features`) was dropped at the user's request on 2026-11-09 (commit `1c7b2ca`). Nothing to restore when the run ends.

## Context

`.github/memorybank/stories/3/context.md` — story text, comments, and related work items (snapshot; do not edit). Refined AC live in `requirements.md`, not there.

Feature spec (local, gitignored on `main`): `.github/memorybank/features/shopping-lists-mvp/tasks.md` — TASK-001 (monorepo scaffolding) and TASK-002 (CI pipeline).

## Scope

Backend only (infra tooling). Not chore: the story creates `src/*/package.json` and `tsconfig` files, which the chore guard forbids. Not full-stack: no application code is written; the frontend workspace gets only a minimal placeholder (React, Vite and the PWA arrive in #10). Node/TypeScript tooling goes to `@code-backend`.

## Summary

Greenfield monorepo: npm workspaces for the API, frontend, shared package and E2E tests, Node 22 pinned, strict TypeScript, ESLint, Prettier and Vitest, the ADLC test suites pointed at the real workspace paths, and a GitHub Actions workflow that gates every pull request.

## Acceptance Criteria

1. Given a fresh clone on Node 22, when I run `npm ci` and `npm run build`, then all four workspaces build without errors.
2. Given the repository, when I run `npm run lint`, then ESLint and `prettier --check .` both pass.
3. Given the suites in `.github/scripts/test/suites/`, when I run `node .github/scripts/test/test.mjs unit --scope all`, then the runner finds the backend workspace and passes with zero tests.
4. Given a pull request, when CI runs, then it executes install, lint, build, unit, integration, frontend tests, and `npm audit --omit=dev`, and fails on any error or a high or critical advisory.
5. Given `src/pantry-pal/data/`, `dist/`, `coverage/`, and `test-results/`, when I run `git status`, then none of them show up.

## Assumptions

Open items for `@requirements` to resolve (no Clarity Gate failure — AC are present and testable, auth and data contracts do not apply):

- The root `.gitignore` this story creates must also include the two lines of the user's former local `.gitignore` (dropped with the stash): `scratchpad/` (personal photos) and `.github/memorybank/features` (local feature spec). Otherwise `@pr-create` would commit them.
- `prettier --check .` and ESLint run over the whole repository; the ADLC framework files under `.github/` (agents, skills, scripts) and the local-only folders must be excluded (`.prettierignore`, ESLint `ignores`) rather than reformatted.
- The frontend workspace is a minimal TypeScript package that builds; Vite, React and the PWA belong to #10.
- The E2E workspace is scaffolded so `e2e.json` points at it; whether Playwright is installed now or in #16 is undecided.
- CI runs the integration and frontend suites with `--scope all`; with zero tests they must pass, as AC 3 requires for unit.
- TASK-001 lists a root `typecheck` script; `project-config.md` says no separate type-check when `build` is `tsc`.

**Resolved in Phase 1** (`requirements.md` A-1 to A-12): all six items above decided; `typecheck` dropped (A-6); Playwright deferred to #16 (A-4); empty suites exit 4 with `RESULT NONE`, which needs Vitest ≥ 3.0.0 and a Vitest config per suite with `passWithNoTests` (A-5, A-8); Shared tests run under `unit` (A-7); CI read-only and no secrets (A-12). Open questions: none.

**Found in Phase 2**: the local dev machine runs Node v26.2.0, so `npm install` / `npm ci` print `EBADENGINE` warnings against `engines` `>=22 <23` (`.nvmrc` `22`). Builds still pass; CI uses Node 22 from `.nvmrc`. Switching locally to Node 22 (e.g. nvm) is the user's call.

## Implementation Notes

### Backend (infra tooling)

- Root: `package.json` (workspaces `src/pantry-pal`, `src/pantry-pal.Frontend`, `src/pantry-pal.Shared`, `src/pantry-pal.E2ETests`; scripts `build`, `lint`, `test`, `format`; ~~`typecheck`~~ superseded by `requirements.md` AC-1 item 6 / A-6 — no separate type-check when `build` is `tsc`), `package-lock.json`, `.nvmrc` (`22`), `tsconfig.base.json` (`strict: true`), `eslint.config.js` (flat config), Prettier config and ignore file, `.gitignore`.
- Every `package.json`: `"engines": { "node": ">=22 <23" }`.
- Each workspace: `package.json`, `tsconfig.json` extending the base, a minimal source entry so `build` succeeds.
- `.github/scripts/test/suites/*.json`: point at the real workspace paths; Vitest and `@vitest/coverage-v8` where needed.
- `.github/workflows/ci.yml`: pull requests and pushes to `main`, `ubuntu-latest`, Node from `.nvmrc`; `npm ci`, `npm run lint`, `npm run build`, `test.mjs` unit, integration and frontend with `--scope all`, `npm audit --omit=dev --audit-level=high`; no secrets, no paid services.
- Authorization: not applicable (no endpoints).

### Phase 2 result (`@code-backend`, attempt 1)

- Versions (exact, devDependencies): `vitest` / `@vitest/coverage-v8` 3.2.4, `typescript` 5.9.3, `eslint` / `@eslint/js` 9.39.1, `typescript-eslint` 8.46.4, `prettier` 3.6.2.
- Vitest suites `unit`, `integration`, `frontend` use `project` `"."` with root configs `vitest.{unit,integration,frontend}.config.ts`; `.prettierrc.json` sets `endOfLine: auto`; workspace `tsconfig`s exclude test files; all packages `"type": "module"`.
- Verified: `npm ci`, `npm run build`, `npm run lint`, AC-1 `TS7006` negative, AC-2 format negative and `--file-info` exclusion, AC-3 temp positive/negative (`unit`, `integration`, `--scope created`), `npm audit` 0 vulnerabilities, AC-5 `git status`.
- Not verified locally: `--scope all` (exit 4 path, CI only), `--scope impacted`, `frontend` suite, `e2e` exit 3, AC-2 ESLint-rule negative, CI workflow run.
- Attempt 2: `eslint.config.js` ignores `.github/*` with `!.github/workflows/`; verified ESLint-rule negative (`@typescript-eslint/no-unused-vars`) and `npm test` (exit 0 empty, exit 1 failing).
- Attempt 3: `eslint-plugin-yml` 3.10.0 (`flat/recommended` + `flat/prettier`, `yml/no-empty-mapping-value` off for workflows); TS rules scoped to `**/*.{js,mjs,cjs,ts,tsx}`; `ci.yml` linted; duplicate-key negative fails lint (parser error). `@code-review` ran `--scope impacted` for `unit`, `integration`, `frontend`: `RESULT PASS no impacted tests found`. `npm ci` reports 13 dev-only advisories; `npm audit --omit=dev` 0.

## Test Strategy

- Unit tests: none expected (no logic); AC 3 requires the unit run to pass with zero tests.
- Integration tests: none — no endpoints (API contract: none).
- E2E tests: none — no UI.
- Verification: build, lint, `test.mjs` runs and `git status` check by the implementer and `@code-review`; AC 4 is verified by the PR's own CI run.

## Requirements (from phase 1)

- Acceptance criteria:
  - AC-1: Install and build the four workspaces
  - AC-2: Lint and format the whole repository
  - AC-3: The test suites run against the real workspaces
  - AC-4: CI gates every pull request
  - AC-5: Generated and local-only files stay out of Git
- Test Awareness Matrix: no Required categories. Security (OWASP) and Local verification (Windows, manual) are Recommended; all others Not applicable. CI pipeline verification is a note (PR's own CI run).
- Tracker update: Needed — Applied 2026-11-09 (issue #3 AC section replaced with refined AC-1 to AC-5; `context.md` re-fetched)

Full text: `requirements.md` in this folder. Keep only this summary here.

## Agent Sequence

1. `@requirements` — refine AC, resolve the open items above, write `requirements.md`; gate `@requirements-review`.
2. `@code-backend` — implement TASK-001 and TASK-002; gate `@code-review` and `@test-review` (unit) in parallel.
3. `@pr-create` — commit, push, create the PR and mark it ready, link #3.

## Status

[x] Branch created
[x] Requirements clear
[x] Tracker story updated (or confirmed not needed)
[x] Implementation complete (app code + unit tests)
[x] Code reviewed (app code)
[ ] PR ready

## Review Gate Status

| Phase          | Attempt | Rating | Verdict | Reviewer             | Notes |
| -------------- | ------- | ------ | ------- | -------------------- | ----- |
| requirements   | 1       | —      | —       | @requirements-review | Blocked: `@requirements` could not start — session loaded agents with `model: gemm4:e2b` (typo, from the set-aside changes) |
| requirements   | 1       | 3      | REFINE  | @requirements-review | Resumed 2026-11-09. Must Fix: exit 4 for empty suite is conditional on Vitest writing `results.json` (else exit 1); Required matrix rows (Security, CI pipeline) name no unit/integration/E2E level. Should Fix: mark TASK-001/plan `typecheck` as superseded |
| requirements   | 2       | 5      | APPROVE | @requirements-review | All attempt-1 findings resolved: Vitest pinned ≥ 3.0.0 with per-suite configs (`passWithNoTests`), Security now Recommended, `typecheck` superseded |
| implementation | 1       | 3      | REFINE  | @code-review         | Must Fix: `eslint.config.js:7` `.github/**` ignore also drops `.github/workflows/**` from ESLint (AC-2/A-2). Lint, audit, impacted unit/integration/frontend all PASS |
| implementation | 1       | 3      | REFINE  | @test-review (unit)  | Must Fix: no ESLint-rule negative check (AC-2); `npm test` not verified with 0 tests / failing test (AC-3 item 5, A-10) |
| implementation | 2       | 3      | REFINE  | @code-review         | Workflow negation fixed, but ESLint has no YAML parser, so `ci.yml` is skipped ("no matching configuration"). Must Fix: add ESLint YAML coverage for `.github/workflows/**/*.yml` (AC-2.1/A-2) |
| implementation | 2       | 5      | APPROVE | @test-review (unit)  | ESLint-rule negative and `npm test` empty/failing checks done |
| implementation | 3       | 4      | APPROVE | @code-review         | YAML linting via `eslint-plugin-yml` 3.10.0 resolves AC-2. No Must/Should Fix. Consider: run `@drift /scan` after merge (new libraries not in pattern registry) |
| implementation | 3       | 5      | APPROVE | @test-review (unit)  | TS rule scoping and YAML positive/negative checks verified |
| tests          | —       | —      | SKIPPED | —                    | Phases 4–5 not applicable: no endpoints or UI (plan Test Strategy, matrix: integration/E2E N/A) |
