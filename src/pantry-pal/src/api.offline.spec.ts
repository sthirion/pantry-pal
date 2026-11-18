import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nameKey } from '@pantry-pal/shared';
import { ApiError } from '../../pantry-pal.Frontend/src/services/apiClient.js';
import {
  clearAllStores,
  db,
  getMeta,
  setMeta,
} from '../../pantry-pal.Frontend/src/services/db.js';
import {
  removeItem,
  removeList,
  saveItem,
  saveList,
} from '../../pantry-pal.Frontend/src/services/mutations.js';
import {
  enqueue,
  pendingCount,
} from '../../pantry-pal.Frontend/src/services/outbox.js';
import { SyncEngine } from '../../pantry-pal.Frontend/src/services/sync-engine.js';
import { createHousehold, createUser } from './admin-commands.js';
import { ORIGIN, useHarness } from './api.harness.js';
import { listItem, shoppingList } from './db/schema.js';

/**
 * Offline store + outbox + sync engine (story 11) driven against the real API:
 * the frontend's Dexie store (fake-indexeddb) and SyncEngine talk to the booted app over HTTP.
 */
const PASSWORD = 'correct horse';
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const SERVER_LIST_ID = '0192f0c2-0000-7000-8000-000000000001';

let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter += 1) % 250}`;

beforeEach(clearAllStores);

describe('Offline store, outbox and sync engine against the API', () => {
  const ctx = useHarness({ now: () => NOW });
  let householdId: string;
  let userId: string;
  let cookie = '';
  let seq = 0;

  async function signIn(email: string): Promise<string> {
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

  beforeEach(async () => {
    seq += 1;
    householdId = createHousehold(ctx.h.db, { name: `Household ${seq}` });
    const email = `shopper${seq}@example.com`;
    userId = await createUser(
      ctx.h.db,
      { email, name: 'Shopper', household: householdId },
      () => Promise.resolve(PASSWORD),
    );
    cookie = await signIn(email);
  });

  /** Mimics `apiRequest` but targets the booted server and carries the session cookie. */
  function httpRequest(getCookie: () => string | null = () => cookie) {
    return async <T>(
      path: string,
      init: { method?: string; body?: unknown } = {},
    ): Promise<T> => {
      const hasBody = init.body !== undefined;
      const sessionCookie = getCookie();
      const response = await fetch(ctx.h.baseUrl + path, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Origin: ORIGIN,
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(init.body) : undefined,
      });
      if (!response.ok) throw new ApiError(response.status);
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    };
  }

  function makeEngine(
    overrides: {
      request?: ReturnType<typeof httpRequest>;
    } = {},
  ) {
    const sleep = vi.fn(async () => undefined);
    const onError = vi.fn();
    const onAuthRequired = vi.fn();
    const engine = new SyncEngine({
      request: (overrides.request ?? httpRequest()) as never,
      sleep,
      onError,
      onAuthRequired,
      createEventSource: () => null,
    });
    return { engine, sleep, onError, onAuthRequired };
  }

  const serverLists = () => ctx.h.db.select().from(shoppingList).all();
  const serverItems = () => ctx.h.db.select().from(listItem).all();

  describe('Outbox flush', () => {
    it('Flush_WithOfflineCreatedListAndItems_DeliversThemToServerAndEmptiesOutbox', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const itemId = await saveItem(listId, {
        name: 'Milk',
        crossedOff: false,
      });
      expect(await pendingCount()).toBe(2);
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      expect(await pendingCount()).toBe(0);
      expect(serverLists().map((l) => l.id)).toEqual([listId]);
      expect(serverLists()[0].name).toBe('Weekly shop');
      expect(serverItems().map((i) => i.id)).toEqual([itemId]);
      expect(serverItems()[0].householdId).toBe(householdId);
    });

    it('Flush_AfterSuccessfulWrite_StoresServerAuthoritativeVersionLocally', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      const local = await db.lists.get(listId);
      expect(local?.version).toBeGreaterThan(0);
      expect(local?.version).toBe(serverLists()[0].version);
    });

    it('Flush_WithCrossOffAndRename_AppliesChangesInTheOrderTheyWereMade', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const itemId = await saveItem(listId, {
        name: 'Milk',
        crossedOff: false,
      });
      await saveItem(listId, { name: 'Oat milk', crossedOff: false }, itemId);
      await saveItem(listId, { name: 'Oat milk', crossedOff: true }, itemId);
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      const [row] = serverItems();
      expect(row.name).toBe('Oat milk');
      expect(row.crossedOffAt).not.toBeNull();
      expect(await pendingCount()).toBe(0);
    });

    it('Flush_WithDeletedItemAndList_SoftDeletesThemOnServer', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const itemId = await saveItem(listId, {
        name: 'Milk',
        crossedOff: false,
      });
      const other = await saveList('Party');
      await removeItem(listId, itemId);
      await removeList(other);
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      expect(serverItems()[0].deletedAt).not.toBeNull();
      const byId = new Map(serverLists().map((l) => [l.id, l]));
      expect(byId.get(other)?.deletedAt).not.toBeNull();
      expect(byId.get(listId)?.deletedAt).toBeNull();
    });

    it('Flush_WhenSentTwice_IsIdempotentOnServer', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const { engine } = makeEngine();
      await engine.flush();
      const versionAfterFirst = serverLists()[0].version;
      const entry = {
        id: '0192f0c4-0000-7000-8000-000000000001',
        kind: 'putList' as const,
        listId,
        body: {
          name: 'Weekly shop',
          changedAt: (await db.lists.get(listId))!.updatedAt,
        },
      };
      await enqueue(entry);

      // When
      await engine.flush();

      // Then
      expect(serverLists()).toHaveLength(1);
      expect(serverLists()[0].version).toBeGreaterThanOrEqual(
        versionAfterFirst,
      );
      expect(await pendingCount()).toBe(0);
    });
  });

  describe('Failure handling', () => {
    it('Flush_WhenNetworkFailsThenRecovers_RetriesWithBackoffAndKeepsOrder', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      await saveItem(listId, { name: 'Milk', crossedOff: false });
      const real = httpRequest();
      let failures = 3;
      const flaky = (async (...args: Parameters<typeof real>) => {
        if (failures > 0) {
          failures -= 1;
          throw new TypeError('Failed to fetch');
        }
        return real(...args);
      }) as typeof real;
      const { engine, sleep } = makeEngine({ request: flaky });

      // When
      await engine.flush();

      // Then
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
      expect(await pendingCount()).toBe(0);
      expect(serverItems()).toHaveLength(1);
    });

    it('Flush_WithoutSession_PausesKeepsOutboxAndRequestsSignIn', async () => {
      // Given
      await saveList('Weekly shop');
      const { engine, onAuthRequired } = makeEngine({
        request: httpRequest(() => null),
      });

      // When
      await engine.flush();

      // Then
      expect(engine.isPaused).toBe(true);
      expect(onAuthRequired).toHaveBeenCalledTimes(1);
      expect(await pendingCount()).toBe(1);
      expect(serverLists()).toHaveLength(0);
    });

    it('Resume_AfterSignInAsSameUser_DeliversQueuedChanges', async () => {
      // Given
      let sessionCookie: string | null = null;
      await saveList('Weekly shop');
      await setMeta('userId', userId);
      const { engine } = makeEngine({
        request: httpRequest(() => sessionCookie),
      });
      await engine.flush();
      expect(engine.isPaused).toBe(true);
      sessionCookie = cookie;

      // When
      await engine.resume({ userId, householdId });

      // Then
      expect(engine.isPaused).toBe(false);
      expect(await pendingCount()).toBe(0);
      expect(serverLists()).toHaveLength(1);
    });

    it('Flush_WhenServerRejectsChangeWith400_DropsItNotifiesAndContinuesWithNext', async () => {
      // Given
      await enqueue({
        id: '0192f0c4-0000-7000-8000-000000000002',
        kind: 'putList',
        listId: SERVER_LIST_ID,
        body: { name: '', changedAt: new Date(NOW).toISOString() },
      });
      const goodList = await saveList('Weekly shop');
      const { engine, onError } = makeEngine();

      // When
      await engine.flush();

      // Then
      expect(onError).toHaveBeenCalledWith(400);
      expect(await pendingCount()).toBe(0);
      expect(serverLists().map((l) => l.id)).toEqual([goodList]);
    });

    it('Flush_WhenChangeIsDropped_ReplacesLocalRowsWithServerSnapshot', async () => {
      // Given
      const phantom = '0192f0c2-0000-7000-8000-0000000000aa';
      await db.lists.put({
        id: phantom,
        name: 'Never reached server',
        version: 0,
        updatedAt: new Date(NOW).toISOString(),
        deletedAt: null,
      });
      await enqueue({
        id: '0192f0c4-0000-7000-8000-000000000003',
        kind: 'putList',
        listId: SERVER_LIST_ID,
        body: { name: '', changedAt: new Date(NOW).toISOString() },
      });
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      expect(await db.lists.get(phantom)).toBeUndefined();
    });
  });

  describe('Delta and full pulls', () => {
    it('Pull_OnFreshDevice_LoadsServerRowsAndStoresCursor', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const itemId = await saveItem(listId, {
        name: 'Milk',
        crossedOff: false,
      });
      await makeEngine().engine.flush();
      await clearAllStores();
      const { engine } = makeEngine();

      // When
      await engine.pull();

      // Then
      expect((await db.lists.toArray()).map((l) => l.id)).toEqual([listId]);
      expect((await db.items.toArray()).map((i) => i.id)).toEqual([itemId]);
      const highest = Math.max(...serverItems().map((i) => i.version));
      expect(await getMeta<number>('cursor')).toBe(highest);
    });

    it('Pull_WithTombstoneSinceCursor_RemovesTheRowLocallyOnNextDelta', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      const itemId = await saveItem(listId, {
        name: 'Milk',
        crossedOff: false,
      });
      await makeEngine().engine.flush();
      const { engine } = makeEngine();
      await engine.pull();
      const cursorBefore = await getMeta<number>('cursor');
      await clearAllStores();
      await db.lists.bulkPut(serverRows.lists());
      await db.items.bulkPut(serverRows.items());
      await setMeta('cursor', cursorBefore ?? 0);
      ctx.h.sqlite
        .prepare(
          'UPDATE list_item SET deleted_at = ?, version = version + 100 WHERE id = ?',
        )
        .run(NOW, itemId);

      // When
      await engine.pull();

      // Then
      expect((await db.items.get(itemId))?.deletedAt).not.toBeNull();
      expect(await getMeta<number>('cursor')).toBeGreaterThan(
        cursorBefore ?? 0,
      );
    });

    it('Pull_WithQueuedLocalChangeForRow_DoesNotOverwriteIt', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      await makeEngine().engine.flush();
      await saveList('Renamed offline', listId);
      const { engine } = makeEngine();

      // When
      await engine.pull();

      // Then
      expect((await db.lists.get(listId))?.name).toBe('Renamed offline');
      expect(await pendingCount()).toBe(1);
    });

    it('Pull_WithReplace_DiscardsLocalRowsMissingFromServerSnapshot', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      await makeEngine().engine.flush();
      await db.lists.put({
        id: '0192f0c2-0000-7000-8000-0000000000bb',
        name: 'Ghost',
        version: 3,
        updatedAt: new Date(NOW).toISOString(),
        deletedAt: null,
      });
      const { engine } = makeEngine();

      // When
      await engine.pull({ replace: true });

      // Then
      expect((await db.lists.toArray()).map((l) => l.id)).toEqual([listId]);
    });

    it('Pull_WithoutSession_PausesAndRequestsSignIn', async () => {
      // Given
      const { engine, onAuthRequired } = makeEngine({
        request: httpRequest(() => null),
      });

      // When
      await engine.pull();

      // Then
      expect(engine.isPaused).toBe(true);
      expect(onAuthRequired).toHaveBeenCalledTimes(1);
    });

    it('Pull_WhenServerIsUnreachable_LeavesLocalDataAndCursorUntouched', async () => {
      // Given
      const listId = await saveList('Weekly shop');
      await makeEngine().engine.flush();
      await setMeta('cursor', 7);
      const { engine } = makeEngine({
        request: (async () => {
          throw new ApiError(503);
        }) as never,
      });

      // When
      await engine.pull();

      // Then
      expect(await getMeta<number>('cursor')).toBe(7);
      expect(await db.lists.get(listId)).toBeDefined();
      expect(engine.isPaused).toBe(false);
    });
  });

  describe('Id remapping on merge', () => {
    it('Flush_WhenServerMergesListWithSameName_RemapsLocalListItemsAndPendingChanges', async () => {
      // Given
      const name = 'Groceries';
      ctx.h.db
        .insert(shoppingList)
        .values({
          id: SERVER_LIST_ID,
          householdId,
          name,
          nameKey: nameKey(name),
          version: 1,
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        })
        .run();
      const localListId = await saveList(name);
      const itemId = await saveItem(localListId, {
        name: 'Eggs',
        crossedOff: false,
      });
      const { engine } = makeEngine();

      // When
      await engine.flush();

      // Then
      expect(await db.lists.get(localListId)).toBeUndefined();
      expect((await db.lists.get(SERVER_LIST_ID))?.name).toBe(name);
      expect((await db.items.get(itemId))?.listId).toBe(SERVER_LIST_ID);
      expect(await pendingCount()).toBe(0);
      expect(serverLists()).toHaveLength(1);
      const [row] = serverItems();
      expect(row.id).toBe(itemId);
      expect(row.listId).toBe(SERVER_LIST_ID);
    });
  });

  describe('Account switching', () => {
    it('Resume_WithDifferentUser_ClearsPreviousUsersLocalDataAndOutbox', async () => {
      // Given
      await setMeta('userId', 'someone-else');
      await saveList("Someone else's private list");
      const { engine } = makeEngine({ request: httpRequest() });

      // When
      await engine.resume({ userId, householdId });

      // Then
      expect(await getMeta<string>('userId')).toBe(userId);
      expect(await getMeta<string>('householdId')).toBe(householdId);
      expect(serverLists()).toHaveLength(0);
      expect(await db.lists.count()).toBe(0);
    });

    it('Resume_WithSameUser_KeepsAndDeliversQueuedChanges', async () => {
      // Given
      await setMeta('userId', userId);
      const listId = await saveList('Weekly shop');
      const { engine } = makeEngine();

      // When
      await engine.resume({ userId, householdId });

      // Then
      expect(serverLists().map((l) => l.id)).toEqual([listId]);
      expect(await pendingCount()).toBe(0);
    });
  });

  describe('Data isolation', () => {
    it('Pull_AsUserOfAnotherHousehold_NeverReceivesForeignRows', async () => {
      // Given
      await saveList('Weekly shop');
      await makeEngine().engine.flush();
      await clearAllStores();
      const email = `outsider${seq}@example.com`;
      await createUser(
        ctx.h.db,
        {
          email,
          name: 'Outsider',
          household: createHousehold(ctx.h.db, { name: `Other ${seq}` }),
        },
        () => Promise.resolve(PASSWORD),
      );
      const outsiderCookie = await signIn(email);
      const { engine } = makeEngine({
        request: httpRequest(() => outsiderCookie),
      });

      // When
      await engine.pull();

      // Then
      expect(await db.lists.count()).toBe(0);
      expect(await db.items.count()).toBe(0);
    });
  });

  const serverRows = {
    lists: () =>
      serverLists().map((l) => ({
        id: l.id,
        name: l.name,
        version: l.version,
        updatedAt: new Date(l.updatedAt).toISOString(),
        deletedAt: null,
      })),
    items: () =>
      serverItems().map((i) => ({
        id: i.id,
        listId: i.listId,
        name: i.name,
        crossedOffAt: null,
        version: i.version,
        updatedAt: new Date(i.updatedAt).toISOString(),
        deletedAt: null,
      })),
  };
});
