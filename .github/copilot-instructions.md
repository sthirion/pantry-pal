# ADLC — Global Copilot Instructions

These are the **global baseline rules** for the Agent Development Lifecycle (ADLC)
framework, applied across all agents and conversations.

- **Project-specific configuration** (tech stack, project structure, naming, auth, tooling)
  lives in [.github/project-config.md](project-config.md). Agents read that file to learn
  the specifics of the current project.
- **Per-domain guidance** lives in the specialized agents in `.github/agents/` and the
  instruction files in `.github/instructions/`.

> **Adopting ADLC in a new project?** Fill in `.github/project-config.md` with your stack,
> paths, and conventions. You should not need to edit the generic agents, instructions, or
> skills — extend them through `project-config.md` and your own `*.instructions.md` files.

## The Agent Model

ADLC organizes work into specialized agents across three tiers:

- **Orchestrators** (`@feature`, `@story`) — manage the lifecycle and route work to specialists.
- **Implementers** (`@code-backend`, `@code-frontend`, `@test-api`, `@test-e2e`) — produce code and tests.
- **Quality Gates** (`@requirements-review`, `@code-review`, `@test-review`, `@pr-create`) — review, rate, and ship.

Supporting agents: `@requirements` (story analysis/refinement), `@plan` (architecture/design),
`@drift` (keeps skills in step with codebase drift), `@assistant` (general-purpose fallback).

Each agent owns one phase, uses a model tuned to its task, and has a minimal set of scoped tools.
Nothing is written to your ticket tracker or Git without explicit approval. For `@story`,
confirming the Story Plan is that approval for the branch, commits, push, and PR it describes.

## Development Process

For feature work, follow the agent process:

1. Start with `@requirements` to clarify requirements from tracker work items.
2. Use `@feature /start feature <name>` to initialize the feature workspace.
3. Progress through phases: PRD → Design → Tasks → Implementation.
4. Use specialized agents for each implementation domain:
   - Backend: `@code-backend`
   - Frontend: `@code-frontend`
   - Integration tests: `@test-api`
   - E2E tests: `@test-e2e`
5. Always finish with `@code-review` before creating a PR via `@pr-create`.

## Global Code Standards

- Follow SOLID principles and KISS/DRY.
- All code must be free from OWASP Top 10 vulnerabilities.
- Check authorization before data access, not just authentication.
- Return `403` for authorization failures (check `project-config.md` for any project-specific convention).
- Use async patterns with cancellation propagation throughout async chains (language-specific
  details in the relevant `code-*` instruction file).
- Never commit secrets, tokens, or sensitive configuration values.
- Record architectural decisions in `.github/memorybank/`.

## Security Requirements

- Validate all inputs at API boundaries — never trust client-supplied data.
- Check authorization before data access, not just authentication.
- Structured logging only — never log PII, tokens, or sensitive values.
- Error responses must not leak internal structure (stack traces, IDs, paths).

## Project-Specific Rules

The following are defined per project in [.github/project-config.md](project-config.md):

- **Technology stack** — backend, frontend, testing, auth, DevOps.
- **Project structure** — folder layout and where code belongs.
- **Naming conventions** — projects, namespaces, components, test files, branches.
- **Ticket Tracker** — organization, project, area paths, and identifiers.
- **Local development** — startup commands, local auth, local data.
- **Build & test commands** — how to build and run each test suite.
- **Terminal & shell** — which shell syntax to use for terminal commands.

Always read `project-config.md` before performing project-specific actions.

## Markdown Documentation Standards

> Markdown formatting standards are in `.github/instructions/markdown-standards.instructions.md`
> (auto-loaded for `.md` files).
