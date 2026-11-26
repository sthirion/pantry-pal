import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '../auth.js';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import {
  household,
  householdMember,
  itemSuggestion,
  listItem,
  shoppingList,
  user,
} from '../db/schema.js';
import { handleError, notFoundResponse } from '../errors.js';
import { SuggestionService } from '../services/suggestion-service.js';
import { SyncService } from '../services/sync-service.js';
import { registerSyncRoutes } from './sync.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

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

const asH1 = { 'x-user': 'u1' };
const asNoHousehold = { 'x-user': 'u3' };

let db: AppDatabase;
let app: Hono;

const get = (path: string, headers: HeadersInit = asH1) =>
  app.request(path, { headers });

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
  db.insert(shoppingList)
    .values([
      {
        id: 'l1',
        householdId: 'h1',
        name: 'Mine',
        nameKey: 'mine',
        version: 3,
        createdAt: 1,
        updatedAt: 1000,
        deletedAt: null,
      },
      {
        id: 'l2',
        householdId: 'h2',
        name: 'Theirs',
        nameKey: 'theirs',
        version: 4,
        createdAt: 1,
        updatedAt: 1000,
        deletedAt: null,
      },
    ])
    .run();
  db.insert(listItem)
    .values({
      id: 'i1',
      householdId: 'h1',
      listId: 'l1',
      name: 'milk',
      nameKey: 'milk',
      crossedOffAt: null,
      version: 5,
      createdAt: 1,
      updatedAt: 2000,
      deletedAt: 2000,
    })
    .run();
  db.insert(itemSuggestion)
    .values([
      {
        householdId: 'h1',
        nameKey: 'milk',
        name: 'milk',
        useCount: 2,
        lastUsedAt: 3000,
      },
      {
        householdId: 'h2',
        nameKey: 'secret',
        name: 'secret',
        useCount: 1,
        lastUsedAt: 4000,
      },
    ])
    .run();

  app = new Hono();
  app.notFound(notFoundResponse);
  app.onError(handleError);
  registerSyncRoutes(app, {
    auth: fakeAuth,
    db,
    sync: new SyncService(db),
    suggestions: new SuggestionService(db),
  });
});

describe('GET /api/sync', () => {
  it('returns the household snapshot, tombstones included, when since is omitted', async () => {
    const res = await get('/api/sync');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 5,
      full: false,
      lists: [
        {
          id: 'l1',
          name: 'Mine',
          version: 3,
          updatedAt: new Date(1000).toISOString(),
          deletedAt: null,
        },
      ],
      items: [
        {
          id: 'i1',
          listId: 'l1',
          name: 'milk',
          crossedOffAt: null,
          version: 5,
          itemRevision: 1,
          updatedAt: new Date(2000).toISOString(),
          deletedAt: new Date(2000).toISOString(),
        },
      ],
    });
  });

  it('returns only rows newer than since', async () => {
    const res = await get('/api/sync?since=3');
    const body = (await res.json()) as { lists: unknown[]; items: unknown[] };

    expect(res.status).toBe(200);
    expect(body.lists).toEqual([]);
    expect(body.items).toHaveLength(1);
  });

  it.each(['abc', '-1', '1.5', '', '99999999999999999999'])(
    'rejects since=%s with 400 validation_failed',
    async (since) => {
      const res = await get(`/api/sync?since=${since}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; details: { path: string }[] };
      };
      expect(body.error.code).toBe('validation_failed');
      expect(body.error.details.length).toBeGreaterThan(0);
    },
  );

  it('returns 401 without a session', async () => {
    const res = await get('/api/sync', {});

    expect(res.status).toBe(401);
  });

  it('returns 403 for a user without a household', async () => {
    const res = await get('/api/sync', asNoHousehold);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/suggestions', () => {
  it('returns the household suggestions only', async () => {
    const res = await get('/api/suggestions');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [
        {
          name: 'milk',
          useCount: 2,
          lastUsedAt: new Date(3000).toISOString(),
        },
      ],
    });
  });

  it('returns 401 without a session', async () => {
    expect((await get('/api/suggestions', {})).status).toBe(401);
  });

  it('returns 403 for a user without a household', async () => {
    expect((await get('/api/suggestions', asNoHousehold)).status).toBe(403);
  });
});
