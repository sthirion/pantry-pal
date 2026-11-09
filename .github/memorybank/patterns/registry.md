# Pattern Registry

The agents' record of which coding patterns and libraries this codebase uses, and which
are preferred. Maintained by `@drift` and `.github/scripts/drift/scan-drift.mjs` — it starts
empty and fills itself:

- The **first scan** records every dependency in the project's manifests as `Active`.
- Later scans add new dependencies as `Candidate` for a human decision via `@drift /scan`.
- Patterns are added when `@drift` registers a detector for one (in
  `.github/scripts/drift/drift.config.json`), typically when adopting or deprecating an approach.

The script owns every column except **Status** and **Notes**, which record decisions.
Don't edit between the `drift:` markers by hand except for those two columns.

Last scan: _never_

## Patterns

<!-- drift:patterns -->
| Pattern | Scope | Status | Files | Occurrences | Oldest use | Newest use | Skills | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
<!-- /drift:patterns -->

## Libraries

<!-- drift:libraries -->
| Library | Ecosystem | Version | Status | First seen | Notes |
| --- | --- | --- | --- | --- | --- |
<!-- /drift:libraries -->

## Columns

| Column | Meaning |
| --- | --- |
| Files / Occurrences | Files containing the pattern, and total matching lines, at the last scan. |
| Oldest use / Newest use | Commit dates (UTC, from `git blame`) of the oldest and newest surviving matching lines. A Deprecated pattern with a recent **Newest use** is still being written. |
| Skills | Skills that teach or reference the pattern — the ones to update when it's deprecated. |
| First seen | Date (UTC) of the scan that first found the library. |
| Notes | Decision rationale, replacement, and the tracker story for the migration. |

## Status Legend

- **Candidate** — detected, awaiting a human decision.
- **Active** — the preferred approach; skills teach it.
- **Deprecated** — don't use in new code; `@code-review` flags new uses and a tracker story
  covers updating the skills (and optionally migrating existing code).
- **Removed** — was Deprecated and no longer appears in the codebase (set by the scan).
- **Ignored** — reviewed and deliberately not tracked; not flagged again.
