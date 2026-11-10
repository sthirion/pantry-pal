# Requirements: Story 4 — Shared contracts, API skeleton, and database

**Tracker**: [#4](https://github.com/sthirion/pantry-pal/issues/4) | **Scope**: backend | **Parent**: #2 Feature: Shopping Lists MVP
**Sources**: story AC (context.md), `design.md` (Data Models, Error format, `GET /api/health`, Security), `tasks.md` TASK-003 and TASK-004.
**Predecessor**: #3 (closed; monorepo, tooling, CI). **Successors**: #5 (auth, household guard, `/api/me`), #10 (frontend app shell).
**Revision**: attempt 3 + human edit: logging removed — applies @story decisions on the `user` table (ASSUMPTION-1) and CSRF (ASSUMPTION-5); logging (request and exception logs) is out of scope by human decision.

## Scope Boundaries

- **In scope**: shared package (types, error type, Zod schemas, `nameKey`, `displayName`); Hono server, config (including `PUBLIC_ORIGIN` and `NODE_ENV`), SQLite connection and pragmas, Drizzle schema and migrations at startup — the 7 pantry-pal tables **and the Better Auth `user` table with its core columns** (ASSUMPTION-1) — `GET /api/health`, global error handling, `404` for unknown API routes, CSRF Origin check, security headers, static PWA serving with SPA fallback and cache headers.
- **Out of scope**: structured request and exception logging (human decision). Better Auth wiring, the `session`, `account` and `verification` tables, sessions, `401`/`403` household guard, `/api/me`, admin CLI — story 5. Lists, items, sync, suggestions, SSE endpoints — stories 6 to 9. Frontend code and the PWA build itself — story 10. Purge job — story 8.
- **Actors and preconditions** are stated in each AC. No endpoint in this story requires authentication.

## Level 1: Requirements

| ID | Requirement | Precondition | Actor | Priority | Story AC |
| --- | --- | --- | --- | --- | --- |
| REQ-API-001 | The system shall create the 7 pantry-pal tables and the Better Auth `user` table (core columns), with every key, foreign key and index in design.md, by running drizzle-kit migrations at startup, and expose an unauthenticated health check. | `DB_PATH` points to a missing or empty file | Operator / deploy script | Must | 1 |
| REQ-API-002 | The system shall open SQLite with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`. | API starting | System | Must | (TASK-004) |
| REQ-API-003 | The system shall read `PORT`, `HOST`, `DB_PATH`, `STATIC_DIR`, `PUBLIC_ORIGIN` and `NODE_ENV` from the environment with documented defaults and fail fast on invalid values. | API starting | Operator | Must | 5 (TASK-004) |
| REQ-SHR-001 | The shared package shall export the design.md types, the API error type, request schemas, `nameKey` and `displayName`. | — | API and frontend code | Must | 2, 3 |
| REQ-API-004 | The system shall return every error in the design.md error format and never expose stack traces or internal detail. | Any failing request | HTTP client | Must | 3, 4, 6 |
| REQ-API-005 | The system shall reject every `POST`/`PUT`/`PATCH`/`DELETE` whose `Origin` is not `PUBLIC_ORIGIN` (or, without `Origin`, whose `Sec-Fetch-Site` is `cross-site`), regardless of content type, and set security headers on every response. | Any request | HTTP client | Must | 5, 7 |
| REQ-API-006 | When `STATIC_DIR` is set, the system shall serve the built PWA with SPA fallback and correct cache headers, and never fall back for `/api/*`. | `STATIC_DIR` set | Browser | Must | 6 |
| REQ-API-007 | Removed — logging out of scope by human decision. | — | — | — | — |

## Level 2: Acceptance Criteria

All error bodies below use the design.md error format: `{ "error": { "code": string, "message": string, "details"?: [{ "path": string, "message": string }] } }`. `details` is present only for `validation_failed`. All JSON responses have `Content-Type: application/json`.

### AC-1: Fresh database boot creates the schema and health returns ok

**Actor**: operator or deploy script starting the API, then an anonymous HTTP client. **Precondition**: `DB_PATH` points to a file that does not exist (its parent directory may also not exist).

Given that precondition, when the API starts, then:
- the parent directory and the database file are created;
- exactly these 8 application tables exist (plus drizzle-kit's migrations journal table): `user`, `household`, `household_member`, `shopping_list`, `list_item`, `item_suggestion`, `sync_state`, `change_counter`, with the columns and primary keys in design.md;
- `user` has Better Auth's core columns (ASSUMPTION-1): `id` text PK, `name` text not null, `email` text not null, `email_verified` integer (boolean 0/1) not null default `0`, `image` text null, `created_at` integer not null, `updated_at` integer not null;
- these foreign keys exist: `household_member.household_id` → `household.id`, `household_member.user_id` → `user.id`, `list_item.list_id` → `shopping_list.id`;
- these indexes exist: `user` unique (`email`); `household_member` unique (`user_id`); `shopping_list` unique (`household_id`, `name_key`) `WHERE deleted_at IS NULL` and index (`household_id`, `version`); `list_item` unique (`list_id`, `name_key`) `WHERE deleted_at IS NULL` and index (`household_id`, `version`); `item_suggestion` index (`household_id`, `last_used_at` DESC);
- `change_counter` contains exactly one row `{ id: 1, value: 0 }`; all other application tables are empty;
- `GET /api/health` with no cookies or headers returns `200` and body exactly `{"status":"ok"}`.
- **Negative**: Given a database already migrated and containing a `household` row, when the API restarts, then no migration is re-applied, the row is still present and health returns `200`.
- **Negative**: Given `DB_PATH` points to a location that cannot be created or written (for example a path under an existing regular file), when the API starts, then it fails with an error and exits with a non-zero code without listening on `PORT`.
- **Negative**: Given an insert into `shopping_list` violating the partial unique index (same `household_id`, same `name_key`, both `deleted_at IS NULL`), then SQLite rejects it; with one of the rows soft-deleted, the insert succeeds.
- **Negative**: Given a `household` row and no `user` row with id `u1`, when a `household_member` row with `user_id` `u1` is inserted, then the insert fails with a foreign key constraint error; after inserting `user` `u1`, it succeeds. A second `user` row with the same `email` is rejected.

### AC-2: SQLite connection pragmas

**Actor**: the API process (verified by an integration test). **Precondition**: the API has opened a file database (not `:memory:`) at `DB_PATH`.

Given that precondition, when the connection is queried, then `PRAGMA journal_mode` returns `wal`, `PRAGMA foreign_keys` returns `1`, `PRAGMA busy_timeout` returns `5000`, `PRAGMA synchronous` returns `1` (NORMAL).
- **Negative**: Given `foreign_keys` is on, when a `list_item` row references a `list_id` that does not exist, then the insert fails with a foreign key constraint error.

### AC-3: Server configuration

**Actor**: operator starting the API. **Precondition**: the config module loads before the server listens.

Given no environment variables are set, when config loads, then `PORT` is `3100`, `HOST` is `127.0.0.1`, `DB_PATH` is `<api package root>/data/pantry.db` (resolved independently of the working directory), `STATIC_DIR` is unset (static serving disabled), `PUBLIC_ORIGIN` is `http://localhost:3100`, and production mode is off.
- Given `PORT=4000`, `DB_PATH=/tmp/x.db`, `STATIC_DIR=/tmp/web`, `PUBLIC_ORIGIN=https://pantry.thirion.org`, `NODE_ENV=production` and `HOST` unset or `127.0.0.1`, when config loads, then those values are used, `HOST` is `127.0.0.1`, and production mode is on.
- Given `HOST=0.0.0.0` and `NODE_ENV` unset (non-production), when config loads, then `HOST` is `0.0.0.0` (developer phone testing).
- **Production bind rule** (design.md Security, TASK-004): in production mode the server always binds `127.0.0.1`.
- **Negative**: Given `NODE_ENV=production` and `HOST` set to any value other than `127.0.0.1` (for example `0.0.0.0`, `localhost`, `::`, or the empty string), when config loads, then it throws an error whose message names `HOST` and states that production must bind `127.0.0.1`, and the process exits non-zero without listening (fail fast, not a silent override).
- Given `PUBLIC_ORIGIN=https://pantry.thirion.org/` (trailing slash), then the stored value is the serialized origin `https://pantry.thirion.org`.
- Production mode is on only when `NODE_ENV` is exactly `production`; any other value or unset → off.
- **Negative**: Given `PORT` is `abc`, `0`, or `70000`, when config loads, then it throws an error whose message names `PORT`, and the server process exits non-zero without listening.
- **Negative**: Given `PUBLIC_ORIGIN` is `not a url`, `ftp://pantry.thirion.org`, or `https://pantry.thirion.org/app` (has a path), when config loads, then it throws an error whose message names `PUBLIC_ORIGIN`, and the process exits non-zero without listening.

### AC-4: Shared types and error type

**Actor**: developer (API or frontend code) running the workspace type check. **Precondition**: the shared package `src/pantry-pal.Shared` is built or referenced through workspace TypeScript project references.

Given that precondition, when the API or frontend imports from its entry point, then it exports the TypeScript types `ShoppingList`, `ListItem`, `Suggestion`, `OutboxMutation`, `PutListBody`, `PutItemBody`, `DeleteItemsBody` with the fields and nullability in design.md, plus `ApiErrorCode` (`'validation_failed' | 'unauthenticated' | 'forbidden' | 'not_found' | 'name_taken' | 'rate_limited' | 'internal_error'`) and `ApiError` (the error format above).
- **Negative**: the workspace type check (`tsc --noEmit`) fails if a consumer assigns an unknown code (for example `'bad_request'`) to `ApiErrorCode` or `undefined` to `ShoppingList.deletedAt` (verified by a `// @ts-expect-error` line in a type test).

### AC-5: `nameKey` and `displayName`

**Actor**: API or frontend code calling the shared functions. **Precondition**: none (pure functions; any string input).

Given a name, when `displayName(name)` runs, then it returns the name with leading/trailing whitespace removed and every inner run of whitespace (spaces, tabs, newlines, non-breaking space) replaced by one space; case and accents are unchanged. When `nameKey(name)` runs, then it returns `displayName(name.normalize('NFC')).toLowerCase()`.

| Input | `displayName` | `nameKey` |
| --- | --- | --- |
| `"  Ice   Cream "` | `"Ice Cream"` | `"ice cream"` |
| `"ICE CREAM"` | `"ICE CREAM"` | `"ice cream"` |
| `"Ice\tCream\n"` | `"Ice Cream"` | `"ice cream"` |
| `"Ice\u00A0\u00A0Cream"` | `"Ice Cream"` | `"ice cream"` |
| `"Cafe\u0301"` (decomposed) and `"Café"` (composed) | unchanged form | both `"café"` (NFC, identical strings) |
| `"ÄPFEL"` | `"ÄPFEL"` | `"äpfel"` |
| `"牛奶"` | `"牛奶"` | `"牛奶"` |
| `"   "` | `""` | `""` |
| `""` | `""` | `""` |

- **Negative**: `"Ice Cream"` and `"Ice Creams"` produce different keys; `"Café"` and `"Cafe"` produce different keys (accents are not stripped).

### AC-6: Shared Zod schemas and boundaries

**Actor**: API validation helper or frontend code calling `schema.safeParse`. **Precondition**: input is an arbitrary JSON value (body) or string (path/query).

Given the shared schemas, when they parse input, then:

| Schema | Valid | Invalid (→ parse error naming the field path) |
| --- | --- | --- |
| `PutListBody` `{ name, changedAt }` | `name` 1 and 100 characters after `displayName`; output `name` is the `displayName` form | `name` 0 characters after trim (`""`, `"   "`), 101 characters, missing, non-string |
| `PutItemBody` `{ name, crossedOff, changedAt }` | `name` 1 and 200 characters after `displayName`; `crossedOff` `true`/`false` | `name` 0 or 201 characters; `crossedOff` missing, `"true"`, `1`, `null` |
| `DeleteItemsBody` `{ itemIds, changedAt }` | 1 and 500 UUIDs | `[]`, 501 UUIDs, any non-UUID entry (`itemIds.<index>` in the path) |
| `changedAt` | ISO 8601 with `Z` or offset, e.g. `2026-11-09T18:00:00.000Z`, `2026-11-09T18:00:00+02:00` | `2026-11-09`, `"yesterday"`, `1731175200000`, missing |
| `since` query | `"0"`, `"1532"` (coerced to integer); omitted → `0` | `"-1"`, `"1.5"`, `"abc"` |
| `uuid` (path ids) | any RFC 4122 UUID including v7 | `"abc"`, `""` |

Unknown extra body properties are stripped, not rejected. Lengths are counted in UTF-16 code units (JavaScript `length`).

### AC-7: Validation failures return `400 validation_failed`

**Actor**: anonymous HTTP client. **Precondition**: a route is validated with a shared schema through the API's validation helper (in this story, a test-only route mounted through the app factory, ASSUMPTION-6); the request passes the CSRF check (AC-10).

Given that precondition, when a request body, path or query violates it, then the response is `400` with `error.code` `"validation_failed"`, a non-empty `error.message`, and `error.details` listing one entry per failing field with `path` the dot-joined Zod path (for example `"name"`, `"itemIds.3"`) and a non-empty `message`. Example:

```json
{ "error": { "code": "validation_failed", "message": "Request is invalid.", "details": [{ "path": "name", "message": "Must be 1 to 100 characters." }] } }
```

- **Negative**: Given a body that is not valid JSON, or a JSON route called with `Content-Type: text/plain`, then the response is `400 validation_failed` (not `500`) with one `details` entry whose `path` is `""`.
- Given a valid body, then the handler receives the parsed (trimmed and collapsed) value and no error is returned.

### AC-8: Unexpected errors return `500 internal_error`

**Actor**: anonymous HTTP client. **Precondition**: a route handler (test-only route, ASSUMPTION-6) throws a value that is not an `HTTPException` and not a validation error; the request passes the CSRF check.

Given that precondition, when the request `GET /api/test/throw` is processed and the handler throws `new Error("token=XYZ987")`, then:
- the response is `500` with body exactly `{"error":{"code":"internal_error","message":"An unexpected error occurred."}}`; the body contains no stack frame, error message (`XYZ987`), file path or `details` — in both production and non-production mode.
- Given the thrown value is not an `Error` (for example `throw "boom"`), then the response is the same `500` body and does not contain `boom`.
- **Negative** (`HTTPException` is not turned into a generic `500`): Given a handler throws `new HTTPException(status, { message: "internal detail" })`, then the response uses the status and fixed code/message below and never contains `"internal detail"`:

| `HTTPException` status | Response status | `error.code` | `error.message` |
| --- | --- | --- | --- |
| `400` | `400` | `validation_failed` | `Request is invalid.` (`details`: one entry, `path` `""`) |
| `401` | `401` | `unauthenticated` | `Authentication required.` |
| `403` | `403` | `forbidden` | `Forbidden.` |
| `404` | `404` | `not_found` | `Not found.` |
| `409` | `409` | `name_taken` | `Name is already in use.` |
| `429` | `429` | `rate_limited` | `Too many requests.` |
| `500` | `500` | `internal_error` | `An unexpected error occurred.` |
| any other (for example `418`, `503`) | `500` | `internal_error` | `An unexpected error occurred.` |

Every code in the design.md error-code table (`400`, `401`, `403`, `404`, `409`, `429`, `500`) has exactly one fixed row above.

### AC-9: Unknown API routes return a `404` JSON error

**Actor**: anonymous HTTP client. **Precondition**: any `STATIC_DIR` setting (set or unset).

Given that precondition, when a client requests an unregistered path under `/api/` (for example `GET /api/x`, `GET /api/lists/abc/unknown`), then the response is `404` with body `{"error":{"code":"not_found","message":"Not found."}}` and `Content-Type: application/json`, never `index.html`.
- **Negative**: Given `STATIC_DIR` is unset, when a client requests `GET /lists/abc`, then the response is the same `404` JSON error.

### AC-10: CSRF protection (Origin check on every unsafe method)

**Actor**: a browser (same-origin page or a page on another site) or a non-browser client (test, deploy script, CLI). **Precondition**: config `PUBLIC_ORIGIN` is `https://pantry.thirion.org` (the test sets it; default `http://localhost:3100`, AC-3).

Given that precondition, when a request with method `POST`, `PUT`, `PATCH` or `DELETE` arrives — **regardless of `Content-Type`** (`application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, or none) — then the CSRF check decides as follows:

| `Origin` header | `Sec-Fetch-Site` header | Result |
| --- | --- | --- |
| `https://pantry.thirion.org` (exact match of the serialized origin) | any | passes |
| `https://evil.example` | any | `403` |
| `null` | any | `403` |
| `http://pantry.thirion.org` (scheme differs) | any | `403` |
| `https://pantry.thirion.org:8443` (port differs) | any | `403` |
| `https://sub.pantry.thirion.org` | any | `403` |
| absent | `cross-site` | `403` |
| absent | `same-origin`, `same-site`, `none`, or absent | passes (non-browser clients) |

- `403` body: `{"error":{"code":"forbidden","message":"Forbidden."}}`. The route handler does not run, and the check runs before body parsing, so a cross-origin request with an invalid body gets `403`, not `400`.
- "Passes" means the request reaches routing: a registered test route's handler runs; an unregistered path returns `404 not_found`.
- **Negative**: `GET`, `HEAD` and `OPTIONS` requests are never rejected by CSRF, whatever their `Origin` or `Sec-Fetch-Site` (`GET /api/health` with `Origin: https://evil.example` and `Sec-Fetch-Site: cross-site` returns `200`).
- **Negative**: the API sends no CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `Access-Control-Allow-Methods`) on any response, including `OPTIONS` requests.

### AC-11: Security headers on every response

**Actor**: anonymous HTTP client or browser. **Precondition**: `STATIC_DIR` set to the AC-12 fixture (for the `index.html` and asset rows); any other config.

Given any response — `200` health, `400` validation, `403` CSRF, `404` API, `500` internal error, `index.html`, and a static asset — then it carries:
- `Strict-Transport-Security` with `max-age` ≥ `15552000` and `includeSubDomains`;
- `Content-Security-Policy` containing `default-src 'self'`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy` (Hono default `no-referrer`).
- **Negative**: none of these responses carries an `X-Powered-By` header.

### AC-12: Static PWA serving and caching

**Actor**: browser. **Precondition**: `STATIC_DIR` points to a directory containing `index.html`, `sw.js`, `manifest.webmanifest` and `assets/index-a1b2c3.js`.

Given that precondition, when a browser sends `GET`:

| Path | Status | Body | `Cache-Control` |
| --- | --- | --- | --- |
| `/` | `200` | `index.html` (`text/html`) | `no-cache` |
| `/lists/abc` (no matching file) | `200` | `index.html` (`text/html`) | `no-cache` |
| `/sw.js` | `200` | file | `no-cache` |
| `/manifest.webmanifest` | `200` | file | `no-cache` |
| `/assets/index-a1b2c3.js` | `200` | file (`text/javascript`) | `public, max-age=31536000, immutable` |

- **Negative**: `/assets/missing.js` returns `404` (not `index.html`, never `immutable`).
- **Negative**: `/api/x` returns the AC-9 `404` JSON error, never `index.html`.
- **Negative**: a path traversal attempt (`/../package.json`, `/%2e%2e/%2e%2e/package.json`) never returns a file outside `STATIC_DIR`.
- **Negative**: a non-`GET`/`HEAD` request to a non-API path (same-origin `POST /lists/abc`) returns `404` JSON, not `index.html`.

### AC-13: Removed — logging out of scope by human decision

## Level 3: BDD Acceptance Test Scenarios

```gherkin
Feature: API skeleton and database

  Scenario: Fresh database is migrated at boot and health is ok
    Given DB_PATH points to a file in a new temporary directory that does not exist
    When the API starts
    Then the database file exists
    And the tables user, household, household_member, shopping_list, list_item, item_suggestion, sync_state and change_counter exist
    And household_member has foreign keys to household(id) and user(id), and list_item has a foreign key to shopping_list(id)
    And user has a unique index on email
    And the partial unique indexes on shopping_list and list_item have the clause "WHERE deleted_at IS NULL"
    And change_counter contains exactly one row with id 1 and value 0
    When an anonymous client sends GET /api/health
    Then the response status is 200
    And the response body is {"status":"ok"}

  Scenario: Restart on an existing database keeps the data
    Given a migrated database containing one household row
    When the API restarts
    Then the household row is still present
    And GET /api/health returns 200

  Scenario: Unwritable database path stops the startup
    Given DB_PATH points to a path below an existing regular file
    When the API starts
    Then the process exits with a non-zero code
    And it does not listen on PORT

  Scenario: Partial unique index allows a name reused after soft delete
    Given a shopping_list row with name_key "costco" in household H that is soft-deleted
    When a new shopping_list row with name_key "costco" in household H is inserted
    Then the insert succeeds
    But inserting a third live row with name_key "costco" in household H fails

  Scenario: Connection pragmas are applied
    Given the API opened a file database
    Then PRAGMA journal_mode is "wal"
    And PRAGMA foreign_keys is 1
    And PRAGMA busy_timeout is 5000
    And PRAGMA synchronous is 1

  Scenario: Foreign keys are enforced
    Given an empty migrated database
    When a list_item row with a list_id that does not exist is inserted
    Then the insert fails with a foreign key constraint error

  Scenario: household_member requires an existing user
    Given a migrated database with household "h1" and no user "u1"
    When a household_member row for household "h1" and user "u1" is inserted
    Then the insert fails with a foreign key constraint error
    When user "u1" with email "a@example.com" is inserted and the household_member insert is retried
    Then the insert succeeds
    And inserting a second user with email "a@example.com" fails

  Scenario: Configuration defaults
    Given no PORT, HOST, DB_PATH, STATIC_DIR, PUBLIC_ORIGIN or NODE_ENV environment variables
    When the configuration loads
    Then PORT is 3100 and HOST is "127.0.0.1"
    And DB_PATH ends with "pantry-pal/data/pantry.db"
    And static serving is disabled
    And PUBLIC_ORIGIN is "http://localhost:3100"
    And production mode is off

  Scenario: Configuration overrides
    Given PORT "4000", DB_PATH "/tmp/x.db", STATIC_DIR "/tmp/web", PUBLIC_ORIGIN "https://pantry.thirion.org/" and NODE_ENV "production"
    And HOST is not set
    When the configuration loads
    Then PORT is 4000, HOST is "127.0.0.1", DB_PATH is "/tmp/x.db" and STATIC_DIR is "/tmp/web"
    And PUBLIC_ORIGIN is "https://pantry.thirion.org"
    And production mode is on

  Scenario: Non-production may bind another host
    Given HOST "0.0.0.0" and NODE_ENV is not set
    When the configuration loads
    Then HOST is "0.0.0.0"
    And production mode is off

  Scenario Outline: Production refuses any bind address other than 127.0.0.1
    Given NODE_ENV "production" and HOST "<host>"
    When the server starts
    Then an error naming HOST is thrown
    And the process exits non-zero without listening

    Examples:
      | host      |
      | 0.0.0.0   |
      | localhost |
      | ::        |
      |           |

  Scenario: Production accepts an explicit 127.0.0.1
    Given NODE_ENV "production" and HOST "127.0.0.1"
    When the configuration loads
    Then HOST is "127.0.0.1"

  Scenario Outline: Invalid configuration fails fast
    Given <name> is "<value>"
    When the configuration loads
    Then an error naming <name> is thrown

    Examples:
      | name          | value                          |
      | PORT          | abc                            |
      | PORT          | 0                              |
      | PORT          | 70000                          |
      | PUBLIC_ORIGIN | not a url                      |
      | PUBLIC_ORIGIN | ftp://pantry.thirion.org       |
      | PUBLIC_ORIGIN | https://pantry.thirion.org/app |
```

```gherkin
Feature: Shared contracts

  Scenario Outline: nameKey normalizes names
    When nameKey runs on <input>
    Then it returns <key>

    Examples:
      | input              | key         |
      | "  Ice   Cream "   | "ice cream" |
      | "ICE CREAM"        | "ice cream" |
      | "ÄPFEL"            | "äpfel"     |
      | "牛奶"             | "牛奶"      |
      | "   "              | ""          |

  Scenario: Composed and decomposed accents produce the same key
    When nameKey runs on "Cafe\u0301" and on "Café"
    Then both results are the identical string "café"

  Scenario: Accents are not stripped
    When nameKey runs on "Café" and on "Cafe"
    Then the results differ

  Scenario: displayName trims and collapses but keeps case
    When displayName runs on "  Ice   Cream "
    Then it returns "Ice Cream"

  Scenario Outline: PutListBody name length boundaries
    When PutListBody parses a name of <length> characters with a valid changedAt
    Then the result is <outcome>

    Examples:
      | length | outcome               |
      | 0      | an error on "name"    |
      | 1      | success               |
      | 100    | success               |
      | 101    | an error on "name"    |

  Scenario Outline: PutItemBody name length boundaries
    When PutItemBody parses a name of <length> characters with crossedOff false and a valid changedAt
    Then the result is <outcome>

    Examples:
      | length | outcome               |
      | 0      | an error on "name"    |
      | 1      | success               |
      | 200    | success               |
      | 201    | an error on "name"    |

  Scenario Outline: DeleteItemsBody id count boundaries
    When DeleteItemsBody parses <count> valid UUIDs with a valid changedAt
    Then the result is <outcome>

    Examples:
      | count | outcome                |
      | 0     | an error on "itemIds"  |
      | 1     | success                |
      | 500   | success                |
      | 501   | an error on "itemIds"  |

  Scenario: Whitespace-only name is rejected
    When PutListBody parses the name "   "
    Then the result is an error on "name"

  Scenario Outline: Name type and presence
    When PutListBody parses <body>
    Then the result is an error on "name"

    Examples:
      | body                                              |
      | {"changedAt":"2026-11-09T18:00:00.000Z"}          |
      | {"name":42,"changedAt":"2026-11-09T18:00:00.000Z"} |

  Scenario: Parsed name is the displayName form and extra properties are stripped
    When PutListBody parses {"name":"  Ice   Cream ","changedAt":"2026-11-09T18:00:00.000Z","extra":1}
    Then the result is success with name "Ice Cream"
    And the result has no property "extra"

  Scenario Outline: crossedOff must be a boolean
    When PutItemBody parses name "Milk", changedAt "2026-11-09T18:00:00.000Z" and crossedOff <value>
    Then the result is <outcome>

    Examples:
      | value     | outcome                  |
      | true      | success                  |
      | false     | success                  |
      | "true"    | an error on "crossedOff" |
      | 1         | an error on "crossedOff" |
      | null      | an error on "crossedOff" |
      | (missing) | an error on "crossedOff" |

  Scenario Outline: changedAt format
    When PutItemBody parses name "Milk", crossedOff false and changedAt <value>
    Then the result is <outcome>

    Examples:
      | value                       | outcome                 |
      | "2026-11-09T18:00:00.000Z"  | success                 |
      | "2026-11-09T18:00:00+02:00" | success                 |
      | "2026-11-09"                | an error on "changedAt" |
      | "yesterday"                 | an error on "changedAt" |
      | 1731175200000               | an error on "changedAt" |
      | (missing)                   | an error on "changedAt" |

  Scenario: Non-UUID entry in itemIds names its index
    When DeleteItemsBody parses itemIds with 3 valid UUIDs followed by "abc"
    Then the result is an error on "itemIds.3"

  Scenario Outline: uuid path id
    When the uuid schema parses "<value>"
    Then the result is <outcome>

    Examples:
      | value                                | outcome  |
      | 0190f5a0-7c3e-7b4a-8f2d-1a2b3c4d5e6f | success  |
      | 3f2504e0-4f89-41d3-9a0c-0305e82c3301 | success  |
      | abc                                  | an error |
      |                                      | an error |

  Scenario Outline: since query
    When the since schema parses "<value>"
    Then the result is <outcome>

    Examples:
      | value | outcome  |
      | 0     | 0        |
      | 1532  | 1532     |
      | -1    | an error |
      | 1.5   | an error |
      | abc   | an error |

  Scenario: Omitted since defaults to 0
    When the since schema parses an omitted value
    Then the result is 0

  Scenario: Type check rejects invalid uses of the shared types
    Given a type test file containing "// @ts-expect-error" before assigning "bad_request" to ApiErrorCode
    And "// @ts-expect-error" before assigning undefined to ShoppingList.deletedAt
    When the workspace type check (tsc --noEmit) runs
    Then it succeeds, which proves both assignments are compile errors (an unused "@ts-expect-error" is itself a type error)
```

```gherkin
Feature: API error handling, CSRF and headers

  Background:
    Given the app is built through the app factory with PUBLIC_ORIGIN "https://pantry.thirion.org"
    And test-only routes are mounted: POST /api/test/list validated with PutListBody, GET /api/test/throw, GET /api/test/http/:status, POST /api/test/echo

  Scenario: Invalid body returns validation_failed with details
    When a client sends POST /api/test/list with the body {"name":"","changedAt":"2026-11-09T18:00:00.000Z"}
    Then the response status is 400
    And error.code is "validation_failed"
    And error.details contains an entry with path "name"

  Scenario: Malformed JSON returns validation_failed
    When a client sends POST /api/test/list with the body "{not json" and Content-Type application/json
    Then the response status is 400
    And error.code is "validation_failed"
    And error.details contains one entry with path ""

  Scenario Outline: Unexpected error returns internal_error without detail
    Given NODE_ENV is "<env>"
    When a client sends GET /api/test/throw
    And the handler throws Error("token=XYZ987")
    Then the response status is 500
    And the body is {"error":{"code":"internal_error","message":"An unexpected error occurred."}}
    And the body does not contain "XYZ987" or "    at "

    Examples:
      | env         |
      | production  |
      | development |

  Scenario: A thrown non-Error value returns internal_error
    When a test route throws the string "boom"
    Then the response status is 500 with error.code "internal_error"
    And the body does not contain "boom"

  Scenario Outline: HTTPException keeps its status and gets a fixed error body
    When a client sends GET /api/test/http/<status> whose handler throws HTTPException(<status>, "internal detail")
    Then the response status is <response>
    And error.code is "<code>"
    And the body does not contain "internal detail"

    Examples:
      | status | response | code              |
      | 400    | 400      | validation_failed |
      | 401    | 401      | unauthenticated   |
      | 403    | 403      | forbidden         |
      | 404    | 404      | not_found         |
      | 409    | 409      | name_taken        |
      | 429    | 429      | rate_limited      |
      | 500    | 500      | internal_error    |
      | 418    | 500      | internal_error    |

  Scenario: HTTPException 409 returns the fixed name_taken body
    When a client sends GET /api/test/http/409 whose handler throws HTTPException(409, "internal detail")
    Then the response status is 409
    And the body is exactly {"error":{"code":"name_taken","message":"Name is already in use."}}

  Scenario: Unknown API route returns a 404 JSON error
    When a client sends GET /api/x
    Then the response status is 404
    And the body is {"error":{"code":"not_found","message":"Not found."}}

  Scenario Outline: Unsafe methods are checked against PUBLIC_ORIGIN whatever the content type
    When a client sends <method> /api/test/echo with Content-Type "<contentType>", Origin "<origin>" and Sec-Fetch-Site "<site>"
    Then the response status is <status>

    Examples:
      | method | contentType                       | origin                          | site        | status |
      | POST   | application/json                  | https://evil.example            | cross-site  | 403    |
      | POST   | application/x-www-form-urlencoded | https://evil.example            | cross-site  | 403    |
      | POST   | text/plain                        | https://evil.example            | cross-site  | 403    |
      | PUT    | application/json                  | https://evil.example            | (absent)    | 403    |
      | PATCH  | application/json                  | null                            | (absent)    | 403    |
      | DELETE | (none)                            | http://pantry.thirion.org       | (absent)    | 403    |
      | POST   | application/json                  | https://pantry.thirion.org:8443 | (absent)    | 403    |
      | POST   | application/json                  | https://sub.pantry.thirion.org  | same-site   | 403    |
      | POST   | application/json                  | (absent)                        | cross-site  | 403    |
      | POST   | application/json                  | https://pantry.thirion.org      | same-origin | 200    |
      | POST   | application/json                  | (absent)                        | same-origin | 200    |
      | POST   | application/json                  | (absent)                        | none        | 200    |
      | POST   | application/json                  | (absent)                        | (absent)    | 200    |

  Scenario: Rejected request does not run the handler or validation
    When a client sends POST /api/test/list with the invalid body {"name":""}, Origin "https://evil.example"
    Then the response status is 403
    And the body is {"error":{"code":"forbidden","message":"Forbidden."}}
    And the handler was not called

  Scenario: Same-origin request to an unknown path reaches routing
    When a client sends POST /api/x with Origin "https://pantry.thirion.org"
    Then the response status is 404
    And error.code is "not_found"

  Scenario Outline: Safe methods are never blocked
    When a client sends <method> /api/health with Origin "https://evil.example" and Sec-Fetch-Site "cross-site"
    Then the response status is not 403
    And the response has no Access-Control-Allow-Origin, Access-Control-Allow-Credentials or Access-Control-Allow-Methods header

    Examples:
      | method  |
      | GET     |
      | HEAD    |
      | OPTIONS |

  Scenario Outline: Security headers on every response type
    When a client triggers a "<response>" response via <request>
    Then the response has Strict-Transport-Security with max-age at least 15552000 and includeSubDomains
    And Content-Security-Policy contains "default-src 'self'"
    And X-Content-Type-Options is "nosniff"
    And Referrer-Policy is present
    And there is no X-Powered-By header

    Examples:
      | response     | request                                                       |
      | 200 health   | GET /api/health                                               |
      | 400          | POST /api/test/list with {"name":""}                          |
      | 403          | POST /api/test/echo with Origin https://evil.example          |
      | 404          | GET /api/x                                                    |
      | 500          | GET /api/test/throw                                           |
      | index.html   | GET /lists/abc with STATIC_DIR set                            |
      | asset        | GET /assets/index-a1b2c3.js with STATIC_DIR set               |
```

```gherkin
Feature: Static PWA serving

  Background:
    Given STATIC_DIR contains index.html, sw.js, manifest.webmanifest and assets/index-a1b2c3.js

  Scenario: Client route falls back to index.html without caching
    When a browser sends GET /lists/abc
    Then the response status is 200
    And the body is the content of index.html
    And Cache-Control is "no-cache"

  Scenario: Hashed asset is cached immutably
    When a browser sends GET /assets/index-a1b2c3.js
    Then the response status is 200
    And Cache-Control is "public, max-age=31536000, immutable"

  Scenario: Service worker and manifest are not cached
    When a browser sends GET /sw.js and GET /manifest.webmanifest
    Then both responses have Cache-Control "no-cache"

  Scenario: Missing asset does not fall back
    When a browser sends GET /assets/missing.js
    Then the response status is 404
    And the body is not index.html

  Scenario: API paths never fall back
    When a browser sends GET /api/x
    Then the response status is 404
    And error.code is "not_found"

  Scenario: Path traversal is blocked
    When a browser sends GET /%2e%2e/%2e%2e/package.json
    Then the response body is not the content of any file outside STATIC_DIR
```

## Test Awareness Matrix

| Category | Applicable? | Notes / What to Test |
| --- | --- | --- |
| **Unit Tests (Backend)** | Required | Shared: `nameKey`/`displayName` table (AC-5), every schema boundary 0/1/max/max+1, type and format case (AC-6), type test with `@ts-expect-error` run by `tsc --noEmit` (AC-4). API: config parsing, defaults, overrides, `PUBLIC_ORIGIN` normalization and the production `HOST` rule (AC-3), error handler mapping of `ZodError`/`HTTPException` (every design.md code incl. `409 name_taken`)/`Error`/non-Error (AC-7, AC-8), CSRF decision function over the AC-10 table (AC-10). |
| **Unit Tests (Frontend)** | N/A | No frontend code in this story; the frontend reuses the shared package tests. |
| **API Integration Tests** | Required | Vitest + Supertest against the Hono app: fresh-DB boot and schema/FK/index inspection via `sqlite_master`, `PRAGMA foreign_key_list`, `index_list`/`index_xinfo` (AC-1), `user` FK and email uniqueness (AC-1), restart (AC-1), pragmas on a temp file DB (AC-2), FK enforcement (AC-2), validation `400` and malformed JSON via a test-only route (AC-7), `500` and `HTTPException` mapping via throwing test routes (AC-8), unknown `/api/*` `404` (AC-9), CSRF table (AC-10), headers on each response type (AC-11), static fallback, cache headers, traversal (AC-12). |
| **E2E / Playwright Tests** | N/A | No UI. The PWA serving path is covered end to end once story 10 exists. |
| **Accessibility (WCAG 2.2 AA)** | N/A | No UI. |
| **Translations / i18n** | N/A | Error messages are English API strings, not shown verbatim in the UI (ASSUMPTION-9). Non-ASCII name handling is covered by AC-5. |
| **Role-Based / Authorization** | N/A | No authenticated routes; `GET /api/health` is public by design. `401`/`403` household guard arrives in story 5. |
| **Security (OWASP)** | Required | CSRF Origin check on all unsafe methods (AC-10), security headers incl. no `X-Powered-By` (AC-11), no stack/detail leak (AC-8), input validation (AC-6, AC-7), path traversal (AC-12), default bind `127.0.0.1` and production refusing any other `HOST` (AC-3). Integration level. |
| **Observability** | N/A | Logging out of scope by human decision (AC-13 removed). |

### Required / Recommended details

- **Unit (Backend)** — *What*: the AC-5 table, AC-6 boundaries, config, error mapping. *Why*: AC-3 to AC-8; design.md requires 100% of name normalization branches. *Watch out for*: `\u00A0` and tabs must collapse; build the 100/200/500 boundary strings programmatically; `z.string().datetime({ offset: true })` is needed to accept `+02:00`; `since` arrives as a string (use `z.coerce` but reject `"1.5"` and `""` → check `int()` and `nonnegative()`); the NFC test must compare `"Cafe\u0301"`, not a pre-composed literal.
- **API Integration** — *What*: every BDD scenario in the first, third and fourth features. *Why*: AC-1, AC-2, AC-7 to AC-12. *Watch out for*: `:memory:` databases report `journal_mode` `memory`, so test pragmas and the restart on a temp file; build the app through an app factory (`createApp({ db, config })`) so tests can register test-only routes; Hono's built-in `csrf()` only checks form content types and has no `Sec-Fetch-Site` fallback for absent `Origin`, so AC-10 needs a small custom middleware (or `csrf()` plus an extra check) registered before any body parsing; Hono's default `notFound` and `onError` return plain text — both must be overridden; `serveStatic` from `@hono/node-server/serve-static` resolves `root` relative to the cwd; register `secureHeaders()` first so `403`/`404`/`500` also carry headers; Supertest sends no `Origin` by default (passes CSRF).
- **Security** — *What*: AC-8, AC-10, AC-11, AC-12 negatives. *Why*: design.md Security section; story AC 5. *Watch out for*: CSP `default-src 'self'` must not be relaxed for the API; Hono `secureHeaders()` does not set a CSP by default — configure `contentSecurityPolicy: { defaultSrc: ["'self'"] }`; compare `Origin` to the normalized `PUBLIC_ORIGIN` as an exact string (no prefix/suffix matching, which would let `https://pantry.thirion.org.evil.example` through).

## Assumptions

- ASSUMPTION-1 (decision from @story — `user` table ownership): story 4's Drizzle schema creates the Better Auth `user` table with Better Auth's core user columns (`id` text PK, `name`, `email` unique, `emailVerified` integer boolean, `image` nullable, `createdAt`, `updatedAt`; SQL column names `email_verified`, `created_at`, `updated_at`, timestamps in Unix ms like the rest of the schema) so `household_member.user_id` has its FK to `user.id` from the first migration. Story 5 adds `session`, `account` and `verification` and wires Better Auth against this table; no table rebuild is needed. This deviates from design.md's "generated with the Better Auth CLI" for `user` only; story 5 should confirm the CLI's generated `user` model matches (or is an additive change to) this one.
- ASSUMPTION-2 (gap: initial `change_counter` row): the first migration seeds `change_counter` with `(1, 0)` so versioning in story 6 can `UPDATE ... RETURNING` without an upsert.
- ASSUMPTION-3 (gap: default `DB_PATH` with npm workspaces changing the cwd): the default resolves to `<api package root>/data/pantry.db` regardless of the working directory; the parent directory is created if missing.
- ASSUMPTION-4 (gap: bind address outside production): `HOST` env var, default `127.0.0.1` in every environment. Outside production developers may set `HOST=0.0.0.0` for phone testing. In production (`NODE_ENV=production`) the server always binds `127.0.0.1` (design.md Security, TASK-004): a `HOST` set to anything else fails startup with an error naming `HOST` (chosen over "ignore with a warning" so a misconfigured deploy is caught immediately instead of silently differing from its env file).
- ASSUMPTION-5 (decision from @story — CSRF): an Origin check on every unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`) regardless of content type. The allowed origin is config `PUBLIC_ORIGIN` (default `http://localhost:3100`; production `https://pantry.thirion.org`; story 5 reuses it for Better Auth `trustedOrigins`). `Origin` present and not allowed → `403 forbidden`; `Origin` absent → reject only when `Sec-Fetch-Site` is `cross-site`, otherwise allow (tests, CLI, scripts). Safe methods are never blocked. No CORS headers are sent.
- ASSUMPTION-6 (gap: how AC "reaches an endpoint" is tested when no body endpoint exists yet): the API exposes a reusable validation helper (wrapping `@hono/zod-validator` with a hook that throws the `validation_failed` error); integration tests mount test-only routes through an app factory.
- ASSUMPTION-7 (gap: "hashed assets"): every file under `/assets/` (Vite output) is content-hashed and gets the `immutable` header; everything else that exists gets `no-cache`.
- ASSUMPTION-8 (gap: name length after trim vs collapse): schemas validate and output the `displayName` form; length is JavaScript `length` (UTF-16 code units).
- ASSUMPTION-9 (gap: error message text): messages are fixed English strings (`"Request is invalid."`, `"Authentication required."`, `"Forbidden."`, `"Not found."`, `"Name is already in use."`, `"Too many requests."`, `"An unexpected error occurred."`); clients branch on `code`, not `message`.
- ASSUMPTION-10 (gap: unknown body properties): Zod's default `strip` behavior; extra properties are ignored, not rejected.
- ASSUMPTION-11: Removed — logging out of scope.
- ASSUMPTION-12 (gap: `HTTPException` statuses without an `ApiErrorCode`): every status in the design.md error-code table maps to its code with a fixed message — `400 validation_failed`, `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 name_taken`, `429 rate_limited`, `500 internal_error`. Any other status is treated as unexpected (`500 internal_error`).
- ASSUMPTION-13: Removed — logging out of scope.

## Open Questions

None blocking. Note for story 10: a Vite dev server on another origin (for example `http://localhost:5173`) proxying writes to the API must either set `PUBLIC_ORIGIN` to its own origin or rewrite `Origin` in the proxy, or AC-10 returns `403`.

## Discovered Requirements (out of scope, candidates for later stories)

- Request body size limit (for example `bodyLimit` 64 KB → `413`) — not in design.md; a 500-UUID batch is about 19 KB. Would need a `payload_too_large` code or an ASSUMPTION-12 exception.
- Graceful shutdown on `SIGTERM` (close the server and the SQLite connection) for systemd restarts — fits story 18 (deployment).
- design.md Security still says "Hono `csrf()`" and Data Models says Better Auth generates `user`; update the feature spec to match ASSUMPTION-1 and ASSUMPTION-5, and story 5's description (it no longer creates `user`).

## Story AC Traceability

| Story AC | Refined AC |
| --- | --- |
| 1 Empty `DB_PATH` → tables, indexes, health | AC-1 (plus AC-2 pragmas, AC-3 config from TASK-004) |
| 2 `nameKey` | AC-5 (plus AC-4 types, AC-6 schemas from TASK-003) |
| 3 Schema violation → `400 validation_failed` | AC-7 |
| 4 Unexpected error → `500 internal_error` | AC-8 (plus `HTTPException` mapping) |
| 5 Cross-origin state-changing → `403` | AC-10 (all unsafe methods, any content type; `PUBLIC_ORIGIN` in AC-3) |
| 6 `STATIC_DIR` fallback; unknown `/api/x` → `404` JSON | AC-12, AC-9 |
| 7 Security headers | AC-11 |
| — (TASK-004 structured logs; design.md Security) | None — logging out of scope by human decision (AC-13 removed) |

## Tracker Verdict

**Needed.** Compared with context.md, the refined AC add: the Better Auth `user` table and the `household_member.user_id` FK in story 4 (moved from story 5); config `PUBLIC_ORIGIN` and `NODE_ENV`; production always binding `127.0.0.1` (startup fails on any other `HOST`); the CSRF rule for all unsafe methods with the `Sec-Fetch-Site` fallback; fixed `HTTPException` mapping for every design.md code including `409 name_taken`; and pragmas/config/schemas from TASK-003/004. Logging (TASK-004 structured logs) is explicitly out of scope by human decision and should be noted as such. Suggested: `descriptionAppend` with a "Refined acceptance criteria" section (AC-1 to AC-12 titles and the key rules; AC-13 removed) rather than rewriting the description; story 5's description should also note that `user` already exists.
