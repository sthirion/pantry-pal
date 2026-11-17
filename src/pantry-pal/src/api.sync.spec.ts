import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { nameKey } from '@pantry-pal/shared';
import { createHousehold, createUser } from './admin-commands.js';
import { runCli } from './admin-cli.js';
import { ORIGIN, useHarness } from './api.harness.js';
import {
  householdMember,
  itemSuggestion,
  listItem,
  maintenanceState,
  shoppingList,
  syncState,
} from './db/schema.js';
import { MaintenanceService } from './services/maintenance-service.js';

const PASSWORD = 'correct horse';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-13T12:00:00.000Z');

const listId = (n: number) =>
  `0192f0c2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const itemId = (n: number) =>
  `0192f0c3-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

interface SyncBody {
  version: number;
  full: boolean;
  lists: Array<{ id: string; version: number; deletedAt: string | null }>;
  items: Array<{ id: string; version: number; deletedAt: string | null }>;
}

describe('Sync, suggestions and purge API', () => {
  const ctx = useHarness({ now: () => NOW });

  let h1: string;
  let h2: string;
  let cookieA = '';
  let cookieB = '';
  let cookieNoHousehold = '';

  async function signedInCookie(
    email: string,
    householdId: string,
    detach = false,
  ) {
    const userId = await createUser(
      ctx.h.db,
      { email, name: email.split('@')[0], household: householdId },
      () => Promise.resolve(PASSWORD),
    );
    if (detach) {
      ctx.h.db
        .delete(householdMember)
        .where(eq(householdMember.userId, userId))
        .run();
    }
    const res = await ctx.get('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': nextIp(),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  function get(path: string, cookie: string | null = cookieA) {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (cookie) headers.Cookie = cookie;
    return ctx.get(path, { headers });
  }

  const sync = async (since: string, cookie: string | null = cookieA) => {
    const res = await get(`/api/sync?since=${since}`, cookie);
    return { res, body: (await res.json()) as SyncBody };
  };

  function seedList(o: {
    n: number;
    householdId?: string;
    version: number;
    deletedAt?: number | null;
  }) {
    const name = `List ${o.n}`;
    ctx.h.db
      .insert(shoppingList)
      .values({
        id: listId(o.n),
        householdId: o.householdId ?? h1,
        name,
        nameKey: nameKey(name),
        version: o.version,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: o.deletedAt ?? null,
      })
      .run();
  }

  function seedItem(o: {
    n: number;
    list: number;
    householdId?: string;
    version: number;
    deletedAt?: number | null;
  }) {
    const name = `Item ${o.n}`;
    ctx.h.db
      .insert(listItem)
      .values({
        id: itemId(o.n),
        householdId: o.householdId ?? h1,
        listId: listId(o.list),
        name,
        nameKey: nameKey(name),
        crossedOffAt: null,
        version: o.version,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: o.deletedAt ?? null,
      })
      .run();
  }

  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

  beforeEach(async () => {
    h1 = createHousehold(ctx.h.db, { name: 'Household One' });
    h2 = createHousehold(ctx.h.db, { name: 'Household Two' });
    cookieA = await signedInCookie('a@test.com', h1);
    cookieB = await signedInCookie('b@test.com', h2);
    cookieNoHousehold = '';
  });

  describe('GET /api/sync', () => {
    beforeEach(() => {
      // h1: live list v1, deleted list v2, live item v3, deleted item v4; h2: live list v5, item v6
      seedList({ n: 1, version: 1 });
      seedList({ n: 2, version: 2, deletedAt: NOW - DAY });
      seedItem({ n: 1, list: 1, version: 3 });
      seedItem({ n: 2, list: 1, version: 4, deletedAt: NOW - DAY });
      seedList({ n: 10, householdId: h2, version: 5 });
      seedItem({ n: 10, list: 10, householdId: h2, version: 6 });
    });

    it('Sync_WithSinceZero_ReturnsAllLiveAndDeletedRowsAndHighestVersion', async () => {
      // Given
      const since = '0';

      // When
      const { res, body } = await sync(since);

      // Then
      expect(res.status).toBe(200);
      expect(body.full).toBe(false);
      expect(body.version).toBe(4);
      expect(ids(body.lists)).toEqual([listId(1), listId(2)]);
      expect(ids(body.items)).toEqual([itemId(1), itemId(2)]);
      expect(body.items.find((i) => i.id === itemId(2))?.deletedAt).not.toBe(
        null,
      );
    });

    it('Sync_WithoutSince_DefaultsToZero', async () => {
      // Given
      const path = '/api/sync';

      // When
      const res = await get(path);

      // Then
      const body = (await res.json()) as SyncBody;
      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(2);
    });

    it('Sync_WithSinceN_ReturnsOnlyRowsNewerIncludingTombstones', async () => {
      // Given
      const since = '2';

      // When
      const { res, body } = await sync(since);

      // Then
      expect(res.status).toBe(200);
      expect(body.full).toBe(false);
      expect(body.lists).toEqual([]);
      expect(ids(body.items)).toEqual([itemId(1), itemId(2)]);
      expect(body.items.every((i) => i.version > 2)).toBe(true);
      expect(body.items.find((i) => i.id === itemId(2))?.deletedAt).not.toBe(
        null,
      );
    });

    it('Sync_WithSinceAtHighestVersion_ReturnsNoRows', async () => {
      // Given
      const since = '4';

      // When
      const { res, body } = await sync(since);

      // Then
      expect(res.status).toBe(200);
      expect(body.version).toBe(4);
      expect(body.lists).toEqual([]);
      expect(body.items).toEqual([]);
    });

    it('Sync_ForAnotherHousehold_NeverReturnsForeignRows', async () => {
      // Given
      const cookie = cookieB;

      // When
      const { res, body } = await sync('0', cookie);

      // Then
      expect(res.status).toBe(200);
      expect(body.version).toBe(6);
      expect(ids(body.lists)).toEqual([listId(10)]);
      expect(ids(body.items)).toEqual([itemId(10)]);
    });

    it('Sync_WithSinceBelowPurgeHorizon_ReturnsFullSnapshotOfLiveRowsOnly', async () => {
      // Given
      ctx.h.db
        .insert(syncState)
        .values({ householdId: h1, purgedThroughVersion: 3 })
        .run();

      // When
      const { res, body } = await sync('2');

      // Then
      expect(res.status).toBe(200);
      expect(body.full).toBe(true);
      expect(ids(body.lists)).toEqual([listId(1)]);
      expect(ids(body.items)).toEqual([itemId(1)]);
      expect(body.version).toBe(4);
    });

    it('Sync_WithSinceEqualToPurgeHorizon_ReturnsDelta', async () => {
      // Given
      ctx.h.db
        .insert(syncState)
        .values({ householdId: h1, purgedThroughVersion: 3 })
        .run();

      // When
      const { res, body } = await sync('3');

      // Then
      expect(res.status).toBe(200);
      expect(body.full).toBe(false);
      expect(ids(body.items)).toEqual([itemId(2)]);
    });

    it('Sync_PurgeHorizonOfOtherHousehold_DoesNotAffectCaller', async () => {
      // Given
      ctx.h.db
        .insert(syncState)
        .values({ householdId: h2, purgedThroughVersion: 100 })
        .run();

      // When
      const { body } = await sync('0');

      // Then
      expect(body.full).toBe(false);
    });

    it.each(['abc', '-1', '1.5', '', '1e3', '99999999999999999999'])(
      'Sync_WithInvalidSince_%j_Returns400ValidationFailed',
      async (since) => {
        // Given
        const value = encodeURIComponent(since);

        // When
        const res = await get(`/api/sync?since=${value}`);

        // Then
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('validation_failed');
        expect(body.error.message).toBe('Request is invalid.');
        expect(body.error.details).toHaveLength(1);
      },
    );

    it('Sync_WithoutAuthentication_Returns401', async () => {
      // Given
      const cookie = null;

      // When
      const res = await get('/api/sync?since=0', cookie);

      // Then
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('unauthenticated');
    });

    it('Sync_WhenUserHasNoHousehold_Returns403', async () => {
      // Given
      cookieNoHousehold = await signedInCookie('n@test.com', h1, true);

      // When
      const res = await get('/api/sync?since=0', cookieNoHousehold);

      // Then
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    });

    it('Sync_ForHouseholdWithoutData_ReturnsVersionZeroAndEmptyArrays', async () => {
      // Given
      ctx.h.db.delete(listItem).where(eq(listItem.householdId, h2)).run();
      ctx.h.db
        .delete(shoppingList)
        .where(eq(shoppingList.householdId, h2))
        .run();

      // When
      const { res, body } = await sync('0', cookieB);

      // Then
      expect(res.status).toBe(200);
      expect(body).toEqual({ version: 0, full: false, lists: [], items: [] });
    });
  });

  describe('GET /api/suggestions', () => {
    function seedSuggestion(
      householdId: string,
      key: string,
      lastUsedAt: number,
      useCount = 1,
    ) {
      ctx.h.db
        .insert(itemSuggestion)
        .values({ householdId, nameKey: key, name: key, useCount, lastUsedAt })
        .run();
    }

    it('Suggestions_WithHistory_ReturnsMostRecentlyUsedFirst', async () => {
      // Given
      seedSuggestion(h1, 'milk', NOW - 3 * DAY, 4);
      seedSuggestion(h1, 'eggs', NOW - 1 * DAY, 2);
      seedSuggestion(h1, 'bread', NOW - 2 * DAY);

      // When
      const res = await get('/api/suggestions');

      // Then
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        suggestions: [
          {
            name: 'eggs',
            useCount: 2,
            lastUsedAt: new Date(NOW - DAY).toISOString(),
          },
          {
            name: 'bread',
            useCount: 1,
            lastUsedAt: new Date(NOW - 2 * DAY).toISOString(),
          },
          {
            name: 'milk',
            useCount: 4,
            lastUsedAt: new Date(NOW - 3 * DAY).toISOString(),
          },
        ],
      });
    });

    it('Suggestions_WithoutHistory_ReturnsEmptyList', async () => {
      // Given
      const cookie = cookieB;

      // When
      const res = await get('/api/suggestions', cookie);

      // Then
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ suggestions: [] });
    });

    it('Suggestions_WithMoreThan2000Entries_ReturnsNewest2000', async () => {
      // Given
      ctx.h.sqlite.transaction(() => {
        for (let i = 0; i < 2005; i += 1) {
          seedSuggestion(h1, `item-${i.toString().padStart(4, '0')}`, NOW - i);
        }
      })();

      // When
      const res = await get('/api/suggestions');

      // Then
      const { suggestions } = (await res.json()) as {
        suggestions: Array<{ name: string }>;
      };
      expect(res.status).toBe(200);
      expect(suggestions).toHaveLength(2000);
      expect(suggestions[0].name).toBe('item-0000');
      expect(suggestions[1999].name).toBe('item-1999');
    });

    it('Suggestions_FromAnotherHousehold_AreNeverReturned', async () => {
      // Given
      seedSuggestion(h2, 'secret-item', NOW);
      seedSuggestion(h1, 'mine', NOW - DAY);

      // When
      const res = await get('/api/suggestions');

      // Then
      const { suggestions } = (await res.json()) as {
        suggestions: Array<{ name: string }>;
      };
      expect(suggestions.map((s) => s.name)).toEqual(['mine']);
    });

    it('Suggestions_WithoutAuthentication_Returns401', async () => {
      // Given
      const cookie = null;

      // When
      const res = await get('/api/suggestions', cookie);

      // Then
      expect(res.status).toBe(401);
    });

    it('Suggestions_WhenUserHasNoHousehold_Returns403', async () => {
      // Given
      cookieNoHousehold = await signedInCookie('n@test.com', h1, true);

      // When
      const res = await get('/api/suggestions', cookieNoHousehold);

      // Then
      expect(res.status).toBe(403);
    });
  });

  describe('Daily purge', () => {
    // Old (31 days) and recent (29 days) tombstones for h1, plus an old one for h2.
    beforeEach(() => {
      seedList({ n: 1, version: 1 });
      seedItem({ n: 1, list: 1, version: 2, deletedAt: NOW - 31 * DAY });
      seedItem({ n: 2, list: 1, version: 3, deletedAt: NOW - 29 * DAY });
      seedItem({ n: 3, list: 1, version: 4 });
      seedList({ n: 10, householdId: h2, version: 5 });
      seedItem({
        n: 10,
        list: 10,
        householdId: h2,
        version: 6,
        deletedAt: NOW - 40 * DAY,
      });
    });

    const remaining = () =>
      ctx.h.db
        .select({ id: listItem.id })
        .from(listItem)
        .all()
        .map((r) => r.id)
        .sort();

    it('Purge_WithTombstonesOlderAndNewerThan30Days_RemovesOnlyOlderOnesAndSetsHorizon', async () => {
      // Given
      const service = new MaintenanceService(ctx.h.db, () => NOW);

      // When
      const result = service.purgeTombstones();

      // Then
      expect(result).toEqual({ lists: 0, items: 2 });
      expect(remaining()).toEqual([itemId(2), itemId(3)]);
      const horizons = Object.fromEntries(
        ctx.h.db
          .select()
          .from(syncState)
          .all()
          .map((r) => [r.householdId, r.purgedThroughVersion]),
      );
      expect(horizons).toEqual({ [h1]: 2, [h2]: 6 });
      expect(ctx.h.db.select().from(maintenanceState).get()?.lastRunAt).toBe(
        NOW,
      );
    });

    it('Purge_ThenSyncWithOldSince_ReturnsFullSnapshotWithoutPurgedRows', async () => {
      // Given
      new MaintenanceService(ctx.h.db, () => NOW).purgeTombstones();

      // When
      const { res, body } = await sync('1');

      // Then
      expect(res.status).toBe(200);
      expect(body.full).toBe(true);
      expect(ids(body.items)).toEqual([itemId(3)]);
    });

    it('Purge_ThenSyncWithSinceAtHorizon_ReturnsDeltaWithRecentTombstone', async () => {
      // Given
      new MaintenanceService(ctx.h.db, () => NOW).purgeTombstones();

      // When
      const { body } = await sync('2');

      // Then
      expect(body.full).toBe(false);
      expect(ids(body.items)).toEqual([itemId(2), itemId(3)]);
    });

    it('Purge_RunTwice_IsIdempotentAndKeepsHorizon', async () => {
      // Given
      const service = new MaintenanceService(ctx.h.db, () => NOW);
      service.purgeTombstones();

      // When
      const second = service.purgeTombstones();

      // Then
      expect(second).toEqual({ lists: 0, items: 0 });
      expect(
        ctx.h.db
          .select()
          .from(syncState)
          .where(eq(syncState.householdId, h1))
          .get()?.purgedThroughVersion,
      ).toBe(2);
    });

    it('Purge_WhenListDeletedOver30DaysAgoWithNoItems_RemovesList', async () => {
      // Given
      seedList({ n: 20, version: 7, deletedAt: NOW - 31 * DAY });

      // When
      const result = new MaintenanceService(
        ctx.h.db,
        () => NOW,
      ).purgeTombstones();

      // Then
      expect(result.lists).toBe(1);
      expect(
        ctx.h.db
          .select()
          .from(shoppingList)
          .where(eq(shoppingList.id, listId(20)))
          .get(),
      ).toBeUndefined();
    });

    it('Purge_ViaMaintenanceDailyCommand_PurgesAndReportsCounts', async () => {
      // Given
      const out: string[] = [];
      const io = {
        out: (line: string) => out.push(line),
        err: (line: string) => out.push(line),
        prompt: () => Promise.resolve(''),
        isInteractive: false,
      };
      // Seeds are relative to the fixed clock, so move them relative to real time.
      const shift = Date.now() - NOW;
      ctx.h.sqlite
        .prepare(
          'update list_item set deleted_at = deleted_at + ? where deleted_at is not null',
        )
        .run(shift);

      // When
      const code = await runCli(['maintenance:daily'], ctx.h.db, io);

      // Then
      expect(code).toBe(0);
      expect(out).toEqual([
        'Purged 0 lists and 2 items deleted more than 30 days ago.',
      ]);
      expect(remaining()).toEqual([itemId(2), itemId(3)]);
    });

    it('Purge_IsOverdue_WhenNeverRunOrRunMoreThan24HoursAgo', async () => {
      // Given
      const service = new MaintenanceService(ctx.h.db, () => NOW);
      const neverRun = service.isOverdue();
      ctx.h.db
        .insert(maintenanceState)
        .values({ id: 1, lastRunAt: NOW - 25 * 60 * 60 * 1000 })
        .run();

      // When
      const stale = service.isOverdue();
      ctx.h.db
        .update(maintenanceState)
        .set({ lastRunAt: NOW - 1000 })
        .run();
      const fresh = service.isOverdue();

      // Then
      expect([neverRun, stale, fresh]).toEqual([true, true, false]);
    });
  });
});
