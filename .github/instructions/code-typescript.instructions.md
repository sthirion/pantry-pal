---
applyTo: '**/*.{ts,tsx}'
---

# TypeScript / React Code Conventions

## TypeScript

- Enable `strict: true` and `noImplicitAny: true` in tsconfig.
- Avoid `any` — use specific types, generics, or `unknown`.
- Use `readonly` on props interfaces and data arrays.
- Mark optional properties with `?`; never use `| undefined` explicitly when `?` suffices.
- Use union types for constrained string values: `type PolicyStatus = 'active' | 'expired' | 'cancelled'`.
- Avoid index signatures (`[key: string]: T`) when specific keys are known.
- Put shared types in `*.types.ts` files next to the code that owns them.

## Naming

- **PascalCase**: components, types, interfaces, enums, classes.
- **camelCase**: variables, functions, hooks, service methods.
- **UPPER_SNAKE_CASE**: module-level constants.
- Files: `{ComponentName}.tsx` for components, `use{Name}.ts` for hooks, `{domain}Service.ts` for services.
- Hooks: prefix with `use` — `usePolicy`, `useAuth`.

## Components

- Use functional components with hooks only — no class components.
- Named exports only — no default exports for components.
- Wrap page-level components in error boundaries; handle loading and error states.
- Styling: SCSS modules or existing CSS classes — no inline styles.
- Always `memo()` components that receive callbacks or are rendered in lists.
- Set `ComponentName.displayName` on every memo/forwardRef component.
- Props interface: use `readonly` on all properties.
- Use the project's class-name utility (if any) for `className` generation — avoid manual string concatenation.

## Imports

Order imports as:
1. React and React-related
2. Third-party libraries
3. Shared component/design-system packages
4. Internal modules (absolute paths)
5. Relative imports
6. Style imports (`.scss`)

## State Management

- Use **TanStack Query** for all server state — never `useState` + `useEffect` for fetching.
- Use query key constants from `@constants/queryKeys` — no inline string keys.
- Use React Context for application-level UI state only (not server data).
- Derive values in render — avoid `useState` for derived data.

## Localization

- All user-facing strings must use `useTranslation` / `t()` from react-i18next.
- All dates must use `date-fns` with locale — no `toLocaleDateString()` directly.
- All numbers/currency must use i18next `n()` formatting.

## Accessibility

- All interactive elements must be keyboard-navigable.
- Icon-only buttons must have `aria-label`.
- Form fields must have associated labels.
- Never `outline: none` without a visible focus replacement.

## Security

- Zod in the browser under a Content Security Policy without `'unsafe-eval'`: call
  `z.config({ jitless: true })` once at startup, before any schema is used. Zod 4 otherwise probes
  `new Function`, which the CSP reports as a violation.

> For deep patterns and examples (TanStack Query, Formik/Yup, shared components, hooks), see `.github/skills/pr-review-typescript/SKILL.md`.
