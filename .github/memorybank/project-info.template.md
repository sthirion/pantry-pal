# Ticket Tracker Project Info (Template)

> Detailed tracker reference for agents. Copy this file to `project-info.md` and fill in
> your project's real values. Agents read `project-info.md` for suite descriptions,
> backlogs, work-item type usage, and a running log of recent work items.
>
> Machine values the scripts need (org, project, area path, labels, field keys, the default test
> plan/suite ids) live in `.github/scripts/tracker/tracker.config.json` instead. This file holds
> the human/LLM context, including the **list of test suites**: test agents pick a suite from it
> and pass its id with `--suite`. This example uses Azure DevOps terminology —
> adapt for your tracker (GitHub Issues, Jira, etc.).

## Test Plans

> `tracker.config.json` (`testPlan.planId` / `testPlan.suiteId`) keeps only the **default** plan
> and suite. `tracker.mjs testcase create` takes `--plan <id>` and `--suite <id>` to override
> them, so projects with many suites list them all below.

## Notable Suites

| Suite ID | Suite Name | Description |
| -------- | ---------- | ----------- |
| `<id>`   | `<name>`   | `<suite description>` |

## Backlogs

| Team | Backlog | URL |
| ---- | ------- | --- |
| `<team>` | `<backlog name>` | `<backlog url>` |

## Work Item Types

| Type         | Use For                  | Key Fields                                 |
| ------------ | ------------------------ | ------------------------------------------ |
| `User Story` | Feature requirements     | Description, Acceptance Criteria           |
| `Bug`        | Defects and regressions  | ReproSteps, SystemInfo, Priority, Severity |
| `Task`       | Implementation sub-tasks | Description, Original Estimate             |
| `Test Case`  | Test suite entries       | Steps, AutomatedTestName                   |

## Recent Work Items

> Optional running log agents can append to for quick reference.

| ID    | Type | Title |
| ----- | ---- | ----- |
| `<id>` | `<type>` | `<title>` |
