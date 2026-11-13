import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Auth } from '../auth.js';
import type { Config } from '../config.js';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import {
  household,
  householdMember,
  listItem,
  shoppingList,
  user,
} from '../db/schema.js';
import { handleError, notFoundResponse } from '../errors.js';
import { originCheck } from '../origin-check.js';
import { HouseholdEventHub } from '../realtime/household-event-hub.js';
import { ListService } from '../services/list-service.js';
import { registerListRoutes } from './lists.js';

const ORIGIN = 'https://pantry.thirion.org';
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const ID_A = '0192f0c2-0000-7000-8000-00000000000a';
const ID_B = '0192f0c2-0000-7000-8000-00000000000b';
const ID_C = '0192f0c2-0000-7000-8000-00000000000c';
const CHANGED = '2026-11-13T11:00:00.000Z';
const NEWER = '2026-11-13T11:30:00.000Z';
const OLDER = '2026-11-13T10:00:00.000Z';

const config: Config = {
  port: 3100,
  host: '127.0.0.1',
  dbPath: ':memory:',
  staticDir: undefined,
  publicOrigin: ORIGIN,
  authSecret: 'test-secret-test-secret-test-secret-1',
  authUrl: ORIGIN,
  isProduction: false,
};

// The fake session is chosen by the x-user header; no header means no session.
const fakeAuth = {
  api: {
    getSession: ({ headers }: { headers: Headers }) => {
      const id = headers.get('x-user');
      return Promise.resolve({
        response: id
          ? { user: { id, name: id, email: `${id}@example.com` } }
          : null,
        headers: new Headers(),
      });
    },
  },
} as unknown as Auth;

let db: AppDatabase;
let app: Hono;
let published: Array<{ householdId: string; version: number }>;

const asH1 = { 'x-user': 'u1', Origin: ORIGIN };
const jsonH1 = { ...asH1, 'Content-Type': 'application/json' };
const jsonH2 = {
  'x-user': 'u2',
  Origin: ORIGIN,
  'Content-Type': 'application/json',
};

function put(id: string, payload: unknown, headers: HeadersInit = jsonH1) {
  return app.request(`/api/lists/${id}`, {
    method: 'PUT',
    headers,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function del(
  id: string,
  changedAt: string | undefined,
  headers: HeadersInit = asH1,
) {
  const query = changedAt === undefined ? '' : `?changedAt=${changedAt}`;
  return app.request(`/api/lists/${id}${query}`, { method: 'DELETE', headers });
}

function row(id: string) {
  return db.select().from(shoppingList).where(eq(shoppingList.id, id)).get();
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  const stamp = new Date(NOW);
  for (const id of ['u1', 'u2', 'u3']) {
    db.insert(user)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .run();
  }
  db.insert(household)
    .values([
      { id: 'h1', name: 'One', createdAt: NOW },
      { id: 'h2', name: 'Two', createdAt: NOW },
    ])
    .run();
  db.insert(householdMember)
    .values([
      { householdId: 'h1', userId: 'u1', role: 'owner', createdAt: NOW },
      { householdId: 'h2', userId: 'u2', role: 'member', createdAt: NOW },
    ])
    .run();

  const hub = new HouseholdEventHub();
  published = [];
  for (const householdId of ['h1', 'h2']) {
    hub.subscribe(householdId, (version) =>
      published.push({ householdId, version }),
    );
  }
  app = new Hono();
  app.use(originCheck(ORIGIN));
  app.notFound(notFoundResponse);
  app.onError(handleError);
  registerListRoutes(app, {
    auth: fakeAuth,
    db,
    lists: new ListService(db, hub, () => NOW),
  });
});

describe('PUT /api/lists/:listId', () => {
  it('creates a list with 201 and the documented body', async () => {
    const res = await put(ID_A, {
      name: '  Rural   King ',
      changedAt: CHANGED,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      list: {
        id: ID_A,
        name: 'Rural King',
        version: 1,
        updatedAt: CHANGED,
        deletedAt: null,
      },
      applied: true,
    });
    expect(row(ID_A)?.householdId).toBe('h1');
    expect(published).toEqual([{ householdId: 'h1', version: 1 }]);
  });

  it('replays the same body with 200, applied false and the same version', async () => {
    await put(ID_A, { name: 'Rural King', changedAt: CHANGED });

    const res = await put(ID_A, { name: 'Rural King', changedAt: CHANGED });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      list: { id: ID_A, version: 1 },
      applied: false,
    });
    expect(published).toHaveLength(1);
  });

  it('renames with a newer changedAt and ignores an older one', async () => {
    await put(ID_A, { name: 'Old', changedAt: CHANGED });

    const applied = await put(ID_A, { name: 'New', changedAt: NEWER });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      list: { name: 'New', version: 2, updatedAt: NEWER },
      applied: true,
    });

    const stale = await put(ID_A, { name: 'Older', changedAt: OLDER });
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      list: { name: 'New', version: 2, updatedAt: NEWER },
      applied: false,
    });
    expect(published).toHaveLength(2);
  });

  it('stores a future changedAt as server time', async () => {
    const res = await put(ID_A, {
      name: 'Milk',
      changedAt: '2027-01-01T00:00:00.000Z',
    });
    expect(
      ((await res.json()) as { list: { updatedAt: string } }).list,
    ).toMatchObject({ updatedAt: '2026-11-13T12:00:00.000Z' });
  });

  it('merges a same-name create into the existing list with mergedFromId', async () => {
    await put(ID_A, { name: 'Market', changedAt: CHANGED });

    const res = await put(ID_B, { name: ' market ', changedAt: NEWER });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      list: { id: string; name: string; version: number };
      applied: boolean;
      mergedFromId: string;
    };
    expect(json.list.id).toBe(ID_A);
    expect(json.list.name).toBe('Market');
    expect(json.list.version).toBe(2);
    expect(json.applied).toBe(true);
    expect(json.mergedFromId).toBe(ID_B);
    expect(row(ID_B)).toBeUndefined();
  });

  it('returns a stale merge as applied false with mergedFromId and no event', async () => {
    await put(ID_A, { name: 'Market', changedAt: NEWER });
    published.length = 0;

    const res = await put(ID_B, { name: 'market', changedAt: OLDER });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      list: { id: ID_A, version: 1 },
      applied: false,
      mergedFromId: ID_B,
    });
    expect(published).toEqual([]);
  });

  it('omits mergedFromId when there is no merge', async () => {
    const res = await put(ID_A, { name: 'Market', changedAt: CHANGED });
    expect(await res.json()).not.toHaveProperty('mergedFromId');
  });

  it('does not merge into another household list', async () => {
    const seed = await put(
      ID_A,
      { name: 'Market', changedAt: CHANGED },
      jsonH2,
    );
    expect(seed.status).toBe(201);

    const res = await put(ID_B, { name: 'market', changedAt: CHANGED });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ list: { id: ID_B } });
  });

  it('returns 409 name_taken for a conflicting rename and changes nothing', async () => {
    await put(ID_A, { name: 'One', changedAt: CHANGED });
    await put(ID_B, { name: 'Two', changedAt: CHANGED });

    const res = await put(ID_B, { name: 'one', changedAt: NEWER });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: 'name_taken', message: 'Name is already in use.' },
    });
    expect(row(ID_B)).toMatchObject({ name: 'Two', version: 2 });
  });

  it('returns 403 forbidden for another household list and does not change it', async () => {
    const seed = await put(
      ID_A,
      { name: 'Theirs', changedAt: CHANGED },
      jsonH2,
    );
    expect(seed.status).toBe(201);

    const res = await put(ID_A, { name: 'Mine', changedAt: NEWER });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Forbidden.' },
    });
    expect(row(ID_A)).toMatchObject({ name: 'Theirs', householdId: 'h2' });
  });

  it('treats name text as data', async () => {
    const name = "'; DROP TABLE shopping_list; --";
    const res = await put(ID_A, { name, changedAt: CHANGED });
    expect(res.status).toBe(201);
    expect(row(ID_A)?.name).toBe(name);
  });

  it('accepts 1- and 100-character names and rejects 101 and blank names', async () => {
    const one = await put(ID_C, { name: 'a', changedAt: CHANGED });
    expect(one.status).toBe(201);
    const ok = await put(ID_A, { name: 'a'.repeat(100), changedAt: CHANGED });
    expect(ok.status).toBe(201);

    for (const name of ['a'.repeat(101), '', '   ']) {
      const res = await put(ID_B, { name, changedAt: CHANGED });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: 'validation_failed',
          message: 'Request is invalid.',
          details: [{ path: 'name', message: 'Must be 1 to 100 characters.' }],
        },
      });
    }
    expect(row(ID_B)).toBeUndefined();
  });

  it('reports a detail for every invalid input and creates nothing', async () => {
    const res = await put('not-a-uuid', { name: '', changedAt: 'yesterday' });

    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(json.error.code).toBe('validation_failed');
    expect(json.error.details.map((d) => d.path).sort()).toEqual([
      'changedAt',
      'listId',
      'name',
    ]);
    expect(db.select().from(shoppingList).all()).toHaveLength(0);
  });

  it('rejects a missing changedAt', async () => {
    const res = await put(ID_A, { name: 'Milk' });
    expect(res.status).toBe(400);
    expect(
      ((await res.json()) as { error: { details: Array<{ path: string }> } })
        .error.details,
    ).toMatchObject([{ path: 'changedAt' }]);
  });

  it('rejects invalid JSON with a root-path detail', async () => {
    const res = await put(ID_A, '{nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Request is invalid.',
        details: [{ path: '', message: 'Body must be valid JSON.' }],
      },
    });
  });

  it('returns 401 without a session', async () => {
    const res = await put(
      ID_A,
      { name: 'Milk', changedAt: CHANGED },
      { Origin: ORIGIN, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication required.' },
    });
  });

  it('returns 403 for a user without a household', async () => {
    const res = await put(
      ID_A,
      { name: 'Milk', changedAt: CHANGED },
      { ...jsonH1, 'x-user': 'u3' },
    );
    expect(res.status).toBe(403);
    expect(row(ID_A)).toBeUndefined();
  });

  it('rejects a foreign Origin with 403 before validating and creates nothing', async () => {
    const res = await put(ID_A, '{nope', {
      ...jsonH1,
      Origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Forbidden.' },
    });
  });

  it('rejects an absent Origin with Sec-Fetch-Site cross-site', async () => {
    const res = await put(
      ID_A,
      { name: 'Milk', changedAt: CHANGED },
      {
        'x-user': 'u1',
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
      },
    );
    expect(res.status).toBe(403);
    expect(row(ID_A)).toBeUndefined();
  });

  it('accepts an absent Origin without Sec-Fetch-Site', async () => {
    const res = await put(
      ID_A,
      { name: 'Milk', changedAt: CHANGED },
      { 'x-user': 'u1', 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/lists/:listId', () => {
  beforeEach(async () => {
    await put(ID_A, { name: 'Market', changedAt: CHANGED });
    db.insert(listItem)
      .values({
        id: 'item-1',
        householdId: 'h1',
        listId: ID_A,
        name: 'milk',
        nameKey: 'milk',
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    published.length = 0;
  });

  it('soft-deletes the list and its items with 204 and an empty body', async () => {
    const res = await del(ID_A, NEWER);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(row(ID_A)?.deletedAt).toBe(Date.parse(NEWER));
    expect(
      db.select().from(listItem).where(eq(listItem.id, 'item-1')).get()
        ?.deletedAt,
    ).toBe(Date.parse(NEWER));
    expect(published).toEqual([{ householdId: 'h1', version: 2 }]);
  });

  it('returns 204 again on repeat without another event', async () => {
    await del(ID_A, NEWER);
    published.length = 0;

    const res = await del(ID_A, NEWER);

    expect(res.status).toBe(204);
    expect(published).toEqual([]);
  });

  it('returns 204 for a valid id that exists nowhere', async () => {
    const res = await del(ID_C, NEWER);
    expect(res.status).toBe(204);
    expect(published).toEqual([]);
  });

  it('returns 403 for another household list and leaves it alone', async () => {
    const res = await del(ID_A, NEWER, { 'x-user': 'u2', Origin: ORIGIN });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Forbidden.' },
    });
    expect(row(ID_A)?.deletedAt).toBeNull();
    expect(published).toEqual([]);
  });

  it('returns 200 with applied false for an older delete', async () => {
    const res = await del(ID_A, OLDER);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      list: {
        id: ID_A,
        name: 'Market',
        version: 1,
        updatedAt: CHANGED,
        deletedAt: null,
      },
      applied: false,
    });
    expect(row(ID_A)?.deletedAt).toBeNull();
  });

  it('rejects a malformed UUID with a listId detail and changes nothing', async () => {
    const res = await del('not-a-uuid', NEWER);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'listId' }] },
    });
    expect(row(ID_A)?.deletedAt).toBeNull();
  });

  it.each([undefined, 'yesterday', ''])(
    'rejects changedAt %j with a changedAt detail and changes nothing',
    async (changedAt) => {
      const res = await del(ID_A, changedAt);

      expect(res.status).toBe(400);
      expect(
        (
          (await res.json()) as {
            error: { details: Array<{ path: string }> };
          }
        ).error.details.map((d) => d.path),
      ).toEqual(['changedAt']);
      expect(row(ID_A)?.deletedAt).toBeNull();
    },
  );

  it('reports both details when listId and changedAt are invalid', async () => {
    const res = await del('nope', undefined);
    expect(
      (
        (await res.json()) as { error: { details: Array<{ path: string }> } }
      ).error.details.map((d) => d.path),
    ).toEqual(['listId', 'changedAt']);
  });

  it('returns 401 without a session', async () => {
    const res = await del(ID_A, NEWER, { Origin: ORIGIN });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication required.' },
    });
    expect(row(ID_A)?.deletedAt).toBeNull();
  });

  it('returns 403 for a user without a household', async () => {
    const res = await del(ID_A, NEWER, { 'x-user': 'u3', Origin: ORIGIN });
    expect(res.status).toBe(403);
    expect(row(ID_A)?.deletedAt).toBeNull();
  });

  it('rejects a foreign Origin with 403 and does not delete', async () => {
    const res = await del(ID_A, NEWER, {
      'x-user': 'u1',
      Origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(row(ID_A)?.deletedAt).toBeNull();
  });

  it('rejects an absent Origin with Sec-Fetch-Site cross-site', async () => {
    const res = await del(ID_A, NEWER, {
      'x-user': 'u1',
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
    expect(row(ID_A)?.deletedAt).toBeNull();
  });
});

describe('list routes in createApp', () => {
  it('are mounted behind authentication when a database is provided', async () => {
    const real = createApp({ config, db });

    const res = await real.request(`/api/lists/${ID_A}`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Milk', changedAt: CHANGED }),
    });

    expect(res.status).toBe(401);
  });

  it('are not mounted without a database', async () => {
    const res = await createApp({ config }).request(`/api/lists/${ID_A}`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Milk', changedAt: CHANGED }),
    });
    expect(res.status).toBe(404);
  });
});
