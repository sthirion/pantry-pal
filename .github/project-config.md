# Project Configuration

> **This file holds all project-specific configuration for the ADLC framework.**
> Agents read this file at startup to learn your tech stack, project structure, naming
> conventions, and tooling. The generic agents, instructions, and skills stay unchanged —
> you customize your project here.
>
> Replace every value below with your project's specifics. Sections marked _(optional)_
> can be removed if they don't apply.

---

## Project Identity

- **Project name**: `pantry-pal`
- **Description**: Shared grocery lists for a household, delivered as a self-hosted PWA.
- **Repository**: `https://github.com/sthirion/pantry-pal`

## Technology Stack

**Backend:** Node.js 22 / TypeScript / Hono, Drizzle ORM, SQLite (`better-sqlite3`), SSE for realtime sync

**Frontend:** React 19+ / TypeScript 5+ / Vite, installable PWA with offline cache

**Testing:** Vitest (unit, integration), Playwright (E2E)

**Auth:** Better Auth, email and password with sessions (MFA and multi-family signup are post-MVP)

**DevOps:** GitHub Actions; systemd service behind the server's existing Nginx (Let's Encrypt TLS) on a self-hosted VPS; no Docker or database server in production; no paid services

## Ticket Tracker

- **Tracker**: GitHub Issues

> Tracker settings (org/project/area, labels, field keys, test plan/suite ids) live in
> `.github/scripts/tracker/tracker.config.json` — it is user-owned and never overwritten by
> `create-adlc`. Fill it in, then validate with `node .github/scripts/tracker/tracker.mjs auth-check`.
>
> For human/LLM context that doesn't belong in that machine config (suite descriptions,
> backlog URLs, team conventions), copy `.github/memorybank/project-info.template.md` to
> `project-info.md` and fill it in.

## Source Control

- **SCM**: GitHub
- **Organization / Owner**: `sthirion`
- **Repository**: `pantry-pal`

> Source control can be a different vendor than your ticket tracker (e.g. GitHub repos with
> Azure DevOps work items) — PR creation, review, and pipeline-status tools come from the
> `--scm` module, independent of `--tracker`.

## Stack Details

> Filled automatically by `create-adlc` from each selected module's `configFragment`.
> Safe to edit by hand after generation.

### Node.js (all Node stacks)

- **Node version**: from `.nvmrc` and the `engines` field of `package.json`; do not run `node -v` to find it.
- **Dependency audit**: `npm audit --omit=dev` (the lockfile is repository-wide, so it runs once, never per stack).
- **Format**: `npx prettier --write <changed files>` (Prettier). Make the `lint` script also run `prettier --check .`, so the review gate catches unformatted files.

### Backend — Node.js / TypeScript

- **Test runner**: `node .github/scripts/test/test.mjs unit|integration --scope created|impacted` (suites in `.github/scripts/test/suites/`; unit tests are `*.test.ts`, integration tests `*.spec.ts`). Requires `vitest` in the project, plus `@vitest/coverage-v8` for coverage. If one package holds several Vitest projects, give each suite its own `config`.
- **Build**: `npm run build`. **Build before tests**: `yes` (the test run does not compile the code).
- **Lint**: `npm run lint`. **Type-check**: none when `build` is `tsc`; otherwise `npm run typecheck`.
- **Dependency audit** and **Format**: see **Node.js (all Node stacks)**.
- **Mutation test command** (StrykerJS, opt-in — see Mutation Testing): `npx stryker run --incremental --mutate "<changed source files, comma-separated>"`. Requires `@stryker-mutator/core` plus the runner plugin for your test framework as dev dependencies.
- **Source path**: `src/pantry-pal`

### Frontend — React

- **Test runner**: `node .github/scripts/test/test.mjs frontend --scope created` (implementers) or `--scope impacted` (`@code-review`) (suite in `.github/scripts/test/suites/frontend.json`). Requires `vitest` in the frontend project, plus `@vitest/coverage-v8` for coverage.
- **Build**: `npm run build`. **Build before tests**: `yes` (the test run does not compile the code).
- **Lint**: `npm run lint`. **Type-check**: none when `build` runs `tsc` (the Vite default `tsc -b && vite build`); otherwise `npm run typecheck`.
- **Dependency audit** and **Format**: see **Node.js (all Node stacks)**.
- **Mutation test command** (StrykerJS, opt-in — see Mutation Testing): `npx stryker run --incremental --mutate "<changed source files, comma-separated>"`. Requires `@stryker-mutator/core` plus the runner plugin for your test framework as dev dependencies.
- **Source path**: `src/pantry-pal.Frontend`

### Testing — Playwright (E2E)

- **Test runner**: `node .github/scripts/test/test.mjs e2e --scope created --repeat 3` (suite in `.github/scripts/test/suites/e2e.json`; set `playwrightProject` there to pick a browser project). E2E coverage is not measured.
- **Build** and **Build before tests**: none (Playwright compiles the specs itself).
- **Lint**: `npm run lint` in the E2E project, when it has one. **Type-check**: none.
- **Dependency audit** and **Format**: see **Node.js (all Node stacks)**.
- **Source path**: `src/pantry-pal.E2ETests`
- **E2E authentication**: `personas` (test users per role, see below) | `none` (the app has no sign-in; skip personas and auth helpers)

### Ticket Tracker — GitHub Issues

- Fill in `.github/scripts/tracker/tracker.config.json` (bug/story labels). Owner/repo are derived
  from the git remote automatically. Validate with `node .github/scripts/tracker/tracker.mjs auth-check`.
- Detailed human/LLM tracker reference (labels, milestones, issue-type mapping): copy
  `.github/memorybank/project-info.template.md` to `project-info.md` and fill it in.
- GitHub Issues has no test-plan concept — test-tracking agents fall back to labels/milestones
  for organizing test work; see the tracker skill for conventions.

### Source Control — GitHub

- Fill in **Owner / Organization** and **Repository** in the Source Control section above.
- PR creation, reviews, and workflow-run status use the GitHub MCP tools.

## Project Structure

Describe the folder layout so agents know where to place and find code.

```text
src/
├── pantry-pal/               # API backend (unit *.test.ts and integration *.spec.ts beside the code)
├── pantry-pal.Frontend/      # React PWA (WireMock stubs in wiremock/)
├── pantry-pal.Shared/        # Types, Zod schemas, and name normalization shared by API and frontend
└── pantry-pal.E2ETests/      # Playwright end-to-end tests
```

The .NET-style folder names are the paths the generated test suites and `applyTo` globs expect.

Deployment uses the shared deploy tool in a separate repository (location in the local feature design); the manifest is `sites/pantry-pal.json` in that repository, not here. The API serves the built frontend from `STATIC_DIR` and reads the database path from `DB_PATH`.

### Backend layout _(optional)_

```text
pantry-pal/src/
├── routes/              # Hono route handlers
├── services/            # Business logic
├── db/                  # Drizzle schema, migrations, queries
├── auth/                # Better Auth setup and household guards
└── realtime/            # SSE event streams
```

### Frontend layout _(optional)_

```text
pantry-pal.Frontend/src/
├── components/          # UI components (atoms, molecules, organisms)
├── pages/               # Page-level components
├── hooks/               # Custom hooks
├── services/            # API clients, offline queue and sync
└── types/               # Type definitions
```

## Naming Conventions

- **Backend files**: kebab-case (`shopping-list.service.ts`)
- **Variables / functions**: camelCase
- **Components / types**: PascalCase
- **Test files**: `{subject}.test.ts` (unit), `{subject}.spec.ts` (integration and E2E)
- **Branch naming**: `feature/{workItemId}-{short-description}` (kebab-case, 3–5 words)
- **Base branch**: `main`

## Authorization Model

Document your project's authorization rules so agents apply them consistently.

- Every list and item query is scoped to the caller's `household_id`; never trust a household id from the client.
- Check household membership before data access, not just authentication.
- Return `403` for access to another household's resources.
- Declare the required membership role per endpoint.

## Local Development

- **Startup command**: `cd src/pantry-pal && npm run dev` (creates the SQLite database in `src/pantry-pal/data/`, gitignored)
- **Frontend dev server**: `cd src/pantry-pal.Frontend && npm run dev`
- **Local auth**: seeded test household with two users
- **Local data**: SQLite file in `src/pantry-pal/data/`, seeded by a seed script; tests use an in-memory SQLite database
- **WireMock stubs root**: `src/pantry-pal.Frontend/wiremock/` (WireMock Docker image, used by frontend stories to mock the API)

## Build & Test Commands

- **Build, lint, type-check, audit and format**: listed per stack under **Stack Details**: **Build**,
  **Build before tests** (`yes` when the test run does not compile the code; implementers run **Build**
  first only then), **Lint** (check only), **Type-check** (empty when **Build** already type-checks),
  **Dependency audit**, **Format** (changed files only). A stack that leaves a line empty has no such command.
- **Tests**: run through the test runner, never with a stack command:
  `node .github/scripts/test/test.mjs <suite> --scope created|related` with the suites `unit`, `integration`,
  `frontend`, `e2e` defined in `.github/scripts/test/suites/*.json` (edit those files to match your test
  projects). See `.github/skills/test-runner/SKILL.md`.
- **Fallback test commands** (only for a stack the runner has no suite for yet; delete the ones you do not use):
  - **Unit tests**: _e.g._ `./mvnw test` / `npm test`
  - **Integration tests**: _e.g._ `./mvnw verify` / `npm run test:integration`

Agents run only the tests they wrote or changed (`--scope created`); `@code-review` runs the impacted tests
(`--scope impacted`). The full suites run in your pipeline (through your own scripts, or `test.mjs <suite> --scope all`).

Test and coverage output folders (e.g. `TestResults/`, `coverage/`, `test-results/`) are build
artifacts: add them to `.gitignore`. `@pr-create` stops and reports any that show up as untracked.

## Mutation Testing

- **Enabled**: no

Opt-in. Set to `yes` once the mutation tool for your stack is installed (see the **Mutation test
command** in the stack sections above). When enabled, `@code-backend` / `@code-frontend` run it on
the changed production code after their unit tests pass, kill surviving mutants, and report the
rest; `@test-review` judges the survivors. Add the tool's output folders (e.g. `StrykerOutput/`,
`.stryker-tmp/`, `reports/mutation/`, `target/pit-reports/`) to `.gitignore`.

## Terminal & Shell

- **Default shell**: PowerShell (Windows)
- Use the syntax matching your shell for all terminal commands.

## Project-Specific Conventions _(optional)_

Add any additional rules unique to your project that agents should always follow.
Consider putting detailed, file-scoped rules in a dedicated `*.instructions.md` file
under `.github/instructions/` with an `applyTo` glob, rather than listing them all here.

- All architectural decisions recorded in `.github/memorybank/`.
- Never commit secrets or environment-specific configuration values.
- No paid services: every dependency must be open source and self-hostable.
- Node.js 22 everywhere (`.nvmrc`, CI, production server); `better-sqlite3` is a native module, so do not mix major versions.
- Every table carries a `household_id` so multi-family support needs no schema rewrite.
