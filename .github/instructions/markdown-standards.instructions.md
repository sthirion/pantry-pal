---
applyTo: '**/*.md'
---

# Markdown Formatting Standards

> **Note:** Linter configuration (`.markdownlintrc.json`) disables MD022 and MD032 for technical documentation. These guidelines remain best-practice recommendations even if not enforced by the linter.

## Headings

- Always add a blank line before and after every heading.
- Use heading hierarchy: `#` for main sections, `##` for subsections, `###` for details.
- Never use bold text as a heading substitute — use actual heading levels.

```markdown
<!-- ✅ CORRECT -->

## Section Title

Content goes here.

<!-- ❌ INCORRECT -->
**Section Title**
Content goes here.
### Another Section
No blank line before this heading.
```

## Code Blocks

- Always specify the language/format identifier on fenced code blocks.
- Add blank lines before and after code blocks.
- Use consistent identifiers: `csharp`, `typescript`, `powershell`, `json`, `yaml`, `text`, `markdown`.

- ✅ CORRECT: ` ```csharp ` followed by code and ` ``` `
- ❌ INCORRECT: ` ``` ` with no language identifier

## Lists

- Always add a blank line before the first list item and after the last list item (MD032).
- Use `-` for unordered lists consistently.
- Use `1.` for ordered lists.
- Align nested list items properly.

```markdown
<!-- ✅ CORRECT -->

Some paragraph text.

- Item one
- Item two

Next paragraph.

<!-- ❌ INCORRECT -->
Some paragraph text.
- Item one
- Item two
Next paragraph.
```

## Links and URLs

- Use descriptive link text — no "click here" or bare URLs in prose (MD034).
- Never place a raw URL directly in text. Either wrap in angle brackets or use `[label](url)`.
- Use relative paths for internal project links.

```markdown
<!-- ✅ CORRECT -->
See the [project backlog](<https://tracker.example.com/backlog>).
Also valid: <https://tracker.example.com>

<!-- ❌ INCORRECT -->
See the backlog at https://tracker.example.com/backlog.
```

## Tables

- Separator rows must include spaces on both sides of each dash group: `| --- |` not `|---|` (MD060).
- All column values should align with the header width for readability (MD060).

```markdown
<!-- ✅ CORRECT -->
| ID     | Name              |
| ------ | ----------------- |
| 10636  | Personal Elections |

<!-- ❌ INCORRECT -->
| ID | Name |
|---|---|
| 10636 | Personal Elections |
```

## Common Linting Rules

| Rule | Description |
| ---- | ----------- |
| MD022 | Headings must be surrounded by blank lines |
| MD031 | Fenced code blocks must be surrounded by blank lines |
| MD032 | Lists must be surrounded by blank lines |
| MD034 | No bare URLs — wrap in `<url>` or `[text](url)` |
| MD036 | Use actual headings, not bold text |
| MD040 | Fenced code blocks must have a language identifier |
| MD060 | Table separator rows must have spaces: `\| --- \|` not `\|---\|` |

## Quality Checklist

Before committing any markdown:

- [ ] All headings have blank lines before and after
- [ ] All code blocks specify a language
- [ ] No bold text used as headings
- [ ] No bare URLs — all raw URLs wrapped in `<>` or linked with `[text](url)`
- [ ] Table separator rows use `| --- |` style with spaces
- [ ] Lists have blank lines before and after them
- [ ] Lists have consistent markers and proper spacing
