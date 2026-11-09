---
name: test-debug-node-ts
description: "Systematic procedure for diagnosing and fixing Node.js/TypeScript test failures. Use when Node/TypeScript tests fail unexpectedly and need debugging."
---

# Test Debug Skill (Node.js / TypeScript)

Systematic procedure for diagnosing and fixing test failures in a Node.js / TypeScript project. Use this when tests fail unexpectedly.

---

## Core Rules — Read First

1. **Run tests, then analyze.** Always run the tests yourself to get fresh output before drawing conclusions.
2. **Categorize all failures before proposing any fix.** Group failures by root cause first — don't jump to the first failure.
3. **Present one failure category at a time.** For each category: show root cause, evidence, proposed change, and ask for approval. Wait before moving to the next.
4. **Never assume the test is wrong or the code is wrong.** Treat both as potentially correct. Determine the truth by consulting the source of truth.
5. **The API contract is the source of truth.** For any API contract question (field names, types, HTTP verbs, routes, response shapes), read your project's contract definition first (OpenAPI or a hand-authored schema — see `.github/project-config.md` for where it lives). Generated clients and docs are downstream of the contract — if they conflict with it, the contract wins.
6. **Never edit a file until the user explicitly approves.** Present a fix proposal and wait for "approved", "yes", or equivalent before making any change.

---

## Step 1: Check for Existing Test Output

**Before running any tests**, check whether the user already ran them.

### 1a. Check terminal history

Look at the terminal context in the session — if there is a recent `npm test` (`vitest` / `jest`) command with a non-zero exit code, the output may already be available. Read it fully before proceeding.

### 1b. Check on-disk reports

If the project is configured with a reporter, results may be on disk:

- Vitest JUnit reporter: `test-results/*.xml` (when `--reporter=junit` is configured)
- Jest: coverage/report output under the configured `coverageDirectory` / reporters
- Otherwise rely on the console output captured in terminal history

### 1c. Check CI build results

If the user provides a **build ID**, retrieve structured test failures from the CI pipeline instead of running tests locally (see `.github/skills/pipeline-debug/SKILL.md`), then correlate the failed test names and stack traces with local source using search tools. Proceed to **Step 2**.

### 1d. Run tests if no usable output exists

If no recent output exists and no build ID was provided, run with the failing test isolated where possible:

```bash
# Whole suite
npm test

# Single file (Vitest)
npx vitest run path/to/file.spec.ts --reporter=verbose

# Single test by name (Vitest)
npx vitest run -t "with invalid data returns 400 with errors"

# Jest equivalents
npx jest path/to/file.spec.ts --verbose
npx jest -t "with invalid data returns 400 with errors"
```

Read the **full** output — assertion diffs, stack traces, and unhandled-rejection warnings. Do not stop at the summary line.

---

## Step 2: Gather Evidence

For each failing test, collect:

- **Test name, file, line number**
- **Error type** (assertion, thrown error, unhandled rejection, timeout, type/compilation)
- **Error message** — exact actual vs expected values (read the diff)
- **Stack trace** — follow the cause chain to the origin
- **Async state** — was a promise awaited? Any "test finished before async op" warning?

For API-related failures, also read:

- Your project's API contract definition (see `.github/project-config.md`) — the source of truth
- The route handler, service, and any error-handling middleware on the path
- `nock` / mock setups feeding the test

---

## Step 3: Classify and Group

Group all failures into categories before proposing any fix. Common categories:

| Category                    | Indicators                                                            |
| --------------------------- | -------------------------------------------------------------------- |
| **API contract mismatch**   | Wrong field name, wrong HTTP status, shape differs from the contract |
| **Async / await bug**       | Unhandled rejection, test resolves before assertion, missing `await` |
| **Auth / session**          | 401, 403, missing/expired token, wrong test identity                 |
| **Validation**              | 400 expected/actual mismatch, schema not applied at boundary         |
| **Mock / stub mismatch**    | Wrong `nock` URL, mock not reset between tests, leaked spy           |
| **Type / compilation**      | `tsc` error, wrong import, type mismatch                             |
| **Env / config**            | Connection refused, missing env var, wrong base URL                 |
| **Flaky / timing**          | Passes on retry, shared mutable state, race condition               |

Present the full categorized list **before** proposing any individual fix:

```
## Failure Summary

| # | Category | Affected Tests | Root Cause (brief) |
|---|----------|---------------|-------------------|
| 1 | API contract mismatch | 3 tests | Response uses `policyNumber`, test asserts `policy_number` |
| 2 | Mock / stub mismatch | 5 tests | nock interceptor not reset in afterEach |

Ready to work through these one at a time. Start with #1?
```

---

## Step 4: Analyze — Determine What Is Wrong

For each category, investigate **both sides** before concluding:

- Read the test — what is it asserting? Is the assertion reasonable given the API contract / requirements?
- Read the application code — what does it actually do?
- Read the API contract — what is the agreed shape?
- Compare: does the test match the contract? Does the code match the contract?

**Decision matrix:**

| Test matches contract? | Code matches contract? | Conclusion                             |
| ---------------------- | ---------------------- | -------------------------------------- |
| ✅                     | ❌                     | Code is wrong — fix the implementation |
| ❌                     | ✅                     | Test is wrong — fix the test           |
| ❌                     | ❌                     | Both wrong — fix to match the contract |
| ✅                     | ✅                     | Something else (mock, env, timing)     |

**Confidence levels:**

| Level      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| **High**   | All evidence sources checked; verdict is unambiguous                            |
| **Medium** | Most evidence checked; one gap exists that does not change the likely conclusion |
| **Low**    | Key evidence missing or contradictory; verdict is a best guess                  |

Do **not** fabricate certainty when evidence is thin — state what is missing and carry Low confidence.

---

## Step 5: Propose Fix — ONE CATEGORY AT A TIME

For each category, present this proposal and **stop**. Do not proceed until it is approved.

```
## Fix Proposal — [Category Name] (X of Y)

**Root cause:**
[What is broken and why, with evidence from the assertion diff and source files]

**Diagnosis confidence:** High / Medium / Low

**Contract reference:**
[If API-related: quote the relevant contract definition confirming the expected behaviour]

**What the test expects:** [Exact assertion]
**What the code/app currently does:** [Exact behaviour observed]

**Conclusion:** Test is wrong / Code is wrong / Both wrong / Something else

**Affected files:**
| File | Line(s) | Current | Proposed change |
|------|---------|---------|----------------|
| src/routes/{resources}.ts | 42 | `res.status(404)` | `res.status(403)` |

**Risk / side effects:**
[Any other tests or behaviours that may be affected]

✅ Reply "approved" to apply this fix, or give feedback to revise.
⏭️ Reply "skip" to leave this category unchanged and move to the next.
```

Do **not** edit any file before receiving an explicit response.

---

## Step 6: Common Fix Patterns (Reference)

| Problem                                   | Fix                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Missing `await` on async call             | Await the promise, or return it from the `it` callback                |
| Unhandled promise rejection warning       | Wrap in try/catch or assert with `await expect(...).rejects`          |
| API field name mismatch                   | Check the contract — the response type or the assertion is out of date |
| Wrong HTTP status (403 vs 404)            | Return 403 for unauthorized resource access; check the middleware      |
| `nock` interceptor leaks between tests    | `nock.cleanAll()` in `afterEach`; assert `scope.isDone()`             |
| Mock not reset                            | `vi.restoreAllMocks()` / `jest.restoreAllMocks()` in `afterEach`      |
| Validation not triggering                 | Ensure the schema (e.g. zod) parses the body at the route boundary     |
| Flaky shared state                        | Isolate fixtures per test; avoid module-level mutable state           |

---

## Step 7: Re-run and Verify

After each approved fix is applied, re-run **only the affected tests**:

```bash
# Single file (Vitest)
npx vitest run path/to/file.spec.ts --reporter=verbose

# Single test by name
npx vitest run -t "test name"
```

Confirm the fix passes, then move to the next category (Step 5). After all categories are resolved, run the full suite (`npm test`) to check for regressions.

## CI Build Error Patterns

Used by `.github/skills/pipeline-debug/SKILL.md` when a pipeline fails outside the test step.

### TypeScript Compilation Errors

```text
src/file.ts(42,17): error TS[0-9]{4}: ...
```

- Extract file path, line/column, error code, and message; search the local codebase for the file and line

### npm / Node.js Errors

```text
npm ERR! ...
ERR_MODULE_NOT_FOUND ...
SyntaxError: ...
```

- Check `package.json` and `package-lock.json` for dependency issues
