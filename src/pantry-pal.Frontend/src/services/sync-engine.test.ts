import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListItem, ShoppingList, SyncResponse } from '@pantry-pal/shared';
import { ApiError } from './apiClient';
import { clearAllStores, db, getMeta, setMeta } from './db';
import { saveItem, saveList } from './mutations';
import { SyncEngine } from './sync-engine';

beforeEach(clearAllStores);

const list = (id: string, name = id, version = 1): ShoppingList => ({
  id,
  name,
  version,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});
const item = (id: string, listId: string, version = 1): ListItem => ({
  id,
  listId,
  name: id,
  crossedOffAt: null,
  version,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});
const snapshot = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  version: 5,
  full: false,
  lists: [],
  items: [],
  ...over,
});

function makeEngine(
  handler: (
    path: string,
    init?: { method?: string; body?: unknown },
  ) => unknown,
) {
  const request = vi.fn(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      const result = handler(path, init);
      if (result instanceof Error) throw result;
      return result;
    },
  );
  const sleep = vi.fn(async () => undefined);
  const onError = vi.fn();
  const onAuthRequired = vi.fn();
  const engine = new SyncEngine({
    request: request as never,
    sleep,
    onError,
    onAuthRequired,
  });
  return { engine, request, sleep, onError, onAuthRequired };
}

const writes = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([p]) => !String(p).startsWith('/api/sync'));

describe('flush', () => {
  it('sends queued changes one at a time in the order they were made', async () => {
    const a = await saveList('A');
    const b = await saveList('B');
    const i = await saveItem(a, { name: 'milk', crossedOff: false });
    let inFlight = 0;
    let maxInFlight = 0;
    const { engine, request } = makeEngine(() => undefined);
    request.mockImplementation(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return undefined;
    });
    await engine.flush();
    expect(request.mock.calls.map(([p]) => p)).toEqual([
      `/api/lists/${a}`,
      `/api/lists/${b}`,
      `/api/lists/${a}/items/${i}`,
    ]);
    expect(maxInFlight).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('uses the right verb, path, and body for every mutation kind', async () => {
    const { removeItem, removeList, clearCrossedOff } = await import(
      './mutations'
    );
    const l = await saveList('L');
    const i = await saveItem(l, { name: 'a', crossedOff: true });
    await removeItem(l, i);
    const j = await saveItem(l, { name: 'b', crossedOff: true });
    await clearCrossedOff(l);
    await removeList(l);
    const { engine, request } = makeEngine(() => undefined);
    await engine.flush();
    const calls = writes(request).map(([p, init]) => [init?.method, p]);
    expect(calls.map(([m]) => m)).toEqual([
      'PUT',
      'PUT',
      'DELETE',
      'PUT',
      'POST',
      'DELETE',
    ]);
    expect(String(calls[2]![1])).toMatch(
      new RegExp(`^/api/lists/${l}/items/${i}\\?changedAt=`),
    );
    expect(calls[4]![1]).toBe(`/api/lists/${l}/items/delete-batch`);
    expect(request.mock.calls[4]![1]).toMatchObject({ body: { itemIds: [j] } });
    expect(String(calls[5]![1])).toMatch(
      new RegExp(`^/api/lists/${l}\\?changedAt=`),
    );
  });

  it('retries a 5xx, 408, 429, and network error with 1 s, 2 s, 4 s backoff, then continues', async () => {
    await saveList('A');
    const failures = [
      new ApiError(503),
      new TypeError('offline'),
      new ApiError(429),
      new ApiError(408),
    ];
    const { engine, request, sleep } = makeEngine(
      () => failures.shift() ?? undefined,
    );
    await engine.flush();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      1000, 2000, 4000, 8000,
    ]);
    expect(request).toHaveBeenCalledTimes(5);
    expect(await db.outbox.count()).toBe(0);
  });

  it('resets the backoff after a success', async () => {
    await saveList('A');
    await saveList('B');
    const results = [
      new ApiError(500),
      undefined,
      new ApiError(500),
      undefined,
    ];
    const { engine, sleep } = makeEngine(() => results.shift());
    await engine.flush();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000]);
  });

  it('keeps a retried entry at the head of the queue so order is preserved', async () => {
    const a = await saveList('A');
    const b = await saveList('B');
    const order: string[] = [];
    let first = true;
    const { engine } = makeEngine((path) => {
      order.push(path);
      if (first) {
        first = false;
        return new ApiError(500);
      }
      return undefined;
    });
    await engine.flush();
    expect(order).toEqual([
      `/api/lists/${a}`,
      `/api/lists/${a}`,
      `/api/lists/${b}`,
    ]);
  });

  it('stops retrying once the engine has been stopped', async () => {
    await saveList('A');
    const { engine, request, sleep } = makeEngine(() => new ApiError(500));
    sleep.mockImplementation(async () => engine.stop());
    await engine.flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('pauses on 401, keeps the entry, and reports that sign-in is needed', async () => {
    await saveList('A');
    await saveList('B');
    const { engine, request, onAuthRequired } = makeEngine(
      () => new ApiError(401),
    );
    await engine.flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(engine.isPaused).toBe(true);
    expect(await db.outbox.count()).toBe(2);
    await engine.flush(); // still paused
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('drops an entry on another 4xx, reports it, and restores state with a full pull', async () => {
    await db.lists.put(list('l1', 'Original'));
    await saveList('Renamed', 'l1'); // optimistic local rename
    const { engine, onError, request } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot({ lists: [list('l1', 'Original')] })
        : new ApiError(409),
    );
    await engine.flush();
    expect(onError).toHaveBeenCalledWith(409);
    expect(await db.outbox.count()).toBe(0);
    expect(request).toHaveBeenCalledWith('/api/sync?since=0');
    expect((await db.lists.get('l1'))?.name).toBe('Original');
  });

  it('runs only one flush at a time', async () => {
    await saveList('A');
    const { engine, request } = makeEngine(() => undefined);
    await Promise.all([engine.flush(), engine.flush()]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('merge remap', () => {
  it('replaces a merged list id locally, in its items, and in queued changes', async () => {
    const mine = await saveList('Groceries');
    const child = await saveItem(mine, { name: 'milk', crossedOff: false });
    const { engine } = makeEngine((path) =>
      path === `/api/lists/${mine}`
        ? {
            list: list('server-id', 'Groceries'),
            applied: true,
            mergedFromId: mine,
          }
        : undefined,
    );
    await engine.flush();
    expect(await db.lists.get(mine)).toBeUndefined();
    expect(await db.lists.get('server-id')).toBeDefined();
    expect((await db.items.get(child))?.listId).toBe('server-id');
  });

  it('sends later queued changes with the returned id', async () => {
    const mine = await saveList('Groceries');
    const child = await saveItem(mine, { name: 'milk', crossedOff: false });
    const { engine, request } = makeEngine((path) =>
      path === `/api/lists/${mine}`
        ? { list: list('server-id'), applied: true, mergedFromId: mine }
        : undefined,
    );
    await engine.flush();
    expect(request.mock.calls[1]![0]).toBe(
      `/api/lists/server-id/items/${child}`,
    );
  });

  it('replaces a merged item id locally and in queued changes', async () => {
    const mine = await saveItem('l', { name: 'milk', crossedOff: false });
    await saveItem('l', { name: 'milk', crossedOff: true }, mine);
    const { engine, request } = makeEngine((path) =>
      path === `/api/lists/l/items/${mine}` && request.mock.calls.length === 1
        ? { item: item('srv', 'l'), applied: true, mergedFromId: mine }
        : undefined,
    );
    await engine.flush();
    expect(request.mock.calls[1]![0]).toBe('/api/lists/l/items/srv');
    expect(await db.items.get(mine)).toBeUndefined();
    // The pending cross-off is kept on the re-keyed row.
    expect((await db.items.get('srv'))?.crossedOffAt).not.toBeNull();
  });

  it('takes the server row from an applied:false response when nothing else is queued', async () => {
    const id = await saveList('Mine', 'l1');
    const { engine } = makeEngine(() => ({
      list: list('l1', 'Newer on server', 9),
      applied: false,
    }));
    await engine.flush();
    expect(await db.lists.get(id)).toMatchObject({
      name: 'Newer on server',
      version: 9,
    });
  });

  it('keeps the optimistic row when a newer change for it is still queued', async () => {
    await saveList('First', 'l1');
    await saveList('Second', 'l1');
    let calls = 0;
    const { engine } = makeEngine(() =>
      ++calls === 2
        ? undefined
        : { list: list('l1', 'First', 3), applied: true },
    );
    await engine.flush();
    expect(calls).toBe(2);
    // The first response must not overwrite the newer, still-queued rename.
    expect((await db.lists.get('l1'))?.name).toBe('Second');
  });
});

describe('pull', () => {
  it('applies a delta from the stored cursor and advances the cursor', async () => {
    await setMeta('cursor', 3);
    await db.lists.put(list('keep'));
    const { engine, request } = makeEngine(() =>
      snapshot({ version: 8, lists: [list('new')], items: [item('i', 'new')] }),
    );
    await engine.pull();
    expect(request).toHaveBeenCalledWith('/api/sync?since=3');
    expect(await db.lists.get('keep')).toBeDefined();
    expect(await db.lists.get('new')).toBeDefined();
    expect(await db.items.get('i')).toBeDefined();
    expect(await getMeta('cursor')).toBe(8);
  });

  it('starts from cursor 0 when none is stored', async () => {
    const { engine, request } = makeEngine(() => snapshot());
    await engine.pull();
    expect(request).toHaveBeenCalledWith('/api/sync?since=0');
  });

  it('never moves the cursor backwards on a delta', async () => {
    await setMeta('cursor', 10);
    const { engine } = makeEngine(() => snapshot({ version: 4 }));
    await engine.pull();
    expect(await getMeta('cursor')).toBe(10);
  });

  it('on full:true replaces lists and items but keeps the outbox', async () => {
    await db.lists.put(list('stale'));
    await db.items.put(item('staleItem', 'stale'));
    const id = await saveList('Pending');
    const { engine } = makeEngine(() =>
      snapshot({ full: true, version: 2, lists: [list('fresh')] }),
    );
    await setMeta('cursor', 50);
    await engine.pull();
    expect(await db.lists.get('stale')).toBeUndefined();
    expect(await db.items.get('staleItem')).toBeUndefined();
    expect(await db.lists.get('fresh')).toBeDefined();
    expect(await db.lists.get(id)).toBeDefined(); // pending local row survives
    expect(await db.outbox.count()).toBe(1);
    expect(await getMeta('cursor')).toBe(2);
  });

  it('does not overwrite a row that has queued local changes', async () => {
    await saveList('Local name', 'l1');
    const { engine } = makeEngine(() =>
      snapshot({ lists: [list('l1', 'Server name')] }),
    );
    await engine.pull();
    expect((await db.lists.get('l1'))?.name).toBe('Local name');
  });

  it('does not overwrite an item that has queued local changes', async () => {
    await saveItem('l1', { name: 'Local', crossedOff: true }, 'i1');
    const { engine } = makeEngine(() =>
      snapshot({ items: [{ ...item('i1', 'l1'), name: 'Server' }] }),
    );
    await engine.pull();
    expect((await db.items.get('i1'))?.name).toBe('Local');
  });

  it('pauses and asks for sign-in on 401', async () => {
    const { engine, onAuthRequired } = makeEngine(() => new ApiError(401));
    await engine.pull();
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(engine.isPaused).toBe(true);
  });

  it('ignores other failures without changing local data', async () => {
    await db.lists.put(list('a'));
    const { engine, onAuthRequired } = makeEngine(
      () => new TypeError('offline'),
    );
    await expect(engine.pull()).resolves.toBeUndefined();
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(await db.lists.count()).toBe(1);
  });

  it('repeats once when a pull is requested during a pull', async () => {
    const { engine, request } = makeEngine(() => snapshot());
    await Promise.all([engine.pull(), engine.pull(), engine.pull()]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('resume after sign-in', () => {
  it('the same user resumes the paused queue', async () => {
    await setMeta('userId', 'u1');
    await saveList('A');
    let status = 401;
    const { engine, request } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot()
        : status === 401
          ? new ApiError(401)
          : undefined,
    );
    await engine.flush();
    expect(engine.isPaused).toBe(true);
    status = 200;
    await engine.resume({ userId: 'u1', householdId: 'h1' });
    expect(engine.isPaused).toBe(false);
    expect(await db.outbox.count()).toBe(0);
    expect(
      request.mock.calls.some(([p]) => String(p).startsWith('/api/sync')),
    ).toBe(true);
    expect(await getMeta('householdId')).toBe('h1');
  });

  it('a different user clears all local data, including the queue', async () => {
    await setMeta('userId', 'u1');
    await db.lists.put(list('old'));
    await saveList('A');
    const { engine, request } = makeEngine(() =>
      snapshot({ lists: [list('theirs')] }),
    );
    await engine.resume({ userId: 'u2', householdId: 'h2' });
    expect(await db.lists.get('old')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.lists.get('theirs')).toBeDefined();
    expect(await getMeta('userId')).toBe('u2');
    expect(writes(request)).toHaveLength(0);
  });

  it('a first sign-in keeps data created before the user was known', async () => {
    await saveList('A');
    const { engine } = makeEngine(() => undefined);
    await engine.resume({ userId: 'u1', householdId: 'h1' });
    expect(await getMeta('userId')).toBe('u1');
    expect(await db.lists.count()).toBe(1);
  });

  it('requests persistent storage', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      storage: { persist },
    });
    const { engine } = makeEngine(() => snapshot());
    await engine.resume({ userId: 'u1', householdId: 'h1' });
    vi.unstubAllGlobals();
    expect(persist).toHaveBeenCalled();
  });
});

describe('triggers', () => {
  function makeSource() {
    const listeners: Record<string, (e: MessageEvent<string>) => void> = {};
    const source = {
      onopen: null as null | (() => void),
      addEventListener: (
        type: string,
        fn: (e: MessageEvent<string>) => void,
      ) => {
        listeners[type] = fn;
      },
      close: vi.fn(),
    };
    return { source, listeners };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  function start(handler = () => snapshot()) {
    const { source, listeners } = makeSource();
    const ctx = makeEngine(handler);
    const engine = new SyncEngine({
      request: ctx.request as never,
      sleep: ctx.sleep,
      createEventSource: () => source as unknown as EventSource,
    });
    engine.start();
    return { engine, source, listeners, request: ctx.request };
  }

  it('pulls on start, online, and focus', async () => {
    const { engine, request } = start();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await settle();
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(request).toHaveBeenCalledTimes(3);
    engine.stop();
  });

  it('flushes queued changes on start', async () => {
    await saveList('A');
    const { engine, request } = start();
    await settle();
    expect(writes(request)).toHaveLength(1);
    engine.stop();
  });

  it('pulls on an SSE changed event with a higher version only', async () => {
    await setMeta('cursor', 5);
    const { engine, listeners, request } = start(() =>
      snapshot({ version: 5 }),
    );
    await settle();
    request.mockClear();
    listeners.changed!({ data: '{"version":5}' } as MessageEvent<string>);
    await settle();
    expect(request).not.toHaveBeenCalled();
    listeners.changed!({ data: '{"version":6}' } as MessageEvent<string>);
    await settle();
    expect(request).toHaveBeenCalledWith('/api/sync?since=5');
    engine.stop();
  });

  it('ignores malformed SSE payloads', async () => {
    const { engine, listeners, request } = start();
    await settle();
    request.mockClear();
    listeners.changed!({ data: 'nope' } as MessageEvent<string>);
    listeners.changed!({ data: '{"version":"x"}' } as MessageEvent<string>);
    await settle();
    expect(request).not.toHaveBeenCalled();
    engine.stop();
  });

  it('pulls when the event stream (re)opens', async () => {
    const { engine, source, request } = start();
    await settle();
    request.mockClear();
    source.onopen!();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('stop closes the stream and removes the window listeners', async () => {
    const { engine, source, request } = start();
    await settle();
    request.mockClear();
    engine.stop();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(source.close).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('start is idempotent', async () => {
    const { engine, request } = start();
    engine.start();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});
