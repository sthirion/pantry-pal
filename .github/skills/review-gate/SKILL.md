---
name: review-gate
description: 'Shared rules for review gates invoked by @story — review process, rating contract (output template, rating scale, retry policy), rating determinants per phase, and read-only constraints. Read this skill before performing any gated review (requirements-review, code-review in gate mode, test-review).'
---

# Skill: Review Gate

Read this skill before performing any gated review. It defines the review process, the rating contract that `@story` routes on, and the phase-specific rating determinants.

## Review Gates

| Phase | Reviewer | Judges | Rubric |
| --- | --- | --- | --- |
| Requirements | `@requirements-review` | Are the AC and the Test Awareness Matrix complete and testable? | `acceptance-criteria-backend/SKILL.md`, `acceptance-criteria-frontend/SKILL.md` |
| Implementation — code | `@code-review` (gate mode) | Is the code good, and is every AC implemented? | `pr-review/SKILL.md` + the stack's `pr-review-*` skill |
| Implementation — unit tests | `@test-review` (unit level) | Were the right unit tests written for the changed behavior? | The test-review agent's unit-level procedure |
| Tests — integration / E2E | `@test-review` (integration/E2E level) | Were the right tests written for every AC and matrix row? | The test-review agent's integration/E2E procedure |
| Tests — test code | `@code-review` (gate mode) | Is the test code good? | `pr-review/SKILL.md` + the stack's `pr-review-*` skill |

Each gate's reviewers run in parallel; `@story` combines them (lowest rating, lowest confidence).

The reviewers have disjoint concerns: test **code quality** (naming, structure, framework usage, flakiness) belongs to `@code-review`; test **adequacy** (the right tests exist, with meaningful assertions) belongs to `@test-review`. Do not review the other reviewer's concern.

> There is no design gate. The design phase (`@plan`) is collaborative between the agent and the user — design quality is validated downstream by `@code-review`.

## Review Process

1. **Read your rubric** — the skill files or procedure listed for your phase above.
2. **Read the rating contract** — see [Rating Contract](#rating-contract) below.
3. **Identify the artifacts** — the files and documents listed in the Handoff Context.
4. **Evaluate** — work through the rubric systematically. For every item, note pass/fail with evidence.
5. **Classify findings** — Must Fix (blocks progress), Should Fix (recommended), Strengths (reinforce).
6. **Determine rating** — use the phase-specific determinants below.
7. **Set confidence** — HIGH if clear-cut, MEDIUM if judgment calls exist, LOW if ambiguous.
8. **Produce the rating contract output** — use the exact template below.

## Read-Only Constraint

Reviewers are strictly **read-only**. They observe, evaluate, and rate — they never modify files.

**Why**: Separation of concerns. Producing agents own the artifacts; reviewers own the quality judgment. A reviewer fixing its own findings undermines the gate.

**Enforcement**: Reviewer frontmatter MUST NOT include `edit/editFiles` or `execute/createAndRunTask`. If something needs editing, that is a REFINE finding for the producing agent.

**One exception — `@code-review` runs tests and static checks.** It has `execute/runInTerminal` solely to run `node .github/scripts/test/test.mjs <suite> --scope impacted` as a regression check, each stack's **Lint**, **Type-check** and **Dependency audit** commands from `.github/project-config.md` (never a fixing variant), and `node .github/scripts/scm/scm.mjs changed-files` to list the change set. It runs nothing else: no edits, installs, builds, raw `git`, other stack test commands, or mutation tools. `@test-review` and `@requirements-review` have no terminal.

**Change set**: the only source of the files a reviewer judges is `scm.mjs changed-files` (committed, uncommitted and untracked work; nothing is committed until `@pr-create`). Under `@story` the output file is listed under **Artifacts** in the Handoff Context. Do not rebuild the change set with raw `git` or search.

**Evidence that can exist**: judge only evidence that can exist at this phase. A pull request, a CI run or a pipeline result comes after `@pr-create`; never ask for one in a gate.

**Coverage numbers**: reviewers cannot run tools, so never estimate coverage. Use the number the producing agent measured and reported, or state "not measured". Coverage is a sanity signal, never a gate.

## Rating Determinants by Phase

### Requirements (`@requirements-review`)

| Rating | Criteria |
| --- | --- |
| 5 | All AC testable, every AC has ≥ 1 negative case, test matrix complete (no "To Clarify"), BDD Gherkin valid, assumptions documented, covers auth/validation/edge cases |
| 4 | Minor gaps: one AC missing a negative case, or one matrix item marked "Recommended" instead of "Required" |
| 3 | Multiple gaps: vague language in AC, missing error cases, incomplete test matrix |
| 2 | Fundamental gaps: entire AC categories missing (no auth AC, no validation AC), no BDD scenarios |
| 1 | Output unusable: wrong story analyzed, no structured output, contradictory criteria |

**Key signals for downgrade**:

- Vague language → always ≤ 3
- Missing test awareness matrix → always ≤ 3
- No negative/error cases at all → always ≤ 2

### Code (`@code-review` in gate mode)

| Rating | Criteria |
| --- | --- |
| 5 | Zero findings across all checklists, every AC implemented |
| 4 | Only Should Fix or Consider items; no Must Fix findings |
| 3 | ≥ 1 Must Fix item (e.g., missing cancellation propagation, untyped code, missing auth check, an AC not implemented) |
| 2 | Multiple Must Fix items, especially security findings (OWASP), broken API contracts, or a hand edit to generated code |
| 1 | Fundamental issues: wrong architecture pattern, core feature missing |

**Key signals for downgrade**:

- Any Must Fix → always ≤ 3
- An AC with no implementation → always ≤ 3
- A failing test connected to the change (regression) → always ≤ 2
- A failing test unrelated to the change (possibly pre-existing) → confidence LOW
- A suite that could not run → report "not run" with the reason; never count it as passing
- Security vulnerability (OWASP) → always ≤ 2
- A hand edit to generated code (a generated directory or a generated client) → always ≤ 2 (REFINE): the implementer moves the change into the source of truth (spec, schema or template) and regenerates. A generated change counts as a hand edit when the same change set has no matching change in the source that generates it.

### Tests (`@test-review`, both levels)

| Rating | Criteria |
| --- | --- |
| 5 | Every meaningful behavior (unit) or every AC and Required matrix row (integration/E2E) has tests for each applicable partition — positive, negative, boundary, authorization — with assertions that would fail if the behavior broke |
| 4 | Only Should Fix items: a weak assertion on an otherwise covered behavior, padding |
| 3 | 1–2 Must Fix gaps: an untested behavior or AC, a missing negative/boundary test, a test that would not detect the behavior breaking |
| 2 | Many gaps, or no negative/boundary tests at all, or no authorization tests on protected resources |
| 1 | Tests don't correspond to the change or the story, or contain no meaningful assertions |

**Key signals for downgrade**:

- Any untested meaningful behavior, AC, or Required matrix row → always ≤ 3
- A surviving mutant in changed code that is not equivalent (when mutation testing is enabled) → always ≤ 3
- No negative or boundary tests for inputs with stated limits → always ≤ 3
- Protected resource without authorization tests → always ≤ 3
- A changed E2E page without an accessibility check → always ≤ 3
- High coverage alone never justifies a rating above 3 when Must Fix gaps exist

## Cross-Referencing Story AC

Take the AC and the Test Awareness Matrix from `.github/memorybank/stories/<storyId>/requirements.md`. For older plans without it, fall back to the plan's (`.github/memorybank/stories/<storyId>/plan.md`) **Requirements** / **Acceptance Criteria** sections, then to `context.md`. For the original story text and comments, read `.github/memorybank/stories/<storyId>/context.md` (written by `node .github/scripts/tracker/tracker.mjs fetch <storyId> --out ...`) if you need them. If there is none of these, set confidence LOW and say so in the summary.

## When to Set Confidence LOW

Set confidence to LOW (which triggers human escalation regardless of rating) when:

- The producing agent's output is ambiguous and could be interpreted multiple ways
- You lack sufficient codebase context to validate a claim
- The story AC themselves are vague, making it impossible to evaluate completeness
- The change touches security-critical paths and you're unsure about the threat model

A command the project does not configure (for example no lint script for a stack) is not missing evidence; it does not lower confidence.

## Rating Contract

Every gated review MUST produce output conforming to this contract. This lets `@story` interpret results and route work.

### Output Template

Every gated review MUST end with this structured block:

```markdown
## Review Gate: {phase}

### Verdict: {APPROVE | REFINE | REJECT}
### Rating: {1-5}
### Confidence: {HIGH | MEDIUM | LOW}

### Summary
[1-2 sentences: overall assessment of the reviewed output]

### Findings

#### Must Fix (blocks forward progress)
- [{location or AC reference}] — {specific finding with evidence}

#### Should Fix (recommended before proceeding)
- [{location or AC reference}] — {finding with suggestion}

#### Strengths (done well — reinforce)
- {observation of good practice}

### Routing Recommendation
- **Next agent**: {agent name} (if APPROVE)
- **Return to**: {agent name} with instructions "{specific fix instructions}" (if REFINE)
- **Escalate to human**: {reason} (if REJECT or LOW confidence)
```

### Rating Scale

| Rating | Verdict | Orchestrator Action |
| --- | --- | --- |
| 5 | APPROVE | Auto-advance to next phase |
| 4 | APPROVE | Auto-advance; log Should Fix items for later |
| 3 | REFINE | Loop back to producing agent with Must Fix instructions (max 2 retries) |
| 2 | REFINE | Loop back with instructions; if already retried once, escalate to human |
| 1 | REJECT | Always escalate to human — fundamental issues require human judgment |

### Confidence Levels

- **HIGH** — Evaluation is clear-cut; checklist items have definitive pass/fail answers.
- **MEDIUM** — Some findings are judgment calls; the producing agent may reasonably disagree.
- **LOW** — Significant ambiguity in the input or evaluation criteria; human should validate the rating.

When confidence is LOW, always recommend escalation to human regardless of rating.

### Retry Policy

- Maximum **2 refinement loops** per phase per pipeline run. The counter is per phase, across both reviewers of a gate.
- After 2 loops without reaching rating ≥ 4, escalate to the human with full context.
- Attempt 1 = initial review, Attempt 2 = first retry, Attempt 3 = second retry (final).
- If Attempt 3 still scores < 4, the orchestrator MUST stop and present findings to the human.

### Handoff Context Template

Every invocation from `@story` to a producing agent or reviewer includes this metadata block:

```markdown
## Handoff Context
- **Story ID**: {work item ID or "N/A"}
- **Story plan**: `.github/memorybank/stories/{storyId}/plan.md` (AC and Test Awareness Matrix are in `requirements.md` beside it)
- **Phase**: {requirements | implementation | review | tests | pr}
- **Attempt**: {1 | 2 | 3}
- **Previous review feedback**: {verbatim Must Fix findings from prior review, or "N/A" on first attempt}
- **Artifacts**: {list of files or documents produced so far, including `.github/memorybank/stories/{storyId}/changed-files.md` for code and test reviews}
```

On REFINE loops, **Previous review feedback** MUST contain the reviewer's Must Fix findings verbatim — not a summary — so the producing agent knows exactly what to fix.

### Rules for Reviewers

- You are **read-only** (see above).
- Evaluate against your rubric — do not invent new criteria.
- Every Must Fix finding MUST cite a specific location, AC reference, matrix row, or checklist item.
- Do not flag issues in code or artifacts outside the reviewed change.
- When in doubt, rate conservatively (lower) and set confidence to MEDIUM or LOW.
