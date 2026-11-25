# Requirements Analysis for Story #16 — End-to-end tests for the core journeys

Source: tracker story 16 (`context.md`, AC-1..AC-5 each with a negative case). Attempt 2 (revised after review); supersedes the first run, whose AC predate the tracker change.

## 0. Scope determination

**Scope: Full-stack coverage, test-only delivery** (tracker says `test`; the plan said Full-stack).

- The suite drives the real API and the built frontend together, so coverage is full-stack.
- No `src/pantry-pal/` or `src/pantry-pal.Frontend/` application code should change. All work lives in `src/pantry-pal.E2ETests/` and `.github/workflows/ci.yml` (plus test-runner config if needed). An app change a test would need is a finding to report, not to make here.
- Not **Chore**: a chore skips the test agents, and this story is the E2E tests.
- Not **Backend** or **Frontend**: the suite only consumes `/api/*` and the built UI. The "(if applicable)" Backend/Frontend notes in the stale plan do not apply.
- Pipeline consequence for `@story` (a conclusion, not a question): run `@test-e2e` -> `@test-review` -> `@code-review` (test code). Skip the app-code implementation, unit-test and app-code review steps; they do not apply because no application code changes.

## 0a. Existing state (commit 1bc5e8d `test(16): add end-to-end tests for core journeys`)

The requirements below say what must be covered. Existing assets are the baseline to verify, not to rebuild:

| Asset | Covers | Gap to verify |
| --- | --- | --- |
| `server/start.mjs`, `server/personas.json` | Temp SQLite DB, household A (Sam, Alex) and B (Jo), 3 seeded suggestions in A, built frontend served; fails fast with `E2E server setup failed: ...` and exit code 1 when a build is missing. The dist paths are fixed relative to the script, so no automated check of the failure exists yet | AC-1 negative needs the automated check in AC-1 (add an optional `E2E_API_DIST` / `E2E_FRONTEND_DIST` override in `start.mjs`, which lives in `src/pantry-pal.E2ETests/`, so it is in scope). |
| `playwright.config.ts` | `chromium` = Pixel 7, `webkit` = iPhone 14, `webServer` runs `start.mjs`, `retries: 0`, `list` reporter, trace on failure | None known. |
| `sign-in.spec.ts` | Sign in/out, wrong password, signed-out redirect, Alex/Jo household names | Complete for AC-2. |
| `lists.spec.ts` | Create/rename/delete list, duplicate name, cancel delete, persistence | Complete for AC-2. |
| `items.spec.ts` | Add/cross off/restore, rename, delete, clear crossed off, blank name, persistence, suggestion by tap and keyboard | Complete for AC-2. |
| `isolation.spec.ts` | B cannot see A's lists (UI, after reload), B cannot open A's list URL, A members share lists | The negative case is UI-only; no API-level check (no `page.request` call exists in the suite). |
| `journeys-accessibility.spec.ts` | Real-API axe (wcag2a/2aa/21a/21aa) via `expect(results.violations).toEqual([])`: sign-in, sign-in error, lists, items + suggestions, clear-crossed-off prompt, not-found | No delete-list prompt, rename edit state, empty states, or "list no longer exists" state. |
| `items.spec.ts` | Keyboard use only for suggestions (ArrowDown, Enter) | No keyboard-only pass over the main flow (new J7). |
| `ci.yml` job `e2e` | Verified in the file: triggers `on: pull_request` and `push` to `main`; job `e2e` is independent of `ci` (no `needs`); `npm ci`, `npm run build`, `npx playwright install --with-deps chromium webkit`, `test.mjs e2e --scope all`; `if: failure()` uploads `playwright-traces` | None. |
| `accessibility.spec.ts`, `offline-indicator.spec.ts`, `wake-lock.spec.ts` (story 15) | Mocked-API specs via `fixtures.ts` | Out of scope here; they do not count toward AC-3 or AC-4. Offline and speed belong to story 17. |

## 1. Requirements

REQ-E2E-001: The E2E suite shall start the real API on a temporary SQLite database seeded with household A (2 users) and household B (1 user), and serve the built frontend, with no manual setup beyond `npm run build`.
- Precondition: API and frontend built. Actor: developer or CI. Priority: Must. Tracker Story: 16 (AC-1)

REQ-E2E-002: A setup failure shall stop the run with a message that names the cause.
- Precondition: a build is missing or the server fails to start. Actor: developer or CI. Priority: Must. Tracker Story: 16 (AC-1 negative)

REQ-E2E-003: Every core journey shall pass on both Chromium (Pixel 7) and WebKit (iPhone 14), and a failing journey shall be reported with its project, test title and a trace.
- Precondition: both browsers installed. Actor: test runner. Priority: Must. Tracker Story: 16 (AC-2)

REQ-E2E-004: Household B shall never see household A's lists, and shall be denied reading or writing them by address or through the API.
- Precondition: A has a list; Jo signed in. Actor: Jo (B), Sam/Alex (A), an anonymous caller. Priority: Must. Tracker Story: 16 (AC-3)

REQ-E2E-005: Every screen (the four routes of the frontend router) shall pass an axe check for WCAG 2.1 AA, and any violation shall be listed in the failure output with rule id, impact and target.
- Precondition: the screen state is visible. Actor: test runner. Priority: Must. Tracker Story: 16 (AC-4)

REQ-E2E-006: CI shall run the E2E suite as its own job on every pull request and report pass/fail as a distinct check.
- Precondition: a pull request is opened or updated. Actor: CI. Priority: Must. Tracker Story: 16 (AC-5)

## 2. Refined Acceptance Criteria

Core journeys (used by AC-2): J1 sign in and sign out; J2 wrong password; J3 create, rename and delete a list; J4 add, cross off, restore, rename and delete an item; J5 clear crossed off; J6 choose a suggestion (tap and keyboard); J7 keyboard-only pass (new, see Decisions). The first-run story text and the parent feature's MVP scope are the source; the tracker AC no longer enumerates them.

Screens (from `src/pantry-pal.Frontend/src/App.tsx`): `/sign-in`; `/lists`; `/lists/:listId`; `*` (not found). `/` redirects to `/lists` and is not a screen. Everything except `/sign-in` sits behind `ProtectedRoute`. In-screen states in scope: sign-in error; lists empty ("No lists yet. Create your first list above."); lists with entries; items empty ("No items yet. Add your first item above."); items with active and crossed-off entries; suggestions listbox open; clear-crossed-off prompt; delete-list prompt; rename edit state; "This list no longer exists." (items route, unknown or foreign list id).

**Verification levels used below:** *Playwright* = a test in the E2E suite; *script check* = a Playwright spec that runs `node server/start.mjs` as a child process (no browser); *config inspection* = `@test-review` / `@code-review` read `playwright.config.ts` or `ci.yml` and confirm the setting (no automated test is possible without a real CI run); *manual* = one-off, Recommended at most.

**AC-1: Environment initialisation**
Given the E2E suite starts, when Playwright launches `server/start.mjs`, then the API runs on a fresh temporary SQLite database (a new directory under the OS temp dir) with Sam and Alex in household A and Jo in household B, the built frontend is served at the configured origin, and `/sign-in` responds before the first test runs.
- Verified by: Playwright (Sam and Alex sign in and see household A's name; Jo sees household B's name; A has the 3 seeded suggestions). Config inspection: `webServer.url` is `<origin>/sign-in` (Playwright waits for it before any test) and `reuseExistingServer` is `false` (a fresh database every run).
- Temp-directory removal on shutdown is best-effort cleanup and is not an acceptance criterion.
- Negative: Given the API build or the frontend build is missing, when `server/start.mjs` runs, then it exits with code 1 and prints `E2E server setup failed: the API is not built. Run "npm run build" first.` (or the `frontend` variant) to stderr before it serves anything, not a bare timeout. Verified by script check: a spec spawns `start.mjs` with `E2E_API_DIST` (then `E2E_FRONTEND_DIST`) pointing at a nonexistent directory and asserts exit code 1 and the message. It runs once (the `chromium` project; skipped on `webkit` with the reason "no browser involved") and is not a journey.

**AC-2: Journeys on both browsers**
Given the `chromium` (Pixel 7) and `webkit` (iPhone 14) projects, when the suite runs, then J1-J7 each pass on both projects against the real API, with real persistence (a reload keeps the data), and no journey is skipped or marked fixme on either project.
- J7 (keyboard-only): using only Tab, Shift+Tab, Enter and Space, Sam signs in, creates a list, opens it, adds an item, crosses it off, opens the clear-crossed-off prompt, and activates its buttons; every control is reachable and shows a visible focus.
- Negative: Given a journey fails on one browser, when the run finishes, then the run exits non-zero, the output names the failing project and test title, and a trace is retained for that test. Verified by config inspection: Playwright's `list` reporter prints `[project] › file › title`, `trace: 'retain-on-failure'` is set, and a non-zero exit on any failed test is Playwright's behaviour; no custom code is added. A pass on the other project does not mask a failure (projects are reported separately).
- Journey-level negatives (Playwright): a wrong password shows "Email or password is incorrect" and stays on sign-in; a signed-out visit to a protected route lands on sign-in; a duplicate list name and a blank item name are rejected with a visible message.

**AC-3: Household isolation**
Given Sam (household A) created a list with an item, when Jo (household B) signs in in a separate browser context, then Jo's lists screen never shows Sam's list, before or after a reload, while Alex (household A) does see it. When B has no lists, Jo's lists screen shows the empty state "No lists yet. Create your first list above."
- Negative, UI (Playwright): Given Jo has the address of Sam's list, when Jo opens it, then the app shows "This list no longer exists." and not the list title or items.
- Negative, API (Playwright, `page.request` from Jo's context; same-origin, so the CSRF origin check passes; the list id is taken from Sam's list URL, the body is `{ name, changedAt }`). Expected statuses, confirmed from the API source (`list-service.ts` throws 403 for a list of another household; `requireSession` returns 401):
  - Jo `GET /api/sync?since=0` returns 200 and contains no list or item of household A (an empty result when B has created nothing).
  - Jo `PUT /api/lists/<A's list id>` returns 403, and Jo `DELETE /api/lists/<A's list id>?changedAt=<ISO>` returns 403; afterwards Sam's list and its name are unchanged (Alex still sees it).
  - An anonymous caller (no cookie) `GET /api/sync?since=0` returns 401 and no household data.
- Item-level writes (`/api/lists/:listId/items/...`) are out of scope here: the API suite (`api.items.spec.ts`) already asserts 403 for them.

**AC-4: Accessibility of every screen**
Given each screen reachable in the real app, when axe runs with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, then it reports zero violations. Screens and states: sign-in; sign-in error; lists empty (Jo) and lists with entries (Sam); items empty; items with an active and a crossed-off item; suggestions listbox open; clear-crossed-off prompt; delete-list prompt; rename edit state (list and item); "This list no longer exists."; not-found (`/no-such-page`). The redirect `/` -> `/lists` is covered by the lists screen.
- Negative: Given a screen has a violation, when the check runs, then the test fails and the output lists each violation (rule id, impact, target). Verified by code inspection of the shared helper: it must assert `expect(results.violations).toEqual([])` (the existing helper does), so the failure diff carries the full violation objects. No violation is silently excluded; any `disableRules` or `exclude` needs an inline reason. Not tested by injecting a violation (that would need an app change).

**AC-5: CI job**
Given a pull request is opened or updated, when GitHub Actions runs, then the workflow has a job separate from the lint/unit job that builds, installs the Chromium and WebKit browsers, runs `node .github/scripts/test/test.mjs e2e --scope all`, and reports its own pass/fail check.
- Verified by config inspection of `.github/workflows/ci.yml` (already satisfied: `on: pull_request`, job `e2e` without `needs`, the steps above). A real pull request run is the proof and is not a test.
- Negative: Given an E2E test fails, or a setup step (install, build, browser install) fails, when the job runs, then the job is marked failed, the pull request check is red, and the Playwright traces are uploaded as the `playwright-traces` artifact (`if: failure()`). A failure in the `ci` job does not hide the E2E result (no `needs`, so the jobs are independent). Verified by config inspection; a manual check (push a deliberately failing test to a throwaway branch) is Recommended once, not required.


## 3. BDD Acceptance Test Scenarios

Each Gherkin block has one `Feature:`. Scenario Outlines are fully expanded; every Examples row is one test.

```gherkin
Feature: Test environment (AC-1)

  Background:
    Given the API and frontend are built
    And the E2E server runs on a temporary SQLite database
    And Sam and Alex belong to household A and Jo belongs to household B

  Scenario: The environment is seeded and served
    When Sam, Alex and Jo each sign in
    Then Sam and Alex see household A's name
    And Jo sees household B's name

  Scenario: Household A has the seeded suggestions
    When Sam opens a list and focuses the add field
    Then the 3 seeded suggestions are offered
```

```gherkin
Feature: Setup failure (AC-1 negative, script check, no browser)

  Scenario Outline: Setup fails with a clear message when a build is missing
    Given the <build> output directory does not exist
    When "node server/start.mjs" runs with <override> pointing at it
    Then it exits with code 1
    And stderr contains "E2E server setup failed: the <build> is not built"
    And no server is listening

    Examples:
      | build    | override            |
      | API      | E2E_API_DIST        |
      | frontend | E2E_FRONTEND_DIST   |
```

```gherkin
Feature: Core journeys on both browsers (AC-2)

  Background:
    Given the E2E server is running with the seeded personas

  Scenario Outline: <journey> passes on <project>
    Given the <project> project is running
    When the "<journey>" journey runs against the real API
    Then it passes
    And its data is still there after a reload

    Examples:
      | project  | journey                                         |
      | chromium | J1 sign in and out                              |
      | chromium | J2 wrong password                               |
      | chromium | J3 create, rename and delete a list             |
      | chromium | J4 add, cross off, restore, rename, delete item |
      | chromium | J5 clear crossed off                            |
      | chromium | J6 choose a suggestion (tap and keyboard)       |
      | chromium | J7 keyboard-only pass                           |
      | webkit   | J1 sign in and out                              |
      | webkit   | J2 wrong password                               |
      | webkit   | J3 create, rename and delete a list             |
      | webkit   | J4 add, cross off, restore, rename, delete item |
      | webkit   | J5 clear crossed off                            |
      | webkit   | J6 choose a suggestion (tap and keyboard)       |
      | webkit   | J7 keyboard-only pass                           |

  Scenario: A wrong password is rejected
    Given Sam is on the sign-in screen
    When Sam submits a wrong password
    Then an alert says "Email or password is incorrect"
    And Sam stays on the sign-in screen

  Scenario: A signed-out visit to a protected route lands on sign-in
    Given nobody is signed in
    When someone opens "/lists"
    Then the sign-in screen is shown

  Scenario: A duplicate list name is rejected
    Given Sam has a list "Weekly"
    When Sam creates another list "Weekly"
    Then a visible message says the name is already used

  Scenario: A blank item name is rejected
    Given Sam is on the items screen of a list
    When Sam adds an item with a blank name
    Then a visible message says "Enter an item name."

  Scenario: J7 keyboard-only pass
    Given Sam is on the sign-in screen and uses only the keyboard
    When Sam signs in, creates a list, opens it, adds "milk", crosses it off and opens the clear-crossed-off prompt
    Then every control was reached with Tab and activated with Enter or Space
    And the focused control is visible at each step
```

```gherkin
Feature: Household isolation (AC-3)

  Background:
    Given the E2E server is running with the seeded personas
    And Sam created the list "Smith groceries" with the item "secret sauce"

  Scenario: Household B never sees household A's lists
    When Jo signs in, opens the lists screen, then reloads
    Then "Smith groceries" is not shown before or after the reload
    But Alex sees "Smith groceries"

  Scenario: A household with no lists sees the empty state
    Given household B has no lists
    When Jo opens the lists screen
    Then "No lists yet. Create your first list above." is shown

  Scenario: Household B cannot open household A's list by address
    When Jo opens the address of Sam's list
    Then Jo sees "This list no longer exists."
    And neither the list title nor its items are shown

  Scenario: The sync API does not leak household A data
    When Jo requests GET /api/sync?since=0
    Then the status is 200
    And no list or item of household A is in the response

  Scenario Outline: Cross-household writes are forbidden
    When Jo sends <request> for Sam's list id
    Then the status is 403
    And Alex still sees "Smith groceries" unchanged

    Examples:
      | request                              |
      | PUT /api/lists/<id>                  |
      | DELETE /api/lists/<id>?changedAt=<t> |

  Scenario: An anonymous caller is rejected
    When a caller without a session requests GET /api/sync?since=0
    Then the status is 401
    And the body holds no household data
```

```gherkin
Feature: Accessibility of every screen (AC-4)

  Scenario Outline: <screen> has no accessibility violations
    Given <state>
    When axe runs with the wcag2a, wcag2aa, wcag21a and wcag21aa tags
    Then it reports no violations

    Examples:
      | screen                          | state                                                    |
      | sign-in                         | the sign-in screen is shown                              |
      | sign-in error                   | a wrong password was submitted                           |
      | lists, empty                    | Jo is on the lists screen with no lists                  |
      | lists, with entries             | Sam is on the lists screen with a list                   |
      | items, empty                    | Sam opened a new list                                    |
      | items, with a crossed-off item  | the list has an active and a crossed-off item            |
      | suggestions listbox             | the add field is focused and the listbox is open         |
      | clear-crossed-off prompt        | the prompt is shown                                      |
      | delete-list prompt              | the delete prompt for a list is shown                    |
      | list rename edit state          | a list is being renamed                                  |
      | item rename edit state          | an item is being renamed                                 |
      | list no longer exists           | Jo opened the address of Sam's list                      |
      | not-found                       | the address "/no-such-page" is open                      |
```

```gherkin
Feature: Accessibility failures are visible (AC-4 negative, code inspection)

  Scenario: Violations are listed in the failure
    Given the shared axe helper asserts that results.violations equals an empty list
    When a screen has a violation
    Then the test fails
    And the failure output lists each violation's rule id, impact and target
```

```gherkin
Feature: CI job and failure reporting (AC-2 and AC-5, config inspection)

  Scenario: A failure on one browser is reported
    Given the config sets the list reporter and trace "retain-on-failure"
    When a journey fails on webkit and passes on chromium
    Then the run exits non-zero
    And the report names project webkit and the test title
    And a trace is kept for the failed test

  Scenario: CI runs the E2E suite as a separate job
    Given ci.yml triggers on pull_request
    Then the job "e2e" has no "needs" on the job "ci"
    And it builds, installs chromium and webkit, and runs "test.mjs e2e --scope all"
    And it reports its own pass/fail check

  Scenario: A failing E2E job is visible and diagnosable
    Given the upload step runs "if: failure()"
    Then a failed "e2e" job is red
    And the Playwright traces are uploaded as "playwright-traces"
```

## 4. Test Awareness Matrix

The tracker comment (the authoritative matrix) is kept as is; deviations are explained in the Notes column. "Level" says where each negative is verified.

| Category | Applicable? | What to test / why / watch out for |
| --- | --- | --- |
| Unit Tests (Backend) | Not Applicable | No application code changes. |
| Unit Tests (Frontend) | Not Applicable | No application code changes. |
| API Integration Tests | Not Applicable | Tracker: Not Applicable. The API checks in AC-3 (`page.request`: sync 200, PUT/DELETE 403, anonymous 401) run inside the Playwright suite; the API's own cross-household 403 tests already exist in `api.lists.spec.ts`. |
| **E2E / Playwright** | **Required** | AC-1..AC-3: J1-J7 on Pixel 7 and iPhone 14 (14 tests), isolation UI and API checks, plus the setup-failure script check (AC-1 negative, Node child process, `chromium` project only). Keyboard-only: J7 (sign in, add, cross off, clear-crossed-off prompt) plus J6's suggestion keys. Not tests inside the suite, verified by config inspection: AC-1 `webServer.url` and `reuseExistingServer`, AC-2 failure reporting, AC-5 job and trace upload (a manual throwaway-branch check is Recommended once). Watch out for: unique list names (`uniqueName`) because tests share one database and run `fullyParallel`; per-context `x-forwarded-for` because sign-in is rate limited per address (429); WebKit timing, so web-first assertions and no fixed sleeps; the empty-state test for Jo must not depend on other tests (B has no lists unless a test creates one; no test may create lists in B). |
| **Accessibility (WCAG 2.1 AA)** | **Required** | AC-4: real-API axe on every screen and state in the table above (four routes, empty/non-empty, prompts, rename, "no longer exists"). The "violations are listed" negative is verified by code inspection of the helper (`toEqual([])`), not a test. Watch out for: checking after the state is visible (listbox open, prompt shown); the story-15 mocked specs also run axe but do not count here. |
| Translations / i18n | Recommended | Kept as the tracker says. The app is English-only (`i18n/en.ts`, no locale switching), so there is no locale variation to test: the tests assert the English strings (for example "This list no longer exists.", "Email or password is incorrect", the two empty-state messages) through the same keys the app renders. No test for other locales. |
| **Role-Based / Authorization** | **Required** | AC-3: household boundary through the UI, by address and by API (sync 200 with no A data, PUT/DELETE 403, anonymous 401); A members share data, B sees none. Watch out for: isolation tests must create A's data in the same run, not rely on seed lists. |
| **Security (OWASP)** | **Required** | AC-3 negatives, AC-2 wrong password: broken access control (cross-household read/write), anonymous access returns 401, no credentials in test output. Watch out for: the secret in `start.mjs` and the persona passwords are test-only; API calls from the browser context must be same-origin (the CSRF origin check returns 403 for a foreign origin, which would mask the household 403). |
| Responsive breakpoints | Not Applicable | No layout change is in scope. Pixel 7 and iPhone 14 are both phone viewports; the suite runs the same journeys on each for browser-engine coverage (Chromium, WebKit), not for breakpoints. |
| Performance | Not Applicable | Belongs to story 17. |
| Offline / sync / two-user live updates | Not Applicable | Belongs to story 17. |

## 5. Assumptions

- ASSUMPTION-1: The tracker AC dropped the journey list; J1-J6 come from the first-run story text and the parent feature's MVP scope, and remain the definition of "core journeys". J7 (keyboard-only) is added because the checklist expects a keyboard-only pass; it is a scope addition `@story` can drop.
- ASSUMPTION-2 (resolved): "Every screen" means the four routes in `App.tsx` (`/sign-in`, `/lists`, `/lists/:listId`, `*`) plus the in-screen states listed in section 2. `/` only redirects.
- ASSUMPTION-3: Each test signs in through the UI (no storage state); personas Sam, Alex and Jo are those in `server/personas.json`.
- ASSUMPTION-4: "CI fails to start E2E job" and "browser fails" are satisfied by GitHub Actions failing the job/check and by Playwright's non-zero exit; no custom error-handling code is needed beyond clear messages.
- ASSUMPTION-5: Nothing in `src/` application code changes. If a test cannot pass without an app change, report it instead of making it. `server/start.mjs` is E2E tooling, not application code.
- ASSUMPTION-6: Item-level cross-household writes are covered by the API suite and are not repeated here.

## 6. Decisions needing confirmation

- DECISION-1 (deviation from the tracker note "Page Object Model and personas per the test-e2e-patterns skill"): the existing suite uses helper functions (`journeys.ts`: `signIn`, `createList`, `openSignedInPage`, personas `sam`/`alex`/`jo`) and role/label locators instead of Page Object classes and `data-testid`. Personas are satisfied. Reasons for the deviation: role locators exercise the accessible names that AC-4 depends on, and `data-testid` would need app changes, which this story forbids. `@story` or the user must confirm the deviation; if rejected, the work becomes a POM refactor of `journeys.ts` (no `data-testid`).
- DECISION-2: J7 keyboard-only added to AC-2 (see ASSUMPTION-1).
- DECISION-3: AC-3 includes the cross-household write 403 (PUT and DELETE on `/api/lists/:listId`), resolved from `list-service.ts`.

## 7. Open Questions

1. AC-5: should the `e2e` job be a required status check on `main`? That is a repository setting, not a code change; it does not block this story.
2. DECISION-1 above: confirm the helper-function style instead of POM classes.


