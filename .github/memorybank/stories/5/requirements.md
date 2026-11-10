# Requirements — Story #5: Sign in and household access

**Status**: Draft (open questions Q1 to Q7 not yet answered; defaults below are assumptions)
**Scope**: backend (`src/pantry-pal`, `src/pantry-pal.Shared`) | **Tasks**: TASK-005, TASK-006
**Parent**: #2 Shopping Lists MVP | **Predecessor**: #4 (closed; `user` table, error format, origin check) | **Successor**: #6 (uses the guards)

## Codebase facts that shape this story

- `db/schema.ts` defines `user` with `createdAt`/`updatedAt` as plain `integer(...)` (no `mode`). Better Auth writes `Date` objects, which `better-sqlite3` cannot bind. The Drizzle columns need `{ mode: 'timestamp_ms' }`. The SQL type stays `integer`, so no table rebuild is needed (this matches the 2026-11-10 decision).
- `config.ts` has `publicOrigin` but no `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL`. The story says that `trustedOrigins` comes from `BETTER_AUTH_URL`. design.md (Security) says that it comes from `PUBLIC_ORIGIN`. See Q1.
- `errors.ts` already maps `401 unauthenticated`, `403 forbidden` and `429 rate_limited`. Better Auth returns its own body (`{ code, message }`), not this format. See Q2.
- `origin-check.ts` runs before every route, including `/api/auth/*`. Requests without an `Origin` header pass, so the CLI and tests work.
- `app.ts` exposes `registerRoutes`, which tests can use to mount a guarded test-only data route.
- `@pantry-pal/shared` has no `MeResponse` type yet. `better-auth` is not in `package.json` yet.

## Requirements

- **REQ-AUTH-001**: The system shall authenticate household members with an email and password through Better Auth mounted at `/api/auth/*` (Drizzle adapter, `provider: 'sqlite'`, existing `user` table, new `session`/`account`/`verification` tables via a drizzle-kit migration). Actor: household member. Priority: Must.
- **REQ-AUTH-002**: The system shall not create accounts through the API (`emailAndPassword.disableSignUp: true`). Priority: Must.
- **REQ-AUTH-003**: Sessions shall last 30 days and refresh at most once per day on use (`session.expiresIn = 60*60*24*30`, `updateAge = 60*60*24`). The cookie shall be `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`. The cookie cache shall stay **disabled**, so revoked sessions stop working immediately. Priority: Must.
- **REQ-AUTH-004**: `POST /api/auth/sign-in/email` shall allow 5 requests per 60 s per client IP. The 6th returns `429 rate_limited`. Priority: Must.
- **REQ-AUTH-005**: `requireSession` shall return `401 unauthenticated` for a missing, unknown, expired or revoked session. `requireHousehold` shall return `403 forbidden` for a user with no `household_member` row. Otherwise it sets `user` and `householdId` (from the database, never from the client) on the Hono context. Priority: Must.
- **REQ-AUTH-006**: `GET /api/me` shall return the signed-in user and their household. Priority: Must.
- **REQ-CLI-001**: The admin CLI (`src/cli.ts` → `dist/cli.js`, `npm run admin -- <cmd>`) shall provide `household:create`, `user:create` and `user:reset-password`. Passwords are read from a hidden prompt only. Priority: Must.
- **REQ-SEED-001**: `npm run seed` shall create household A (2 users) and household B (1 user), with credentials from environment variables. Priority: Must.

## Acceptance Criteria (refined)

- **AC-1 Sign-in success**: Given a user created with `user:create`, when `POST /api/auth/sign-in/email` is sent with the correct email and password, then the response is `200` and sets the session cookie (`HttpOnly`, `SameSite=Lax`, `Max-Age` 30 days; `Secure` only in production). `GET /api/me` with that cookie then returns `200` with `{ user: { id, name, email }, household: { id, name } }` and no other fields.
  - The email is matched case-insensitively. The CLI stores it lowercased and trimmed, the same way Better Auth normalizes it.
- **AC-2 Wrong credentials**: Given a wrong password or an unknown email, when they sign in, then the response is `401` with the same body for both cases (no user enumeration) and no cookie is set.
- **AC-3 Rate limit**: Given 5 sign-in requests (successful or not) from one IP within 60 s, when a 6th arrives, then it returns `429` with `{ error: { code: 'rate_limited', message: 'Too many requests.' } }` and a `Retry-After`/`X-Retry-After` header. A different IP is not affected, and after the window passes sign-in works again.
  - The limit is per IP from `X-Forwarded-For`, which is set by the Nginx proxy (see Q4). Better Auth's built-in sign-in rule (3 per 10 s) is overridden by `customRules`. `rateLimit.enabled: true` in every environment, including tests.
- **AC-4 Sign-up disabled**: Given anyone, when they `POST /api/auth/sign-up/email` with a valid body, then the response is a non-2xx status (see Q3), no `user` or `account` row is created, and no cookie is set.
- **AC-5 Unused auth endpoints closed**: Given anyone, when they call a Better Auth endpoint outside the allowlist (`sign-in/email`, `sign-out`, `get-session`), then it returns `404` (`disabledPaths`; see Q5).
- **AC-6 Guards**: Given no cookie, or an invalid, expired or revoked one, when a guarded endpoint is called, then it returns `401 unauthenticated`. Given a valid session for a user with no `household_member` row, then it returns `403 forbidden`. Given a member, then the handler receives `householdId` equal to that user's membership.
- **AC-7 Sign-out**: Given a signed-in user, when they `POST /api/auth/sign-out`, then the `session` row is deleted and the old cookie value returns `401` on `GET /api/me`. Sessions on the user's other devices stay valid.
- **AC-8 household:create**: `household:create --name <name>` creates a household, prints its id (UUID) on stdout and exits `0`. A missing or empty name prints an error to stderr and exits non-zero.
- **AC-9 user:create**: `user:create --email --name --household` prompts twice for the password with hidden input. In one transaction it creates the `user`, the `account` (`providerId: 'credential'`, scrypt hash through Better Auth's password hasher) and the `household_member` row (role: see Q6). It exits `0` and prints the user id.
  - Negative: an unknown household, a duplicate email (case-insensitive), an invalid email, a password shorter than 8 or longer than 128 characters, or prompts that do not match → error on stderr, exit non-zero, no rows written.
- **AC-10 user:reset-password**: `user:reset-password --email` prompts twice (hidden) and, in one transaction, replaces the credential hash and deletes **all** `session` rows of that user. Afterwards the old password returns `401` at sign-in, every old cookie returns `401` and the new password works.
  - Negative: an unknown email → exit non-zero, nothing changed.
- **AC-11 No password arguments**: Given any CLI command, then no `--password` option (or similar) is accepted. An unknown option → exit non-zero with usage. When stdin is not a TTY, the command exits non-zero instead of reading a password in clear text (see Q7).
- **AC-12 Seed**: `npm run seed` reads `SEED_PASSWORD` (plus optional `SEED_EMAIL_DOMAIN`, see Q7). If the variable is missing, it exits non-zero and writes nothing. It refuses to run when `NODE_ENV=production`. It is idempotent: a second run creates no duplicates and exits `0`.
- **AC-13 Config**: `BETTER_AUTH_SECRET` is required when `NODE_ENV=production` (startup fails with a clear message without leaking the value). Outside production a fixed development secret is allowed.

## BDD scenarios

```gherkin
Feature: Sign in and household access

  Background:
    Given household "A" with users "a1@test" and "a2@test" and household "B" with user "b1@test"

  Scenario: Member signs in and reads their profile
    When "a1@test" signs in with the correct password
    Then the response is 200 and sets an HttpOnly SameSite=Lax session cookie
    And GET /api/me returns user "a1@test" and household "A"

  Scenario: Wrong password and unknown email look the same
    When "a1@test" signs in with a wrong password
    And "nobody@test" signs in with any password
    Then both responses are 401 with identical bodies and no Set-Cookie

  Scenario: Sign-in rate limit
    Given 5 sign-in attempts from IP 203.0.113.7 within 60 seconds
    When a 6th attempt is sent from IP 203.0.113.7
    Then the response is 429 with code "rate_limited"
    And an attempt from IP 203.0.113.8 is not rate limited

  Scenario: Sign-up is disabled
    When anyone posts a valid body to /api/auth/sign-up/email
    Then no user row is created and no cookie is set

  Scenario: Guard rejects missing session
    When GET /api/me is called without a cookie
    Then the response is 401 with code "unauthenticated"

  Scenario: Guard rejects a user without a household
    Given a user with a credential but no household membership
    When they sign in and call GET /api/me
    Then the response is 403 with code "forbidden"

  Scenario: Sign-out ends the session
    Given "a1@test" is signed in
    When they sign out
    Then GET /api/me with the old cookie returns 401

  Scenario: Password reset revokes every session
    Given "a1@test" is signed in on two devices
    When the admin runs user:reset-password for "a1@test" and enters a new password twice
    Then both old cookies return 401
    And sign-in with the old password returns 401
    And sign-in with the new password returns 200

  Scenario: CLI rejects a duplicate email
    When the admin runs user:create with the email "A1@Test"
    Then the command exits non-zero and no rows are written
```

## Test Awareness Matrix

| Category | Applicable? | What / why / watch out |
| --- | --- | --- |
| Unit Tests (Backend) | Required | CLI argument parsing (no password option, unknown option), password policy and match checks, email normalization, guard logic with a stubbed session (AC-6, AC-9, AC-11). Inject the prompt function so tests do not need a TTY. |
| Unit Tests (Frontend) | Not Applicable | Backend-only story. |
| API Integration Tests | Required | AC-1 to AC-7, AC-10 through the real app (`useHarness`). Add a guarded test route via `registerRoutes`. Send `X-Forwarded-For` explicitly, because Better Auth skips rate limiting when it cannot resolve an IP. Use a fresh app per test, so the in-memory rate-limit store does not leak between tests. Run CLI commands as functions against the harness DB. |
| E2E / Playwright Tests | Not Applicable | Sign-in UI is a later frontend story. |
| Accessibility (WCAG 2.2 AA) | Not Applicable | No UI. |
| Translations / i18n | Not Applicable | Fixed English error messages per design. |
| Role-Based / Authorization | Required | Member vs user without a household (AC-6); `householdId` is taken from the DB membership only. Cross-household checks start in #6. |
| Security (OWASP) | Required | No user enumeration (AC-2), rate limit (AC-3), cookie flags (AC-1), session revocation (AC-7, AC-10), no password in argv/env/logs (AC-11, AC-12), secret required in production (AC-13), closed auth endpoints (AC-5), origin check still applies to `/api/auth/*` POSTs (cross-site `Origin` → `403`). |

## Implementation watch-outs

1. **Better Auth defaults to override**: the built-in special rule for `/sign-in*` is 3 per 10 s, so it needs `customRules: { '/sign-in/email': { window: 60, max: 5 } }`. `rateLimit.enabled` defaults to production-only. The store is in memory (fine: one process; it resets on restart).
2. **IP source**: the default `X-Forwarded-For` handling takes the first entry. With Nginx `$proxy_add_x_forwarded_for`, a client can spoof it and get around the limit. Configure `advanced.ipAddress.ipAddressHeaders` and make Nginx set the header to `$remote_addr` (Q4).
3. **Rolling refresh**: when `requireSession` calls `auth.api.getSession`, it must forward the refreshed `Set-Cookie` header (`returnHeaders: true`). Otherwise the database expiry rolls but the browser cookie still expires after 30 days.
4. **CLI cannot use `signUpEmail`**, because sign-up is disabled even on the server side. Create the user and the credential `account` row directly (or through `auth.$context` internal adapter + `password.hash`). Use the same hasher so sign-in verifies.
5. **Ids**: design.md says that ids are UUIDs. Better Auth generates its own strings unless `advanced.database.generateId` is set (assumed UUID; see Assumptions).
6. **Error bodies**: wrap the `/api/auth/*` handler so that `401` and `429` come back in the project error format (Q2). Keep Better Auth's `Retry-After` header.
7. **Shared contract**: add `MeResponse` to `@pantry-pal/shared` for the frontend.
8. **Scripts**: add `admin` and `seed` npm scripts. The build must emit `dist/cli.js` (the production command path in design.md).

## Assumptions

- ASSUMPTION-1: Better Auth ids are generated as UUIDs (`crypto.randomUUID`), matching "Ids are text (UUIDs)" in design.md.
- ASSUMPTION-2: The password policy is Better Auth's default (8 to 128 characters). The CLI enforces the same rule.
- ASSUMPTION-3: All sign-in attempts count toward the limit, including successful ones (Better Auth behavior).
- ASSUMPTION-4: Sign-out revokes only the current session; reset revokes all of them.
- ASSUMPTION-5: The `/api/me` response contains only `user { id, name, email }` and `household { id, name }`, with no role.
- ASSUMPTION-6: The seed users are fixed test emails (for example `a1@pantry.local`). Only the password comes from the environment.

## Open questions

- **Q1 (blocking)**: Where do Better Auth's `baseURL`/`trustedOrigins` come from: `BETTER_AUTH_URL` (story) or `PUBLIC_ORIGIN` (design.md, Security)? Recommendation: `baseURL = BETTER_AUTH_URL ?? PUBLIC_ORIGIN` and `trustedOrigins = [PUBLIC_ORIGIN]`, with startup failing if the two differ.
- **Q2**: Should every Better Auth error be rewritten into the project error format (`401 unauthenticated` for bad credentials, `429 rate_limited`), or only `429` as the AC states?
- **Q3**: Which status should a sign-up attempt return: Better Auth's default `400`, or `404`/`403` in project format?
- **Q4**: Is the Nginx `X-Forwarded-For` header controlled by the shared template (`$proxy_add_x_forwarded_for` or `$remote_addr`)? This decides whether the per-IP limit can be spoofed.
- **Q5**: Should the other Better Auth endpoints (`change-password`, `update-user`, `list-sessions`, `revoke-sessions`, `request-password-reset` …) be disabled for the MVP?
- **Q6**: Which role does `user:create` assign: `owner` for the first member and `member` afterwards, or an explicit `--role` option?
- **Q7**: What are the seed environment variable names (one shared `SEED_PASSWORD`, or one per user), and should the CLI support a non-TTY stdin for automation?
