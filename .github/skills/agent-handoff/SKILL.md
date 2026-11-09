---
name: agent-handoff
description: 'Protocol for agents receiving work from the @story orchestrator: intake checks, context recovery, progress tracking, and MCP fallback. Read when picking up a handoff or starting a multi-step task.'
---

# Skill: Agent Handoff Protocol

Shared mechanics for every agent that participates in the `@story` pipeline. Each agent owns
its own domain rules; this skill owns how work is picked up and tracked.

## Handoff Intake Check

Run this as your **first action** when you receive a handoff. Do not start work until the
required fields are resolved.

### Self-healing resolution order

Try each source in turn. Only escalate to the next when the previous is insufficient.

1. **Conversation context**: the handoff prompt may already contain every required field. If
   so, proceed immediately.
2. **The story plan on disk**: read `.github/memorybank/stories/<storyId>/plan.md`, and
   `requirements.md` next to it for the refined AC, BDD scenarios and Test Awareness Matrix, to
   fill gaps. When a file is too large for one read, find its `## ` headings with `search` and
   read only the sections you need by line range.
3. **Ask the user**: last resort. Name the specific missing field; do not ask for a general
   restatement of the task.

### Why the file matters

Conversation context is ephemeral and may be compacted during a long session. A handoff
transfers control, so nothing in your caller's context is guaranteed to survive. The story
plan on disk is the durable reference; prefer it over recollection whenever the two disagree.

### Restate understanding

Before writing any code, restate the task in one sentence. If your restatement and the
acceptance criteria disagree, resolve that before proceeding, not after.

## Subagent Mode

Applies when the task starts with **"You are running as a subagent of @story"**. `@story` is
the only caller and nobody reads your output live, so these rules replace the standalone
behavior above wherever they differ. When the task does not start with that sentence, you are
used directly: keep the intake order above (conversation, plan, ask the user).

- **Never ask the user.** Take the fields from the handoff prompt, then the plan on disk. A
  field you still cannot resolve goes under **Open Questions** in your return; `@story` decides
  whether to ask.
- **No handoff buttons.** Do not offer a next step to the user; return and stop.
- **No commit or push** unless your task says so.
- **One terminal command per call**: no `;`, `&&` or pipes. A chained command does not match the
  auto-approve rules and prompts the user.
- **Tests only through `test.mjs`**, never with `--scope all`; see **Running Tests**.
- **Return your agent's own Return block**, nothing less and no free-form substitute. When the
  handoff prompt's expected return differs, your agent's block wins. Reviewers end with the
  `review-gate` block.
- **Keep your return under 50 lines**: put long content in the files your task names and return
  their paths. A large result is stored outside the workspace, where every read of it prompts.
- **A hard MCP dependency that is unavailable** (see **MCP Server Availability**): return it as
  a blocking open question with the remediation steps instead of telling the user.

## Progress Tracking

For any multi-step task, call `manage_todo_list` at the start. Mark each item **in-progress**
before starting it and **completed** immediately after finishing it. Do not batch completions
at the end; the list is how the user follows a long-running task. As a subagent of `@story` you
may skip it: nobody follows your progress live (see **Subagent Mode**).

## Running Tests

Run tests only with `node .github/scripts/test/test.mjs`, as described in
`.github/skills/test-runner/SKILL.md`, the single source for suites, scopes and exit codes. In
short: implementers run only the tests they created or altered (`--scope created`; the E2E
agent adds `--repeat 3`), `@code-review` runs `--scope impacted`, and nobody runs a whole suite.
`@assistant` runs no tests for a chore.

## Terminal Safety

Applies to every agent, not only in Subagent Mode.

- **Never run a destructive command**: `rm`/`del`/`Remove-Item`, `git checkout -- <path>`,
  `git restore`, `git reset`, `git clean`, `git stash`. To undo your own change, edit the file
  back. The one exception: you may delete a file you created in this task (for example a
  temporary file). A file you did not create is never yours to delete.
- **Another agent may be running in parallel and share your terminal.** Act only on the output
  of the command you just ran; never on output, failures or files that belong to another
  agent's scope.
- **Read tool versions from the project's files** (for example `.nvmrc`, the `engines` field of
  `package.json`, `global.json`) instead of running version commands, and only once per task.

## MCP Server Availability

Some agents depend on an MCP server that may not be running. Check before the first call that
needs it, and classify the dependency:

- **Hard dependency**: the agent cannot do its job without it (the browser automation server for
  `@test-e2e`). Stop and give the user the remediation steps (as a subagent of `@story`, return
  them as a blocking open question; see **Subagent Mode**). Do not guess at component props or
  selectors.
- **Soft dependency**: the agent is better with it but can continue (Context7 for library
  documentation). Say explicitly that you are continuing without it and note the limitation in
  your output. Never silently skip the step. A Context7 rate-limit error counts as unavailable:
  continue with the codebase and the skills, and do not retry in a loop.

Only the servers in `.vscode/mcp.json` are available to the whole team. Never depend on a server
contributed by a personally installed extension: it will be missing for everyone else, and VS
Code ignores unknown tool names silently rather than erroring.

## Git

Git commands belong to the agent file that runs them (`@story` creates the branch; see **Git
Operations** in `story.agent.md`; `@pr-create` commits and pushes). Reviewers never run git.
