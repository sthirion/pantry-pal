---
name: pipeline-debug
description: 'Diagnoses CI/CD pipeline failures from a build ID. Retrieves build status, failed step logs, and test results to identify root cause. Use when a pipeline fails and the user provides a build ID.'
---

# Skill: Pipeline Debug

Systematic procedure for diagnosing CI/CD pipeline failures from a build ID. Use this when the user reports a pipeline failure and provides a build ID.

---

## Step 0: Try the Script First

If the project uses the `scm.mjs` script (check `.github/scripts/scm/scm.mjs` exists) and auth is configured, run:

```
node .github/scripts/scm/scm.mjs build-logs <buildId> [--tail 200]
```

This is **auto-approved** and returns, in one call: build status, each failed step's name with a
trimmed/noise-stripped log tail, and any structured failed-test results the SCM exposes (ADO
populates `tests`; GitHub Actions has no structured test-results REST API, so `tests` is always
empty there — fall back to the `test-failure` branch of Step 3 for log-based diagnosis on GitHub).

Use this output directly for **Step 4** (Error Pattern Heuristics) and the **Step 6** report. Only
fall back to the MCP-based Steps 1-3/5 below when the script isn't available (no adapter, auth not
set up) or when you need something it doesn't provide — e.g. commit correlation (Step 5), deeper
log pagination, or GitHub test results.

---

## Required Tools

The invoking agent must have these tools registered:

| Tool | Action | Purpose |
| --- | --- | --- |
| `ado/pipelines_build` | `get_status` | Get build status and identify failed stage/step |
| `ado/pipelines_build_log` | `list` | List the logs available for a build |
| `ado/pipelines_build_log` | `get_content` | Retrieve a specific step's log (use its line-range parameters for large logs) |
| `ado/pipelines_build` | `get_changes` | Get commits associated with the build |
| `ado/testplan_show_test_results_from_build_id` | — | Get structured test results (test name, error, stack trace) |

---

## Step 1: Get Build Status

Call `ado/pipelines_build` (action `get_status`) with the project and build ID.

From the response, identify:
- **Build result** (succeeded, failed, canceled, partiallySucceeded)
- **Failed stage/job/step** — note the step name and log ID
- **Build definition name** — context for what pipeline this is

If the build has not completed, inform the user and stop.

---

## Step 2: Categorize the Failure

Based on the failed step name and any initial error info, categorize into one of:

| Category | Indicators |
| --- | --- |
| `test-failure` | Step name contains "test", "playwright" |
| `build-compilation` | Step name contains "build", "compile" |
| `package-restore` | Step name contains "restore", "install", "dependencies", or a package manager name |
| `docker-build` | Step name contains "docker", "container", "buildx" |
| `deploy` | Step name contains "deploy", "release", "publish" |
| `infrastructure` | Step name contains "terraform", "infra", "provision" |
| `timeout` | Build result indicates timeout or step exceeded time limit |
| `auth` | Step name contains "auth", "login", "token", errors mention 401/403 |
| `unknown` | None of the above match |

---

## Step 3: Retrieve Failure Details

### If category is `test-failure`:

1. Call `ado/testplan_show_test_results_from_build_id` with `outcomes: ['Failed']`
2. For each failed test, note: test name, error message, stack trace
3. Search the local codebase for the failing test file
4. Read the relevant test code and the source code it exercises

### If category is NOT `test-failure`:

1. Call `ado/pipelines_build_log` (action `get_content`) with the failed step's log ID
   - If the log is large, use the line-range parameters to fetch only the **last 100 lines** (tail)
   - Look for lines containing: `error`, `Error`, `ERROR`, `FAILED`, `fatal`, `exception`, `❌`
2. If the first fetch doesn't contain the error, widen the range or fetch from the beginning
3. Parse the error using the heuristics below

---

## Step 4: Error Pattern Heuristics

### Compilation and Package Restore Errors

Compiler and package-manager error formats depend on the stack. Use the **CI Build Error Patterns** section of the stack's `test-debug*` skill in `.github/skills/`. In general:

- Extract the file path, line number, error code, and message
- Search the local codebase for the file and line
- For restore failures, check the dependency manifest and lock file for version conflicts

### Docker Build Failures
```
ERROR: failed to solve: ...
COPY failed: ...
Step [0-9]+/[0-9]+ : ...
```
- Check Dockerfile and referenced file paths

### Terraform / Infrastructure
```
Error: ...
│ ... on ... line ...:
Planning failed. ...
```
- Check the referenced `.tf` file and line

### Timeout Patterns
```
The job running on agent ... has exceeded the maximum execution time
Task was canceled
TimeoutException
```
- Likely an environment/resource issue, not a code issue

### Auth / Permission Errors
```
401 Unauthorized
403 Forbidden
AADSTS[0-9]+
The token has expired
```
- Likely a service connection or secret rotation issue

---

## Step 5: Correlate with Commits

Call `ado/pipelines_build` (action `get_changes`) to get the commits included in this build.

For each commit, note:
- Commit message
- Author
- Changed files (if available)

If the error references a specific file, check if any of the build's commits modified that file. If so, highlight it as the likely responsible change.

---

## Step 6: Present Findings

Present a structured diagnosis in this format:

```markdown
## Pipeline Failure Diagnosis

| Field | Value |
|---|---|
| **Build ID** | {buildId} |
| **Pipeline** | {definition name} |
| **Category** | {failure category} |
| **Failed Step** | {step name} |

### Error Summary

{Concise description of what went wrong — 1-3 sentences}

### Error Details

{Key error lines from the log or test results}

### Relevant Code

{File paths and line numbers from the codebase, if applicable}

### Likely Cause

{Root cause analysis — what change or condition caused this}

### Likely Responsible Commit

{Commit hash + message, if identifiable from build changes}

### Suggested Fix

{Actionable suggestion for resolution}
```

---

## Rules

1. **Never guess** — only report what the tools return. If you can't determine the cause, say so and suggest the user check the full log manually.
2. **Fetch minimal data** — use `startLine`/`endLine` on `get_build_log_by_id` to avoid exceeding context. Start with the last 100 lines.
3. **Don't fix code unless asked** — this skill is diagnostic. Present findings and wait for the user to decide on action.
4. **Correlate, don't assume** — a commit touching a failing file is suspicious but not proof. Frame it as "likely" not "definite".
