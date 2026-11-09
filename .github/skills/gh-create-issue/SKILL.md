---
name: gh-create-issue
description: >
  Content guidance for creating Issues in GitHub via `tracker.mjs create`: label
  conventions, repro-steps format, and accessibility bug details.
  Use when creating bugs from test failures, accessibility violations, or any defect found during QA.
---

# Skill: Creating GitHub Issues

Read this skill whenever you need to create an Issue in GitHub. The actual create call is
`node .github/scripts/tracker/tracker.mjs create --input <file.json>` (dry-run preview first, then
approve) - see the `@requirements` agent for the full preview -> approve -> create flow. This
skill only covers the *content* of the issue: what to put in each field, not how to call the
script.

The repo owner/name and label conventions (`bugLabels`/`storyLabels`) are all resolved
automatically by `tracker.mjs` from `.github/scripts/tracker/tracker.config.json` - never hardcode or ask the
user for them.

## Input JSON Shape

Bug:

```json
{
  "type": "bug",
  "title": "Bug title here",
  "description": "Plain-language summary of the bug and its impact.",
  "reproSteps": ["Navigate to [page] as [persona].", "Perform [action].", "Observe [result]."],
  "expected": "What should happen.",
  "actual": "What actually happens - include rule name and impact if from axe-core.",
  "environment": "Chrome via Playwright",
  "tags": ["accessibility"],
  "parent": 12,
  "links": [{ "to": 34, "relation": "related" }]
}
```

Story:

```json
{
  "type": "story",
  "title": "Story title here",
  "description": "Plain-language description of the feature.",
  "acceptanceCriteria": "- Given ..., when ..., then ...",
  "tags": ["dashboard"]
}
```

`parent`/`links[].to` are issue numbers; `links[].relation` is one of `parent`, `child`,
`predecessor`, `successor`, `related`, `tested-by`. `tags` combine with the tracker config's
`bugLabels`/`storyLabels` to form the issue's labels.

### Default Labels

| Scenario                            | Tags to add                |
| ------------------------------------ | --------------------------- |
| Critical ARIA violation (axe-core)   | `["accessibility", "priority:high"]` |
| Missing heading / landmark           | `["accessibility"]`         |
| Color contrast failure               | `["accessibility"]`         |
| General functional bug               | `[]`                        |

Check `.github/scripts/tracker/tracker.config.json` for the repo's actual `bugLabels`/`storyLabels` - the above
are conventions, not guarantees.

---

## Repro Steps Format

`reproSteps` is a plain array of strings - the script numbers them and renders `### Steps to
reproduce` / `### Expected` / `### Actual` / `### Environment` sections for you. Keep each step
a single, concrete action:

- "Navigate to [page] as [persona]."
- "Perform [action]."
- "Observe [result]."

`expected`/`actual`/`environment` are single strings, not part of the array.

---

## Accessibility Bug - axe-core Violations

When creating issues from axe-core E2E test failures, include in `actual` (or spread across
`reproSteps`):

- The exact **rule name** (e.g. `page-has-heading-one`, `aria-allowed-attr`)
- The **impact level** (Critical / Serious / Moderate / Minor)
- The **WCAG criterion** (e.g. `2.4.6 AA`, `1.4.11 AA`)
- The **element** that triggered the violation (e.g. `<ul role="tablist">`)
- The **test file** that caught it (e.g. `accessibility.axe.spec.ts`)

---

## After Creating

1. Display the new issue number and URL written back into the input file by `tracker.mjs create`.
2. If the issue is related to a known PR or E2E test and wasn't already linked via `links`, run
   `tracker.mjs link <id> --to <id> --relation related`.
