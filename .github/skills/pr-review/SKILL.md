---
name: pr-review
description: "Pull request review workflow, severity levels, and output format. Use when performing a PR review."
---

# Skill: Pull Request Review Process

Read this skill when performing a PR review. It defines the review workflow, severity levels, and output format.

## Review Severity Levels

| Level       | Label            | Action                                               |
| ----------- | ---------------- | ---------------------------------------------------- |
| Critical    | 🚨 Must Fix      | Block merge — security, data loss, broken contract   |
| Important   | ⚠️ Should Fix    | Strong recommendation — correctness, maintainability |
| Enhancement | 💡 Consider      | Non-blocking improvement — style, future-proofing    |
| Positive    | ✅ Good Practice | Acknowledge excellent patterns for team learning     |

## Review Checklist

### Architecture & Design

```markdown
[ ] Single Responsibility Principle — each class/function has one reason to change
[ ] Open/Closed — open for extension, closed for modification
[ ] Interface Segregation — clients don't depend on interfaces they don't use
[ ] Dependency Inversion — depend on abstractions, not concretions
[ ] Clear layer separation — no business logic in controllers or UI components
[ ] No business logic in frontend — business rules, calculations, eligibility checks, status transitions, and domain validations belong in the backend API; frontend handles only UI validation (required fields, format checks) and display logic
[ ] No circular dependencies introduced
[ ] Consistent pattern usage — matches existing codebase conventions
```

### Security (OWASP Top 10)

```markdown
[ ] All inputs validated at API boundaries
[ ] Authorization checked before data access (not just authentication)
[ ] Returns 403 for unauthorized resource access
[ ] No sensitive data in logs, error messages, or stack traces
[ ] No hardcoded secrets, tokens, or credentials
[ ] SQL injection prevention — parameterized queries or ORM
[ ] XSS prevention — outputs sanitized or framework-protected
[ ] CSRF protection where applicable
```

### Code Quality

```markdown
[ ] Meaningful names — no abbreviations, no single-letter variables except loops
[ ] Functions focused and concise (ideally under 20 lines)
[ ] No dead code or commented-out blocks
[ ] No duplicate logic — DRY applied appropriately
[ ] Error handling — no swallowed exceptions
[ ] Structured logging — appropriate levels, no PII logged
[ ] Async I/O used consistently — no blocking on async results
[ ] Cancellation propagated through async chains
```

### Test Coverage

```markdown
[ ] Happy path covered
[ ] Negative/error cases covered
[ ] Authorization boundary tests present
[ ] Edge cases (null, empty, boundary values) addressed
[ ] Tests are independent — no shared mutable state
[ ] Test names follow the project's naming convention
[ ] No over-mocking — real behavior tested where practical
```

### Business Requirements

```markdown
[ ] All acceptance criteria have corresponding implementation
[ ] Each AC has at least one test validating it
[ ] API contracts match the contract specification (e.g. OpenAPI)
[ ] UI changes match the linked design (if applicable)
[ ] Error messages are user-friendly and actionable
[ ] Localization applied to all user-facing text
[ ] Audit trail requirements met if applicable
```

## Output Format

```markdown
## PR Review: #{number} — {title}

**Status:** ✅ Approved | ⚠️ Needs Minor Changes | 🚨 Requires Changes

**Files reviewed:** {count} | **ADO:** {storyId}

---

### 🚨 Must Fix

- **[Category]** `path/to/file.cs:42` — description
  - Impact: what breaks or is at risk
  - Fix: specific action required

### ⚠️ Should Fix

- **[Category]** `path/to/file.ts:15` — description
  - Recommendation: suggested improvement

### 💡 Consider

- **[Category]** — suggestion

### ✅ Good Practices

- **[Category]** — what was done well and why it matters
```

## What NOT to Review

- Files not in the current PR diff
- Style preferences not covered by established conventions
- Theoretical scenarios with no realistic risk
- Already-existing code not touched by the PR
