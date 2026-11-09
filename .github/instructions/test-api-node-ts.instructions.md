---
applyTo: '**/*.spec.ts'
---

# Integration Test Conventions (Node.js / TypeScript)

## Test Naming

Pattern: `{httpMethod} {endpoint} {scenario} {expectedOutcome}`

Examples:

- `GET /policies with authentication returns 200 with policies`
- `POST /policies with invalid data returns 400 with errors`
- `DELETE /policies/:id with valid id returns 204`

## Required Coverage Per Endpoint

```markdown
[ ] Authenticated happy path — correct status and response shape
[ ] Unauthenticated — returns 401
[ ] Unauthorized role — returns 403
[ ] Invalid input — returns 400 with field-level errors
[ ] Not found — returns 404
[ ] Conflict / concurrency (if applicable) — returns 409
```

## Frameworks

- **Test runner**: Vitest (or Jest) with `describe` / `it` blocks.
- **HTTP assertions**: Supertest (`request(app)`) against the Express app instance.
- **Assertions**: the runner's `expect`.
- **Test data**: a builder or factory function — never hardcode magic values inline.
- **Mocking**: `vi.mock` / `jest.mock` for service/repository substitutes only.

## Project Location

See `.github/project-config.md` for the integration test location (typically `test/` or `*.spec.ts` beside sources).

> For full patterns, examples, and auth helpers, see `.github/skills/test-api-patterns-node-ts/SKILL.md`.
