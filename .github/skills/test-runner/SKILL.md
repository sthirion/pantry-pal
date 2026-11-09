---
name: test-runner
description: 'How to run tests with the deterministic runner (test.mjs): suites, scopes, flags, exit codes, and how to read the summary. Use whenever an agent needs to run unit, integration, frontend, or E2E tests.'
---

# Skill: Test Runner

Tests are run with one script, the same way every time. Do not improvise a stack test command
(dotnet, npm, npx, mvnw, or any other), and do not read raw logs or coverage files: the
summary is the result.

```text
node .github/scripts/test/test.mjs <suite> --scope created|related|impacted [--repeat <2-5>] [--coverage] [--filter "<expr>"] [--base <branch>] [--json]
```

## Suites

Suites are defined in `.github/scripts/test/suites/*.json`. Typical names: `unit`, `integration`,
`frontend`, `e2e`. An unknown suite exits 2 and lists the ones that exist.

Optional suite fields:

- `bin`: the runner's entry file, relative to the suite's `project` folder. Without it the runner looks for the package's entry in `<project>/node_modules` and then in each parent folder up to the repository root, so a hoisted npm workspace install is found. When it finds nothing the run exits 3 and names the package and the folders searched.
- `config` (Vitest): the config file, relative to the project (`--config=<path>`; letters, digits, `.`, `/`, `_` and `-`, no `..`).
- `vitestProject` (Vitest): the project name inside that config (`--project=<name>`).

When one package holds several Vitest projects, give each suite its own `config` so `--scope related` and `--scope impacted` stay inside it.

## Scopes

| Scope | Runs | Used by |
| --- | --- | --- |
| `created` | Only the tests added or modified by the current work, in that suite | Implementers: `@code-backend`, `@code-frontend`, `@test-api`, `@test-e2e` |
| `related` | `created` plus the tests impacted by the changed source | Humans, and the runners' building block for `impacted` |
| `impacted` | The tests impacted by the changed source, without the ones the change added or modified | Reviewers: `@code-review` |
| `all` | The whole suite | Humans and CI only; never auto-approved |

`--scope all` runs the whole suite; it is never auto-approved, so it prompts a human. Agents do not
use it. To re-run an unchanged spec as a regression check, a human runs
`--scope all --filter "<name>"`; CI runs the full suites through the project's own scripts.

## Implementer loop

Run one `test.mjs` command per call: no `;`, `&&` or pipes. A chained command does not match the auto-approve rule and prompts the user.

1. When your stack's **Build before tests** in `.github/project-config.md` is `yes`, run its **Build** command first and fix errors. Then write or change the tests and run your suite with `--scope created`.
2. On a failure, fix it and re-run. To iterate on one test, add `--filter "<test name>"` (for .NET a test or class name is enough). Narrow, do not widen. If a filter matches nothing the runner says so and shows a hint; fix the filter, do not fall back to a stack test command.
3. Never run `related`, `impacted` or the whole suite while implementing. A failing test you did not write and
   did not touch is not yours to fix; report it.
4. `--coverage` is for the implementing agent's report only; it measures the lines you changed, as exercised by the tests you ran.

`--base <branch>` is only needed when the branch was not cut from `main`.

## Flaky E2E check

`@test-e2e` runs its new or changed specs three times: `e2e --scope created --repeat 3` (`--repeat` takes 2 to 5 and only runners that support it, such as Playwright; retries are turned off so a flaky spec cannot hide). A spec that fails in some repetitions and passes in others is printed as `FLAKY <name> (failed k of n)` and counts as a failure. A spec that fails in any repetition is flaky: fix it and re-run. Never raise retries or timeouts to hide it.

## Reading the result

```text
test unit scope=created selected=2 test classes filter="..."
RESULT PASS 27 passed, 0 failed, 0 skipped (9.4s)
COVERAGE changed lines (sanity signal): TaskService.cs 91.7% (11/12)
LOG .github/memorybank/test-runs/unit/run.log
```

- `RESULT` is the verdict. A failure lists up to 10 test names with the first lines of each message.
- `COVERAGE` is the coverage of the **changed lines** by the selected tests: a sanity signal, never
  a gate. `not measured (<reason>)` is a valid answer; report it as such. Never estimate.
- `LOG` is the full output. Open it only when the summary does not explain a failure.

## Exit codes

| Code | Meaning | Do |
| --- | --- | --- |
| 0 | Pass (for `related` and `impacted`, possibly "no impacted tests") | Continue |
| 1 | Test failures (including a `FLAKY` test), or no results produced (build error) | Fix and re-run |
| 2 | Usage or config error: unknown suite, bad flag, unsafe `--filter`, `--repeat` on a runner without it | Fix the command |
| 3 | The runner or tool is missing (for example a package not installed) | Report it; do not work around it |
| 4 | Nothing ran. For `created`: no added or modified test matches the suite. Or the filter matched nothing, or every test was skipped | You wrote no test in this suite, or it is in the wrong folder. Never report it as a pass |
| 5 | Timeout | Report it |

## Stacks without a suite

If the project's stack has no suite yet (exit 2 "unknown suite"), run the matching command from
**Build & Test Commands** in `.github/project-config.md` instead, with coverage enabled if the
stack supports it, and report that the runner was not used.
