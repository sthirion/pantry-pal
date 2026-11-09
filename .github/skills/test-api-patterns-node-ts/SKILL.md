---
name: test-api-patterns-node-ts
description: "Node.js/TypeScript integration test patterns — naming, structure, Supertest usage, and test data factories. Use when writing Node/TypeScript backend integration tests."
---

# Skill: Integration Test Patterns (Node.js / TypeScript)

Read this skill when writing Node.js / TypeScript integration tests. It covers naming, test structure, Supertest usage, and test-data factory patterns.

## Test Naming Convention

Describe blocks group by endpoint; `it` reads as a sentence: `{scenario} {expectedOutcome}`.

```
describe('GET /{resources}')
  it('with authentication returns 200 with {resources}')
  it('without authentication returns 401')
describe('POST /{resources}')
  it('with valid data creates and returns 201')
  it('with invalid data returns 400 with errors')
describe('PUT /{resources}/:id')
  it('with non-existent id returns 404')
describe('DELETE /{resources}/:id')
  it('with valid id returns 204')
```

## Test Suite Structure

```ts
import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../src/app';
import { a{Resource}Request, validToken } from './helpers';

const app = createApp();

describe('/{resources}', () => {
  describe('GET /{resources}', () => {
    it('with authentication returns 200 with {resources}', async () => {
      const res = await request(app)
        .get('/api/{resources}')
        .set('Authorization', `Bearer ${await validToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('without authentication returns 401', async () => {
      const res = await request(app).get('/api/{resources}');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /{resources}', () => {
    it('with valid data creates and returns 201', async () => {
      const body = a{Resource}Request().build();

      const res = await request(app)
        .post('/api/{resources}')
        .set('Authorization', `Bearer ${await validToken()}`)
        .send(body);

      expect(res.status).toBe(201);
      expect(res.headers.location).toBeDefined();
    });

    it('with invalid data returns 400 with errors', async () => {
      const body = a{Resource}Request().withName('').build(); // required field empty

      const res = await request(app)
        .post('/api/{resources}')
        .set('Authorization', `Bearer ${await validToken()}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('name');
    });
  });
});
```

## Required Test Categories Per Endpoint

For every new API endpoint, cover all of these:

```markdown
[ ] Authenticated request — happy path, returns expected data and status
[ ] Unauthenticated request — returns 401
[ ] Unauthorized role — returns 403
[ ] Invalid input / validation failure — returns 400 with field errors
[ ] Resource not found — returns 404
[ ] Concurrent / conflict scenario (if applicable) — returns 409
```

## Test Data Factories

```ts
// Prefer a factory/builder over inline literals so intent is explicit
export function a{Resource}Request() {
  const state = { name: 'Acme Corp', status: 'active', effectiveDate: '2025-01-01' };
  return {
    withName(name: string) { state.name = name; return this; },
    withStatus(status: string) { state.status = status; return this; },
    build() { return { ...state }; },
  };
}
```

## Mocking a Downstream Service

```ts
// Substitute only the boundary you need; keep the rest of the app real
import { vi } from 'vitest';
import * as repo from '../src/repositories/{resource}Repository';

vi.spyOn(repo, 'find{Resource}ById').mockResolvedValue(null); // force the 404 path
```

## Authentication Helper Pattern

```ts
export async function validToken(): Promise<string> {
  // Obtain a token from the test identity provider / test auth config
  return testTokenProvider.tokenFor('standard-user');
}
```

## Avoid These Patterns

```ts
// ❌ Tests that depend on execution order — keep each `it` independent
// ❌ setTimeout/sleep to wait for async — await the promise or poll a condition
// ❌ Hardcoded connection strings — use env/config or Testcontainers
// ❌ Tests that make real external HTTP calls — stub with nock or a mock
// ❌ Asserting more than one logical concern per test
```
