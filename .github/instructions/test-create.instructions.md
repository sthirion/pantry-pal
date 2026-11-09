---
applyTo: '**/*Tests*/**,**/*.test.{ts,tsx,js,jsx},**/*.spec.{ts,tsx,js,jsx},**/src/test/**'
---

# Test Writing Principles

## Universal Rules

- **Arrange-Act-Assert** — every test has exactly these three sections, in order.
- **One logical assertion per test** — if a test can fail for two different reasons, split it.
- **Descriptive names** — follow the stack's naming convention; the default pattern is `MethodOrAction_StateUnderTest_ExpectedOutcome`.
- **Independence** — tests must run in any order without shared mutable state.
- **Determinism** — no time-dependent logic, random values, or external network calls.
- **No hardcoded data** — use the project's test data builders / fixtures (see `.github/project-config.md`).

## Coverage Targets

For every new feature, write tests covering:

```markdown
[ ] Happy path — primary success scenario
[ ] Negative/error input — invalid data, missing required fields
[ ] Authorization boundary — unauthenticated and unauthorized access
[ ] Edge cases — null, empty, boundary values, empty collections
[ ] Not-found — resource that doesn't exist returns 404
```

## Anti-Patterns

- No fixed sleeps (`Thread.sleep()`, `setTimeout` waits, `page.waitForTimeout()`) — use async patterns and auto-waiting.
- No tests that depend on execution order.
- No assertions on implementation details — test behavior, not internals.
- No over-mocking — only mock at system boundaries (HTTP, DB, external services).

> For framework-specific patterns, see the stack's `test-api-patterns*` skill under `.github/skills/` (backend) or `.github/skills/test-e2e-patterns/SKILL.md` (E2E).
