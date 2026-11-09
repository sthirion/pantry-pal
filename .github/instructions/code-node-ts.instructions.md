---
applyTo: '**/*.ts'
---

# Node.js / TypeScript Backend Code Conventions

## Style

- Enable `strict: true` and `noImplicitAny: true` in tsconfig.
- Avoid `any` — use specific types, generics, or `unknown`.
- Prefer `async`/`await` over raw Promise chains.

## Structure

- One route/controller per resource; keep handlers thin, push logic into services.
- Validate all inbound request bodies/params at the route boundary (e.g. zod).

## Naming

- **camelCase**: variables, functions, parameters.
- **PascalCase**: classes, types, interfaces.
- **UPPER_CASE**: constants.

## Async / Errors

- Always propagate `AbortSignal`/cancellation through downstream async calls where supported.
- Never swallow errors — rethrow or handle explicitly; no empty `catch` blocks.
- Use a centralized error-handling middleware rather than per-route try/catch duplication.

## Security

- Return `403 Forbidden` for unauthorized resource access (check `.github/project-config.md` for any project-specific convention).
- Never log PII, tokens, or sensitive values.
- Validate all inputs at API boundaries — never trust client-supplied data.

> For review patterns, see `.github/skills/pr-review-node-ts/SKILL.md`.
