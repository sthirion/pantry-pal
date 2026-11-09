---
applyTo: '**/*.{cs,java,kt,ts,tsx,js,jsx,mjs,astro}'
---

# Code Writing Standards

## Principles

- **Single Responsibility** — each class/function has one reason to change.
- **Open/Closed** — open for extension, closed for modification.
- **Interface Segregation** — clients don't depend on methods they don't use.
- **Dependency Inversion** — depend on abstractions, not concretions.
- **DRY** — extract repeated logic; don't tolerate obvious duplication.
- **KISS / YAGNI** — prefer simple solutions; don't build for theoretical futures.
- **Composition over inheritance** — favor injected dependencies over deep hierarchies.

## Security (OWASP)

- Validate all inputs at API boundaries — never trust client-supplied data.
- Check **authorization before data access**, not just authentication.
- Return `403` for unauthorized resources (check `project-config.md` for any project-specific convention).
- Never log PII, tokens, secrets, or stack traces in structured logs or error responses.
- Error responses must not expose internal structure (paths, IDs, exception messages).
- Use parameterized queries / ORM — never build SQL strings from user input.

## Async Rules

- Use non-blocking async I/O consistently — never block on async results (e.g. `.Result`/`.Wait()` in C#, `.get()`/`.join()` on futures in Java, unawaited promises in TS).
- Propagate cancellation (`CancellationToken`, `AbortSignal`, request-scoped timeouts) through the entire async call chain.
- Release resources deterministically (`using`, try-with-resources, `finally`).

## Naming

- Names should reveal intent. Avoid abbreviations (except common acronyms: DTO, API, HTTP).
- Functions/methods should do one thing and be named for what they do.
- No magic numbers or strings — use named constants.

## Comments

- Write code that documents itself; use comments to explain **why**, not what.
- Never leave commented-out code in committed files.
