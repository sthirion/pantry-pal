# Requirements: #3 — Monorepo, tooling, and CI

- **Tracker story**: [#3](https://github.com/sthirion/pantry-pal/issues/3) (parent #2, successor #4)
- **Scope**: backend only (infra tooling). **API contract**: none. No endpoints, no auth, no data contracts, no application code.
- **Authorization and input validation**: not applicable. Nothing in this story accepts user input or guards a resource; the only access rule is the CI token scope (AC-4 item 3).
- **Phase**: requirements, attempt 2 (2026-11-09). Revised for the attempt 1 review: the empty-suite contract (AC-3, A-5), automated levels in the Test Awareness Matrix, and the superseded `typecheck` script (A-6).
- **Sources**: `context.md`, `plan.md`, feature spec `tasks.md` (TASK-001, TASK-002; TASK-003 and TASK-020 for boundaries), `design.md` (Node 22, deploy manifest), `.github/project-config.md`, `.github/scripts/test/test.mjs` and its `vitest` and `playwright` runners, `.github/scripts/adlc-lib/changed-files.mjs`, `.github/scripts/test/suites/*.json`. Vitest source on GitHub at tags `v2.1.9`, `v3.0.0` and `v4.0.0` (`packages/vitest/src/node/core.ts`, `test-run.ts`, `create.ts`, `reporters/json.ts`) for the empty-run behavior (A-5).

## Scope Boundaries

| In scope (#3) | Out of scope (owner) |
| --- | --- |
| npm workspaces, `package-lock.json`, `.nvmrc`, `engines` | API server, Shared types and schemas, database (#4) |
| Strict base `tsconfig`, one `tsconfig.json` per workspace, minimal placeholder sources | Vite, React, PWA, frontend Vitest environment (#10) |
| ESLint (flat config), Prettier, `.prettierignore` | `@playwright/test`, `playwright.config.ts`, E2E CI job (#16) |
| Vitest 3.0.0 or later and `@vitest/coverage-v8`, one Vitest config per suite; the suite files under `.github/scripts/test/suites/` | Changes to ADLC framework code (`test.mjs`, runners, agents, skills, `.vscode/`) |
| `.github/workflows/ci.yml`, root `.gitignore` | Any application behavior |

## Superseded Sources

Where the sources disagree, this file is the authoritative instruction. Implementation follows the right-hand column.

| Source (superseded) | What it says | Authoritative instruction |
| --- | --- | --- |
| `tasks.md` TASK-001, first AC | Root scripts `build`, `lint`, `typecheck`, `test`, `format` | AC-1 item 6: `build`, `lint`, `test`, `format`; no `typecheck` script (A-6) |
| `plan.md`, Implementation Notes, Backend, Root bullet | Scripts `build`, `lint`, `typecheck`, `test`, `format` | Same as above. `@story` corrects `plan.md` when it records the phase 1 summary; this phase does not write it |
| `tasks.md` TASK-001, fifth AC, and story AC 3 | `test.mjs unit --scope all` with zero tests "is a pass" | AC-3: `RESULT NONE` with exit 4, which CI accepts under the AC-4 exit-code table (A-5) |

## Level 1: Requirements

| ID | The system shall ... | Actor | Precondition | Priority | AC |
| --- | --- | --- | --- | --- | --- |
| REQ-INFRA-001 | install and build the four npm workspaces on Node 22 with strict TypeScript | Developer | Fresh clone, Node 22 | Must | AC-1 |
| REQ-INFRA-002 | lint and format-check every project file with ESLint and Prettier, excluding ADLC framework, editor and local-only files | Developer | AC-1 done | Must | AC-2 |
| REQ-INFRA-003 | run the ADLC `unit`, `integration` and `frontend` suites through `test.mjs` against the real workspaces, with zero tests reported as "nothing ran" instead of an error | Developer, CI | AC-1 done | Must | AC-3 |
| REQ-INFRA-004 | gate every pull request and every push to `main` with one CI job: install, lint, build, the three suites, and the production dependency audit | GitHub Actions | Workflow file on the branch | Must | AC-4 |
| REQ-INFRA-005 | keep generated output and the user's local-only folders out of Git | Developer | Root `.gitignore` present | Must | AC-5 |

All five trace to tracker story #3 (story AC 1 to 5, in order).

## Level 2: Acceptance Criteria

### AC-1: Install and build the four workspaces

Given a fresh clone on Node 22 (the Windows dev machine in PowerShell, or the CI `ubuntu-latest` runner), when the developer runs `npm ci` and then `npm run build`, then both commands exit 0 and:

1. The root `package.json` has `"private": true` and `workspaces` lists exactly `src/pantry-pal`, `src/pantry-pal.Frontend`, `src/pantry-pal.Shared` and `src/pantry-pal.E2ETests`; `npm ci` installs from the committed `package-lock.json`.
2. `.nvmrc` contains `22`. The root and all four workspace `package.json` files have `"engines": { "node": ">=22 <23" }`.
3. `tsconfig.base.json` sets `"strict": true`, and each workspace's `tsconfig.json` extends it.
4. `npm run build` compiles all four workspaces with `tsc`. The API, Shared and Frontend workspaces emit JavaScript into their own `dist/` folder. The E2E workspace is type-checked only and emits nothing (A-4).
5. Every package this story adds is a `devDependency`; no `package.json` has a `dependencies` entry (A-9).
6. The root scripts are `build`, `lint`, `test` and `format`; there is no `typecheck` script (A-6). This supersedes the `typecheck` entry in TASK-001 and in `plan.md` (see **Superseded Sources**). No npm script uses a shell-specific command (such as `rm -rf` or `cp`), so each runs in npm's default script shell on Windows (`cmd.exe`) and Linux (`sh`).
7. The placeholder source of the API, Shared and Frontend workspaces lives under that workspace's `src/` folder (for example `src/index.ts`), inside the matching suite's `sourceGlobs`. The AC-3 verification relies on this.

- **Negative**: Given a `.ts` file in any one of the four workspaces with a parameter that has an implicit `any`, when the developer runs `npm run build`, then it exits non-zero and the `tsc` output names that file with error `TS7006`.
- **Edge**: Given a successful build, when the developer runs `npm run build` again without changes, then it exits 0 again.

### AC-2: Lint and format the whole repository

Given the repository after AC-1, when the developer runs `npm run lint`, then it runs ESLint (flat config in `eslint.config.js`) over the repository and `prettier --check .`, and exits 0, on the Windows working copy and in CI.

1. Both tools cover every project file: root configuration files, all files under `src/` of the four workspaces, and `.github/workflows/`.
2. Both tools exclude, and `npm run format` never rewrites: `.github/**` except `.github/workflows/**`, `.vscode/**`, `scratchpad/**`, `.github/memorybank/features/**`, `node_modules/`, `dist/`, `coverage/`, `test-results/`, `playwright-report/` and `package-lock.json` (A-2).
3. `npm run format` runs `prettier --write .` with the same exclusions.

- **Negative (format)**: Given a `.ts` file in a workspace that is not Prettier-formatted, when the developer runs `npm run lint`, then it exits non-zero and Prettier names that file.
- **Negative (lint rule)**: Given an ESLint error-level violation in a workspace file (for example an unused variable under the recommended rules), when the developer runs `npm run lint`, then it exits non-zero and ESLint reports the file, line and rule.
- **Edge (exclusions)**: Given ADLC files that Prettier would reformat if it checked them (for example `.vscode/mcp.json` and `.github/scripts/test/suites/e2e.json`), when the developer runs `npm run lint`, then neither file is reported, and `npx prettier --file-info .github/agents/story.agent.md` prints `"ignored": true`.

### AC-3: The test suites run against the real workspaces

Given `npm ci` and `npm run build` have run with the Vitest setup in items 1 and 2, and a suite has no test files, when the developer or CI runs `node .github/scripts/test/test.mjs <suite> --scope all` for `unit`, `integration` and `frontend`, then Vitest writes `.github/memorybank/test-runs/<suite>/results.json` with `"numTotalTests":0`, and `test.mjs` prints `test <suite> scope=all selected=all` and `RESULT NONE no tests ran ...` and exits 4, the runner's code for "nothing ran" (A-5). It never exits 1 (`no test results were produced`), 2 (unknown suite or config error), 3 (Vitest not installed) or 5 (timeout).

1. **Vitest version (empty-run report)**: `vitest` and `@vitest/coverage-v8` are devDependencies at the same exact version, 3.0.0 or later, as `package-lock.json` records. They resolve from each Vitest suite's `project` folder (the hoisted root `node_modules` is enough). From 3.0.0, Vitest runs its reporters with an empty result when it finds no test file, so the JSON reporter writes the report. Vitest 2.x stops before the reporters finish, writes no report, and `test.mjs` then exits 1 (A-5).
2. **One Vitest config per suite**: `unit`, `integration` and `frontend` each name their own `config` in the suite JSON. The path is relative to the suite's `project` folder and contains no `..`. Each config:
   - sets `passWithNoTests: true`;
   - sets `include` to the suite's `testFileGlobs`, rewritten relative to the `project` folder;
   - lists `**/node_modules/**` and `**/dist/**` in `exclude`;
   - sets none of `reporters`, `outputFile` or `watch`. `test.mjs` passes `--reporter=json` and `--outputFile=<repo>/.github/memorybank/test-runs/<suite>/results.json` itself (A-8).
3. `unit` selects `*.test.ts` files under `src/pantry-pal/` and `src/pantry-pal.Shared/` (A-7); `integration` selects `*.spec.ts` files under `src/pantry-pal/`; `frontend` selects `*.test.ts(x)` and `*.spec.ts(x)` files under `src/pantry-pal.Frontend/`; `e2e` keeps `project` `src/pantry-pal.E2ETests`. Each suite's `sourceGlobs` cover the `src/` folders of the workspaces it tests.
4. Under `--scope all`, `unit` runs no `*.spec.ts` file and `integration` runs no `*.test.ts` file, because of the `include` in item 2.
5. `npm test` runs the Vitest tests of the API, Shared and Frontend workspaces through the same configs. It exits 0 when there are none and non-zero when any test fails (A-10).

- **Verification (automated, code review)**: Given the placeholder sources from AC-1 item 7 are new on the branch and no test file exists, when `@code-review` runs `test.mjs <suite> --scope impacted` for `unit`, `integration` and `frontend`, then Vitest runs `related` on those sources, finds no test file, and writes the report. Each run prints `RESULT PASS no impacted tests found for the changed code` and exits 0. This goes through the same empty-run path in Vitest as `--scope all` and is auto-approved. `--scope all` itself runs in CI (AC-4), and locally only when a human approves it.
- **Negative (no report)**: Given the Vitest run ends without writing `results.json` (for example Vitest 2.x on an empty suite), when `test.mjs <suite> --scope all` or `--scope impacted` runs, then it prints `RESULT FAIL no test results were produced` and exits 1, and the CI step fails (AC-4 item 1).
- **Positive check (temporary)**: Given a temporary passing test `src/pantry-pal.Shared/src/tmp-smoke.test.ts`, when the developer runs `test.mjs unit --scope created --coverage`, then it prints `selected=1 test files`, `RESULT PASS 1 passed`, and a `COVERAGE` line that does not say `no coverage report produced`. The same holds for a temporary `src/pantry-pal/src/tmp-smoke.test.ts` under `unit` and `src/pantry-pal/src/tmp-smoke.spec.ts` under `integration`. The temporary files are deleted before the PR.
- **Negative**: Given that temporary Shared test changed to fail (`expect(1).toBe(2)`), when the developer runs `test.mjs unit --scope created`, then it exits 1 and lists the failing test by name.
- **Edge**: Given Playwright is not installed until #16 (A-4), when anyone runs `test.mjs e2e --scope all`, then it exits 3 with `@playwright/test is not installed`; CI does not run the `e2e` suite in this story.

### AC-4: CI gates every pull request

Given `.github/workflows/ci.yml`, when a pull request is opened or updated (any target branch) or a commit is pushed to `main`, then one job runs on `ubuntu-latest` with Node read from `.nvmrc` (22.x) and executes, in this order: checkout, `npm ci`, `npm run lint`, `npm run build`, `test.mjs unit --scope all`, `test.mjs integration --scope all`, `test.mjs frontend --scope all`, `npm audit --omit=dev --audit-level=high`. The pull request check is green only when every step succeeds.

1. **Test step result**: exit 0 passes. Exit 4 passes only while no tracked file matches the suite's `testFileGlobs`. Any other exit code fails the step, including exit 1 with `no test results were produced` (AC-3), and so does exit 4 for a suite that has test files (A-5).
2. **Audit**: a high or critical advisory in a production dependency fails the step; low and moderate advisories do not.
3. **Security**: the workflow references no `secrets.*`, declares `permissions: contents: read`, triggers on `pull_request` (never `pull_request_target`), and uses only the GitHub-hosted runner and official `actions/*` actions; no paid service (A-12).
4. No step sets `continue-on-error`; a failing step stops the job.

- **Negative**: Given a pull request with a lint error, a type error, a failing test, or a high advisory in a production dependency, when CI runs, then the matching step fails, the later steps do not run, and the pull request shows a failed check.
- **Edge**: Given this story's own pull request (no test files in any suite, no production dependencies), when CI runs, then the job is green, the log shows `RESULT NONE` for each of the three suites, and the audit step reports `found 0 vulnerabilities`.

### AC-5: Generated and local-only files stay out of Git

Given the root `.gitignore`, when the developer has run `npm ci`, `npm run build`, `npm run lint` and `test.mjs`, and files exist in the folders below, then `git status --porcelain` lists none of: `node_modules/`, `dist/` (in any workspace), `coverage/`, `test-results/`, `playwright-report/`, `src/pantry-pal/data/`, `*.tsbuildinfo`, `scratchpad/` and `.github/memorybank/features/` (A-1).

- **Negative (not over-ignored)**: Given the files this story adds or changes, when the developer runs `git status --porcelain` before committing, then each is listed: `package.json`, `package-lock.json`, `.nvmrc`, `.gitignore`, `.prettierignore`, the Prettier config, `eslint.config.js`, `tsconfig.base.json`, every `src/*/package.json` and `src/*/tsconfig.json` and the placeholder sources, `.github/workflows/ci.yml`, the changed `.github/scripts/test/suites/*.json`, and `.github/memorybank/stories/3/plan.md` and `requirements.md`. `.github/memorybank/patterns/registry.md` stays tracked.
- **Edge**: `.github/memorybank/test-runs/` stays ignored by its own `.gitignore`, which this story does not change.

## Tooling Contract

This story has no API contract (no request or response JSON). These shapes are the contract later stories build on. They are illustrative; names in angle brackets are the implementer's choice.

Root `package.json` (excerpt):

```jsonc
{
  "private": true,
  "workspaces": ["src/pantry-pal", "src/pantry-pal.Frontend", "src/pantry-pal.Shared", "src/pantry-pal.E2ETests"],
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "build": "<tsc build of all four workspaces>",
    "lint": "eslint . && prettier --check .",
    "test": "<Vitest in API, Shared and Frontend; passes with no tests>",
    "format": "prettier --write ."
  }
}
```

`unit` suite (`integration` and `frontend` have the same shape, each with its own `config`, AC-3 item 2):

```jsonc
{
  "runner": "vitest",
  "project": "<folder the Vitest config resolves from, e.g. \".\">",
  "config": "<unit-only Vitest config, relative to project, e.g. vitest.unit.config.ts>",
  "testFileGlobs": ["src/pantry-pal/**/*.test.ts", "src/pantry-pal.Shared/**/*.test.ts"],
  "sourceGlobs": ["src/pantry-pal/src/**/*.ts", "src/pantry-pal.Shared/src/**/*.ts"],
  "timeoutSeconds": 600
}
```

The Vitest config that suite names (AC-3 item 2), with `project` `"."`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/pantry-pal/**/*.test.ts', 'src/pantry-pal.Shared/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
    // No reporters, outputFile or watch: test.mjs passes --reporter=json and --outputFile.
  },
});
```

CI test step exit codes (AC-4 item 1):

| `test.mjs` exit | Output | Suite has test files | Step |
| --- | --- | --- | --- |
| 0 | `RESULT PASS` | any | pass |
| 4 | `RESULT NONE` (report with zero tests) | no | pass |
| 4 | `RESULT NONE` | yes | fail |
| 1 | `RESULT FAIL`, including `no test results were produced` (no report) | any | fail |
| 2, 3, 5 | config error, Vitest missing, timeout | any | fail |

## Level 3: BDD Acceptance Test Scenarios

```gherkin
Feature: AC-1 Install and build the four workspaces

  Scenario: Fresh clone installs and builds on Node 22
    Given a fresh clone of the branch
    And Node 22 is the active Node version
    When the developer runs "npm ci"
    And the developer runs "npm run build"
    Then both commands exit 0
    And "src/pantry-pal/dist", "src/pantry-pal.Shared/dist" and "src/pantry-pal.Frontend/dist" contain compiled JavaScript
    And the E2E workspace emits no files

  Scenario: Every package pins Node 22 and extends the strict base config
    Given the root and the four workspace "package.json" files
    Then each declares engines node ">=22 <23"
    And ".nvmrc" contains "22"
    And each workspace "tsconfig.json" extends "tsconfig.base.json", which sets "strict" to true

  Scenario: A strict-mode type error fails the build
    Given a workspace source file with a parameter that has an implicit any
    When the developer runs "npm run build"
    Then the command exits non-zero
    And the tsc output names that file with error "TS7006"

  Scenario: Building twice without changes succeeds
    Given a successful "npm run build"
    When the developer runs "npm run build" again
    Then the command exits 0
```

```gherkin
Feature: AC-2 Lint and format the whole repository

  Scenario: Lint passes on the scaffold
    Given the repository after a successful build
    When the developer runs "npm run lint"
    Then ESLint and "prettier --check ." both run
    And the command exits 0

  Scenario: An unformatted workspace file fails lint
    Given a ".ts" file in a workspace that is not Prettier-formatted
    When the developer runs "npm run lint"
    Then the command exits non-zero
    And Prettier names that file

  Scenario: An ESLint error fails lint
    Given a workspace file with an unused variable
    When the developer runs "npm run lint"
    Then the command exits non-zero
    And ESLint reports the file, line and rule

  Scenario: ADLC, editor and local-only files are excluded
    Given ".vscode/mcp.json" and ".github/scripts/test/suites/e2e.json" are not Prettier-formatted
    When the developer runs "npm run lint"
    Then neither file is reported
    And "npx prettier --file-info .github/agents/story.agent.md" prints "ignored": true

  Scenario: Format leaves excluded files untouched
    Given a clean working copy
    When the developer runs "npm run format"
    Then "git status --porcelain" shows no change under ".github/" outside ".github/workflows/" and none under ".vscode/"
```

```gherkin
Feature: AC-3 The test suites run against the real workspaces

  Scenario Outline: An empty suite reports that nothing ran
    Given "npm ci" and "npm run build" have run
    And the "<suite>" suite has no test files
    When the developer runs "node .github/scripts/test/test.mjs <suite> --scope all"
    Then ".github/memorybank/test-runs/<suite>/results.json" exists and reports "numTotalTests" 0
    And the output contains "test <suite> scope=all selected=all"
    And the output contains "RESULT NONE no tests ran"
    And the exit code is 4

    Examples:
      | suite       |
      | unit        |
      | integration |
      | frontend    |

  Scenario Outline: The impacted run passes on the untested placeholder sources
    Given the placeholder sources under "src/" are new on the branch
    And the "<suite>" suite has no test files
    When "@code-review" runs "node .github/scripts/test/test.mjs <suite> --scope impacted"
    Then the output contains "RESULT PASS no impacted tests found for the changed code"
    And the exit code is 0

    Examples:
      | suite       |
      | unit        |
      | integration |
      | frontend    |

  Scenario: A Vitest run that writes no report fails
    Given the Vitest run ends without writing ".github/memorybank/test-runs/unit/results.json"
    When "node .github/scripts/test/test.mjs unit --scope all" reads the results
    Then the output contains "RESULT FAIL no test results were produced"
    And the exit code is 1

  Scenario: Vitest is pinned to a version that reports empty runs
    Given the committed "package-lock.json"
    Then "node_modules/vitest" and "node_modules/@vitest/coverage-v8" have the same version
    And that version is 3.0.0 or later

  Scenario Outline: Each Vitest suite names its own config
    Given the "<suite>" suite JSON
    Then it names a "config" inside its "project" folder
    And that config sets "passWithNoTests" to true
    And its "include" matches the suite's "testFileGlobs"
    And it sets no "reporters", "outputFile" or "watch"

    Examples:
      | suite       |
      | unit        |
      | integration |
      | frontend    |

  Scenario: npm test passes with no tests
    Given no test file exists in any workspace
    When the developer runs "npm test"
    Then the command exits 0

  Scenario: A Shared unit test is selected by the unit suite with coverage
    Given a temporary passing test "src/pantry-pal.Shared/src/tmp-smoke.test.ts"
    When the developer runs "node .github/scripts/test/test.mjs unit --scope created --coverage"
    Then the output contains "selected=1 test files"
    And the output contains "RESULT PASS 1 passed"
    And the COVERAGE line does not say "no coverage report produced"

  Scenario: A failing unit test fails the run
    Given a temporary test in "src/pantry-pal.Shared/src/" that asserts expect(1).toBe(2)
    When the developer runs "node .github/scripts/test/test.mjs unit --scope created"
    Then the exit code is 1
    And the failure lists that test by name

  Scenario: Unit and integration suites stay separate
    Given the unit and integration suites both test "src/pantry-pal"
    Then the unit config includes only "*.test.ts" files
    And the integration config includes only "*.spec.ts" files

  Scenario: The E2E suite reports Playwright as missing until #16
    Given "@playwright/test" is not installed
    When anyone runs "node .github/scripts/test/test.mjs e2e --scope all"
    Then the exit code is 3
    And the output contains "@playwright/test is not installed"
```

```gherkin
Feature: AC-4 CI gates every pull request

  Scenario: CI runs every step in order on this story's pull request
    Given a pull request with no test files and no production dependencies
    When the CI workflow runs on "ubuntu-latest" with Node from ".nvmrc"
    Then it runs checkout, "npm ci", "npm run lint", "npm run build", the unit, integration and frontend suites with "--scope all", and "npm audit --omit=dev --audit-level=high" in that order
    And each suite step logs "RESULT NONE"
    And the audit step reports "found 0 vulnerabilities"
    And the pull request check is green

  Scenario Outline: A failing step fails the pull request check
    Given a pull request that introduces <problem>
    When the CI workflow runs
    Then the "<step>" step fails
    And the later steps do not run
    And the pull request check is red

    Examples:
      | problem                                        | step          |
      | an unformatted workspace file                  | npm run lint  |
      | a strict-mode type error                       | npm run build |
      | a failing unit test                            | unit tests    |
      | a Vitest version that writes no empty report   | unit tests    |
      | a high advisory in a production dependency     | npm audit     |

  Scenario: An empty run is a failure once a suite has test files
    Given the unit suite has at least one tracked test file
    And "test.mjs unit --scope all" exits 4
    When the unit test step evaluates the exit code
    Then the step fails

  Scenario: The workflow needs no secrets and only reads the repository
    Given ".github/workflows/ci.yml"
    Then it references no "secrets." value
    And it declares "permissions: contents: read"
    And it triggers on "pull_request" and on "push" to "main", never on "pull_request_target"
```

```gherkin
Feature: AC-5 Generated and local-only files stay out of Git

  Scenario Outline: Generated and local-only paths are ignored
    Given the root ".gitignore"
    And a file exists under "<path>"
    When the developer runs "git status --porcelain"
    Then no entry under "<path>" is listed

    Examples:
      | path                           |
      | node_modules/                  |
      | src/pantry-pal/dist/           |
      | src/pantry-pal.Shared/dist/    |
      | src/pantry-pal.Frontend/dist/  |
      | coverage/                      |
      | test-results/                  |
      | playwright-report/             |
      | src/pantry-pal/data/           |
      | scratchpad/                    |
      | .github/memorybank/features/   |

  Scenario: Build info files are ignored
    Given "npm run build" has written a "*.tsbuildinfo" file
    When the developer runs "git status --porcelain"
    Then no ".tsbuildinfo" file is listed

  Scenario: Files the story adds are not ignored
    Given the story's new and changed files before the commit
    When the developer runs "git status --porcelain"
    Then "package-lock.json", ".nvmrc", ".gitignore", ".github/workflows/ci.yml" and ".github/memorybank/stories/3/requirements.md" are listed
```

## Test Awareness Matrix

| Category | Applicable? | Notes / What to Test |
| --- | --- | --- |
| **Unit Tests (Backend)** | Not applicable | No logic in this story; AC-3 requires the `unit` suite to run with zero tests. Temporary checks from AC-3 are deleted before the PR. |
| **Unit Tests (Frontend)** | Not applicable | Placeholder TypeScript only; React, Vite and the frontend test environment arrive in #10. |
| **API Integration Tests** | Not applicable | No endpoints (API contract: none); the `integration` suite only has to run empty (AC-3). |
| **E2E / Playwright Tests** | Not applicable | No UI; Playwright and the E2E CI job arrive in #16 (A-4). |
| **Accessibility (WCAG 2.1 AA)** | Not applicable | No UI. |
| **Translations / i18n** | Not applicable | No user-facing strings. |
| **Role-Based / Authorization** | Not applicable | No protected resources or roles; the CI token scope is covered under Security. |
| **Security (OWASP)** | Recommended | No unit, integration or E2E level applies, because there is no application code to test. The CI audit step and `@code-review`'s reading of `ci.yml` check it (AC-4 items 2 and 3). |
| **Local verification (Windows)** | Recommended | Manual: AC-1, AC-2, AC-3 temporary checks and AC-5 in PowerShell. |

**Required categories: none.** The story ships no application code, so no automated test level (unit, integration or E2E) has anything to test. AC-1 to AC-5 are verified by the commands in each AC, by `@code-review`'s `--scope impacted` runs (AC-3) and by the pull request's own CI run (AC-4). See **CI pipeline verification** below. These are checks of the tooling, not test levels.

**Security (OWASP)**, Recommended (no automated test level).

- **What**: `npm audit --omit=dev --audit-level=high` fails on a high or critical advisory (OWASP A06, vulnerable components). The workflow has no `secrets.*`, declares `permissions: contents: read`, and triggers on `pull_request` instead of `pull_request_target` (CI/CD integrity, A08). `@code-review` checks the workflow file; the CI run shows the audit result.
- **Why**: AC-4 items 2 and 3; project rules "never commit secrets" and "no paid services".
- **Watch out for**: `--omit=dev` audits production dependencies only, and this story adds none, so the step passes trivially now. It starts to matter in #4. Use the official `actions/checkout` and `actions/setup-node` at a pinned major version.

**Local verification (Windows)**, Recommended (manual).

- **What**: `npm ci`, `npm run build`, `npm run lint` (auto-approved), the AC-1 `TS7006` check and the AC-2 negative checks with temporary edits, the AC-3 temporary tests with `--scope created`, and `git status --porcelain` for AC-5. Revert every temporary edit and delete every temporary file.
- **Why**: The developer works on Windows. CI only proves Linux.
- **Watch out for**: Files written on Windows can have CRLF line endings, which Prettier's default `endOfLine: "lf"` reports. Several files under `.github/memorybank/` already do. Format new files to LF. A `.gitattributes` with `eol=lf` would renormalize files already committed with CRLF, which is outside this story. `npx prettier --write` is auto-approved for `.ts`, `.json`, `.md` and similar, but not for `.yml`, so write `ci.yml` Prettier-clean and confirm with `npm run lint`. ESLint flat config does not read `.gitignore`, so list its `ignores` explicitly. Prettier 3 reads `.gitignore` and `.prettierignore`. Excluding `.github/` but keeping `workflows/` takes `.github/*` followed by `!.github/workflows/`. Vitest `--scope created` filters are substring matches, so keep the temporary test names unique.

### CI pipeline verification (note, not a test level)

- **What**: The pull request's CI run shows each step of AC-4 green, `RESULT NONE no tests ran` for the three suites, Node 22.x from `.nvmrc`, and the audit result. Before that, `@code-review`'s `--scope impacted` runs show `RESULT PASS no impacted tests found for the changed code` for the three suites (AC-3 verification).
- **Why**: AC-1 to AC-4. `--scope all` is never auto-approved for agents, so CI is where AC-3's `--scope all` runs are verified.
- **Watch out for**:
  - With zero test files, `test.mjs --scope all` exits 4, not 0. A plain `run:` step fails on it, so the step applies the exit-code table above. Check "suite has test files" with the suite's own globs, for example `git ls-files 'src/pantry-pal/*.test.ts' 'src/pantry-pal.Shared/*.test.ts'` (a git pathspec `*` also matches `/`).
  - `RESULT FAIL no test results were produced` on an empty suite means Vitest wrote no report. Check the Vitest version in `package-lock.json` first (AC-3 item 1).
  - `test.mjs` diffs against `main` even under `--scope all`. On a shallow pull request checkout without `origin/main` it falls back to `HEAD` (`changed-files.mjs`), so `actions/checkout` needs no `fetch-depth` change.
  - Recent Vitest releases install Vite 7 or later, which needs Node 22.12 or later. CI gets the latest 22.x from `.nvmrc`. Check the `engines` of `node_modules/vite` in `package-lock.json`; if the local Node 22 is older, update it rather than narrowing `engines`.

## Assumptions

Each assumption resolves an open item from `plan.md` (P1 to P6) or a gap found during analysis (G).

- **A-1 (P1, `.gitignore`)**: The root `.gitignore` adds `node_modules/`, `dist/`, `coverage/`, `test-results/`, `playwright-report/`, `src/pantry-pal/data/` (TASK-001) and `*.tsbuildinfo` (written by `tsc` builds), plus the user's local-only `scratchpad/` and `.github/memorybank/features`. Otherwise `@pr-create` would commit them. These paths are believed untracked today. If one is already tracked, `.gitignore` does not untrack it. The implementer reports that and does not run `git rm`.
- **A-2 (P2, lint scope)**: `eslint .` and `prettier --check .` run over the whole repository. Everything under `.github/` except `.github/workflows/` is ADLC-managed (agents, skills, scripts, suites, memory bank) and is excluded, not reformatted. `.vscode/` is excluded too: ADLC generated it, and Prettier would reformat `mcp.json`. `package-lock.json` is npm-formatted and excluded. `ci.yml` is project code and stays in scope.
- **A-3 (P3, frontend)**: The frontend workspace is a minimal TypeScript package with a placeholder source that `tsc` compiles to `dist/`. Vite, React and the PWA arrive in #10, which replaces its build script.
- **A-4 (P4, E2E)**: Playwright is not installed in #3. TASK-020 (#16) owns "Playwright setup", `playwright.config.ts` and the E2E CI job. The E2E workspace gets `package.json` (with `engines`), a `tsconfig.json` extending the base with `noEmit`, and a placeholder `.ts` file so `tsc` has an input. Its build is type-check only: Playwright compiles specs itself (`project-config.md`), and the deploy manifest in `design.md` ships no E2E `dist`. `e2e.json` already points at `src/pantry-pal.E2ETests`; `test.mjs e2e` exits 3 until #16.
- **A-5 (P5, zero tests)**: `test.mjs` is ADLC framework code, and this story does not change it. Its behavior, read from its source:
  - Under `--scope all` it deletes `.github/memorybank/test-runs/<suite>/` and runs `vitest run [--config=<config>] --reporter=json --outputFile=<that folder>/results.json` from the suite's `project` folder, with no file filter.
  - A report with zero tests gives `RESULT NONE`, exit 4 ("nothing ran"), never exit 0.
  - A missing or unparseable report gives `RESULT FAIL no test results were produced`, exit 1.
  - Both hold whatever Vitest's own exit code is. A stale report cannot produce exit 4, because the folder is deleted first.

  Whether the report exists on an empty run depends on the Vitest version, not on `passWithNoTests`. In the Vitest source, 3.0.0 and 4.0.0 call `_testRun.end([])` before they throw "No test files found", and that call runs the JSON reporter. 2.1.9 throws before any reporter's end hook. AC-3 item 1 therefore requires 3.0.0 or later. `passWithNoTests: true` only keeps Vitest's own exit code at 0, which `npm test` needs (A-10). "Passes with zero tests" (story AC 3) therefore means exit 4 with `RESULT NONE`, and none of the error codes 1, 2, 3 or 5. CI accepts exit 4 only while the suite has no test files. Once tests exist (from #4 for `unit` and `integration`, #10 for `frontend`), a broken config that silently finds no tests fails CI. Two checks verify this: `@code-review`'s `--scope impacted` runs (AC-3) and the pull request's CI log (AC-4).
- **A-6 (P6, `typecheck`)**: There is no root `typecheck` script. `project-config.md` says "Type-check: none when `build` is `tsc`", and every workspace build runs `tsc` (#10's Vite build is `tsc -b && vite build`). The "type-check" step in `design.md`'s CI is therefore `npm run build`. This decision supersedes the `typecheck` in TASK-001's script list and in `plan.md`'s Implementation Notes (see **Superseded Sources**). `@story` corrects `plan.md`, which this phase does not write.
- **A-7 (G, Shared tests)**: The `unit` suite also covers `src/pantry-pal.Shared/**/*.test.ts`. TASK-003 (#4) adds unit tests there, agents only run the suites `unit`, `integration`, `frontend` and `e2e`, and no current suite selects Shared tests. Without this, `@code-backend` in #4 would get exit 4 for its Shared tests. The mechanism is the implementer's choice, for example `project: "."` with a root unit Vitest config.
- **A-8 (G, suite isolation)**: `unit` and `integration` both test `src/pantry-pal`, and `--scope all` passes no file filter to Vitest. Without `--config`, Vitest also searches parent folders for `vitest.config.*` or `vite.config.*` (`create.ts`), so a suite without its own config could load another suite's. Each Vitest suite, `frontend` included, therefore names its own `config` whose `include` matches its `testFileGlobs`, as `project-config.md` asks ("give each suite its own `config`"). #10 adds the jsdom environment and the React plugin to the frontend config.
- **A-9 (G, dependencies)**: All tooling (TypeScript, ESLint, Prettier, Vitest) is a `devDependency`. The deploy runs `npm ci --omit=dev`, and #3 ships no runtime code.
- **A-10 (G, `npm test`)**: TASK-001 lists a root `test` script without defining it. It is a human convenience that runs Vitest in the API, Shared and Frontend workspaces and passes with no tests. Agents and CI keep using `test.mjs`.
- **A-11 (G, platforms)**: Development happens in PowerShell on Windows (`project-config.md`), and CI runs on Linux, so the npm scripts and the lint result must be the same on both.
- **A-12 (G, CI hardening)**: `permissions: contents: read` and `pull_request` (not `pull_request_target`) follow from TASK-002's "no secrets". CI runs on pull requests to any branch, since TASK-002 says "gates every pull request", and on pushes to `main`.

## Open Questions

None. Every open item in `plan.md` is decided above (A-1 to A-6). The attempt 1 review findings are resolved in AC-3 items 1 and 2 with A-5 (empty-run report), in the Test Awareness Matrix (no Required row without an automated level), and in **Superseded Sources** with A-6 (`typecheck`).

## Discovered Requirements (out of scope, for later stories)

- **#4**: Add `.env` to `.gitignore` once the API reads `DB_PATH` and `STATIC_DIR` from the environment. From the #3 refinement.
- **#16**: Already owns Playwright and the E2E CI job. The E2E build (type-check only, A-4) must then include `playwright.config.ts` and the specs.
- **ADLC upstream (not a story)**: `test.mjs --scope all` returns exit 4 for an empty suite. An option to treat an empty suite as a pass would remove the CI exit-code logic in A-5.

## Tracker Comparison and Verdict

| Story AC (tracker) | Refined | Difference |
| --- | --- | --- |
| 1. `npm ci` and `npm run build`, four workspaces build | AC-1 | Adds the workspace list, `.nvmrc` and `engines`, strict base config, E2E type-check only, devDependencies only, no `typecheck` script (superseding TASK-001), cross-platform scripts, placeholder sources under `src/`, `TS7006` negative case |
| 2. ESLint and `prettier --check .` pass | AC-2 | Adds the exclusion list, `npm run format`, and negative and exclusion checks |
| 3. `unit --scope all` finds the backend and passes with zero tests | AC-3 | Defines "pass" as `RESULT NONE` with exit 4 from a written zero-test report. Adds Vitest 3.0.0 or later, one config per suite with `passWithNoTests`, `integration` and `frontend`, Shared in `unit`, the `--scope impacted` verification, the missing-report negative, coverage provider, `npm test`, `e2e` exit 3 |
| 4. CI: install, lint, build, three suites, audit; fails on errors and high or critical advisories | AC-4 | Adds triggers, step order, Node from `.nvmrc`, `--audit-level=high`, the exit-code table (a missing report fails), and security settings |
| 5. `data/`, `dist/`, `coverage/`, `test-results/` absent from `git status` | AC-5 | Adds `node_modules/`, `playwright-report/`, `*.tsbuildinfo`, `scratchpad/`, `.github/memorybank/features/`, and the not-over-ignored negative case |

**Verdict: Needed.** The refined AC still differ from the tracker AC in every item (re-compared against `context.md` after attempt 2). AC 3 changes meaning: zero tests is exit 4 from a written zero-test report, not exit 0, and it depends on Vitest 3.0.0 or later. The `typecheck` script in the feature spec is dropped.
