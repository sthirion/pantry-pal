---
applyTo: '**/*E2ETests*/**'
---

# E2E Test Conventions

## Test Naming

Use descriptive test names that reflect the user journey being tested.
Tag every test with the environments it should run in:

| Tag | Environments |
| --- | --- |
| `@TEST` | CI test environment |
| `@QA` | QA environment |
| `@UAT` | UAT environment |
| `@PROD` | Production smoke tests |

Destructive or write tests must NOT carry `@PROD`.

## Required Coverage Per Feature

```markdown
[ ] Happy path — user can complete the primary action end-to-end
[ ] Auth boundary — unauthenticated user is redirected to login
[ ] Error state — server error or validation failure shows user-friendly message
[ ] Accessibility — page passes axe-playwright WCAG 2.1 AA check
[ ] Empty state — collection page with no data shows empty state message
```

## Locators

- Always prefer `[data-testid="..."]` locators — never CSS classes or text.
- Never use `page.waitForTimeout()` — use Playwright auto-waiting with `expect(locator)`.

## Authentication

- Use `AuthenticatedSessionManager` with session reuse for all non-auth tests.
- Use persona-based testing with the personas defined in `TestConfig` (see `.github/project-config.md`).

## Project Location

See `.github/project-config.md` for the E2E test project location.

> For full patterns, POM examples, auth helpers, and multi-environment config, see `.github/skills/test-e2e-patterns/SKILL.md`.
