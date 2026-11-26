import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ItemMutationResponse,
  ListItem,
  ShoppingList,
  SyncResponse,
} from '@pantry-pal/shared';
import { ApiError } from './apiClient';
import { clearAllStores, db, getMeta, PantryDb, setMeta } from './db';
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
  itemRevision: 1,
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
      if (typeof result === 'function') return result(init);
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
    listeners.changed!({ data: '5' } as MessageEvent<string>);
    await settle();
    expect(request).not.toHaveBeenCalled();
    listeners.changed!({ data: '6' } as MessageEvent<string>);
    await settle();
    expect(request).toHaveBeenCalledWith('/api/sync?since=5');
    engine.stop();
  });

  it('pulls on a bare numeric SSE payload as the server sends it', async () => {
    await setMeta('cursor', 5);
    const { engine, listeners, request } = start(() =>
      snapshot({ version: 5 }),
    );
    await settle();
    request.mockClear();
    listeners.changed!({ data: '42' } as MessageEvent<string>);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/sync?since=5');
    engine.stop();
  });

  it('ignores malformed SSE payloads', async () => {
    await setMeta('cursor', 5);
    const { engine, listeners, request } = start(() =>
      snapshot({ version: 5 }),
    );
    await settle();
    request.mockClear();
    listeners.changed!({ data: 'nope' } as MessageEvent<string>);
    listeners.changed!({ data: '' } as MessageEvent<string>);
    listeners.changed!({ data: '{"version":6}' } as MessageEvent<string>);
    // Number(' 6 ') coerces to 6 (> cursor 5), so only the digits-only guard blocks it.
    listeners.changed!({ data: ' 6 ' } as MessageEvent<string>);
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

describe('item updates', () => {
  const rowOf = (id: string, over: Partial<ListItem> = {}): ListItem => ({
    ...item(id, 'l1'),
    itemRevision: 14,
    ...over,
  });
  const response = (
    mutationId: string,
    row: ListItem,
    over: Partial<ItemMutationResponse> = {},
  ): ItemMutationResponse => ({
    mutationId,
    item: row,
    itemRevision: row.itemRevision,
    version: 40,
    appliedFields: [],
    conflicts: [],
    replayed: false,
    ...over,
  });
  // Answers with the id of the mutation actually sent, as the server does.
  const accepted =
    (row: ListItem, over: Partial<ItemMutationResponse> = {}) =>
    (init?: { body?: unknown }) =>
      response((init?.body as { mutationId: string }).mutationId, row, over);
  const rejected = (code: string, row: ListItem, status = 409): ApiError =>
    new ApiError(status, {
      error: { code, message: 'x' },
      item: row,
      itemRevision: row.itemRevision,
      version: 40,
    });
  const CROSSED_AT = '2026-01-02T00:00:00.000Z';
  // The server's answer to a cross-off applied on top of base revision 14.
  const crossedRow = (id: string, over: Partial<ListItem> = {}) =>
    rowOf(id, { crossedOffAt: CROSSED_AT, itemRevision: 15, ...over });
  const crossOff = (id: string) =>
    saveItem('l1', { name: id, crossedOff: true }, id);
  const rename = (id: string, name: string) =>
    saveItem('l1', { name, crossedOff: true }, id);
  const queued = async () => await db.outbox.toArray();
  const bodies = (request: ReturnType<typeof vi.fn>) =>
    writes(request).map(([, init]) => init.body);

  it('sends the persisted patch with its item, base revision, and mutation id', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const [entry] = await queued();
    const { engine, request } = makeEngine(() =>
      accepted(crossedRow('i1'), { appliedFields: ['crossedOff'] }),
    );
    await engine.flush();
    expect(request).toHaveBeenCalledWith('/api/lists/l1/items/i1', {
      method: 'PUT',
      body: {
        mutationId: entry!.mutation.id,
        baseItemRevision: 14,
        changes: { crossedOff: true },
      },
    });
  });

  it('takes the accepted item and its revision but leaves the household cursor alone', async () => {
    await setMeta('cursor', 3);
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const server = rowOf('i1', {
      crossedOffAt: '2026-01-02T00:00:00.000Z',
      itemRevision: 15,
      version: 40,
    });
    const { engine } = makeEngine(() =>
      accepted(server, { appliedFields: ['crossedOff'] }),
    );
    await engine.flush();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.items.get('i1')).toEqual(server);
    expect(await getMeta('cursor')).toBe(3);
  });

  it('settles a fresh response that applies nothing when the item already holds the attempted value', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const server = rowOf('i1', { crossedOffAt: '2026-01-02T00:00:00.000Z' });
    const { engine, request } = makeEngine(() => accepted(server));
    await engine.flush();
    expect(writes(request)).toHaveLength(1);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.items.get('i1')).toEqual(server);
  });

  it('sends the next edit of an item only after the first is accepted, based on the returned revision', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    await rename('i1', 'Renamed');
    const { engine, request } = makeEngine(() =>
      writes(request).length === 1
        ? accepted(crossedRow('i1'), { appliedFields: ['crossedOff'] })
        : accepted(crossedRow('i1', { name: 'Renamed', itemRevision: 16 }), {
            appliedFields: ['name'],
          }),
    );
    await engine.flush();
    expect(bodies(request)).toMatchObject([
      { baseItemRevision: 14, changes: { crossedOff: true } },
      { baseItemRevision: 15, changes: { name: 'Renamed' } },
    ]);
  });

  it('retries after a failure with the same mutation id and identical payload', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const results = [
      new ApiError(503),
      new TypeError('offline'),
      accepted(crossedRow('i1'), { appliedFields: ['crossedOff'] }),
    ];
    const { engine, request } = makeEngine(() => results.shift());
    await engine.flush();
    const sent = bodies(request);
    expect(sent).toHaveLength(3);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[2]).toEqual(sent[0]);
  });

  it('keeps the same payload across a reload of the queue', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const reopened = new PantryDb();
    const [stored] = await reopened.outbox.toArray();
    reopened.close();
    const { engine, request } = makeEngine(() =>
      accepted(crossedRow('i1'), { appliedFields: ['crossedOff'] }),
    );
    await engine.flush();
    expect(bodies(request)[0]).toEqual({
      mutationId: stored!.mutation.id,
      baseItemRevision: 14,
      changes: { crossedOff: true },
    });
  });

  it('keeps the attempted value of an accepted conflict, shows the server value, and does not retry', async () => {
    await db.items.put(rowOf('i1'));
    await rename('i1', 'Offline name');
    const [entry] = await queued();
    const server = rowOf('i1', {
      name: 'Online name',
      crossedOffAt: '2026-01-02T00:00:00.000Z',
      itemRevision: 16,
    });
    const conflicts: ItemMutationResponse['conflicts'] = [
      {
        field: 'name',
        attemptedValue: 'Offline name',
        serverValue: 'Online name',
      },
    ];
    const { engine, request } = makeEngine(() =>
      accepted(server, { conflicts, appliedFields: ['crossedOff'] }),
    );
    await engine.flush();
    await engine.flush();
    expect(writes(request)).toHaveLength(1);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.items.get('i1'))?.name).toBe('Online name');
    const reopened = new PantryDb();
    const records = await reopened.itemConflicts.toArray();
    reopened.close();
    expect(records).toMatchObject([
      { mutationId: entry!.mutation.id, itemId: 'i1', listId: 'l1', conflicts },
    ]);
  });

  it.each([
    ['BASE_VERSION_EXPIRED'],
    ['BASE_VERSION_AHEAD'],
    ['MUTATION_ID_REUSED'],
  ])(
    'blocks the edit on %s, keeps its whole patch, and refreshes the item',
    async (code) => {
      await db.items.put(rowOf('i1'));
      await crossOff('i1');
      const [entry] = await queued();
      const server = rowOf('i1', { name: 'Server name', itemRevision: 20 });
      const { engine, request, onError } = makeEngine(() =>
        rejected(code, server),
      );
      await engine.flush();
      await engine.flush();
      expect(writes(request)).toHaveLength(1);
      expect(onError).not.toHaveBeenCalled();
      expect(await queued()).toEqual([
        {
          seq: entry!.seq,
          mutation: entry!.mutation,
          blocked: { reason: code, status: 409, serverItemRevision: 20 },
        },
      ]);
      expect(await db.items.get('i1')).toEqual(server);
    },
  );

  it('blocks later edits of the same item but still sends other items', async () => {
    await db.items.put(rowOf('i1'));
    await db.items.put(rowOf('i2'));
    await crossOff('i1');
    await rename('i1', 'Renamed');
    await crossOff('i2');
    const { engine, request } = makeEngine((path) =>
      path.endsWith('/i1')
        ? rejected('BASE_VERSION_EXPIRED', rowOf('i1', { itemRevision: 20 }))
        : accepted(crossedRow('i2'), { appliedFields: ['crossedOff'] }),
    );
    await engine.flush();
    expect(writes(request).map(([path]) => path)).toEqual([
      '/api/lists/l1/items/i1',
      '/api/lists/l1/items/i2',
    ]);
    expect((await queued()).map((e) => e.mutation.kind)).toEqual([
      'updateItem',
      'updateItem',
    ]);
    expect(await db.items.get('i2')).toMatchObject({ itemRevision: 15 });
  });

  it('keeps the patch blocked after another status and refreshes everything with a full pull', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const server = rowOf('i1', { name: 'Server name', itemRevision: 16 });
    const { engine, request, onError } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot({ items: [server] })
        : new ApiError(404),
    );
    await engine.flush();
    expect(request).toHaveBeenCalledWith('/api/sync?since=0');
    expect(onError).not.toHaveBeenCalled();
    expect(await queued()).toMatchObject([
      {
        mutation: { kind: 'updateItem', changes: { crossedOff: true } },
        blocked: { reason: 'rejected', status: 404 },
      },
    ]);
    expect(await db.items.get('i1')).toEqual(server);
  });

  it('keeps the validation details of a 400 with the patch across a reload', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const details = [
      { path: 'changes.name', message: 'Must be 1 to 200 characters.' },
    ];
    const { engine } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot({ items: [rowOf('i1')] })
        : new ApiError(400, {
            error: { code: 'validation_failed', message: 'x', details },
          }),
    );
    await engine.flush();
    const reopened = new PantryDb();
    const stored = await reopened.outbox.toArray();
    reopened.close();
    expect(stored).toMatchObject([
      {
        mutation: { kind: 'updateItem', changes: { crossedOff: true } },
        blocked: { reason: 'rejected', status: 400, details },
      },
    ]);
  });

  it('keeps the patch queued and blocked on 403', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const { engine, onError } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot({ items: [rowOf('i1')] })
        : new ApiError(403),
    );
    await engine.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(await queued()).toMatchObject([
      {
        mutation: { changes: { crossedOff: true } },
        blocked: { reason: 'rejected', status: 403 },
      },
    ]);
  });

  it('lets a pull refresh an item whose edit is blocked', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const { engine } = makeEngine((path) =>
      path.startsWith('/api/sync')
        ? snapshot({
            items: [rowOf('i1', { name: 'Newer', itemRevision: 30 })],
          })
        : rejected('BASE_VERSION_EXPIRED', rowOf('i1', { itemRevision: 20 })),
    );
    await engine.flush();
    await engine.pull();
    expect(await db.items.get('i1')).toMatchObject({
      name: 'Newer',
      itemRevision: 30,
    });
  });

  // Each case turns the one valid answer to the first edit (`crossedOff: true` on base 14) into a bad 2xx body.
  const omit = (key: keyof ItemMutationResponse) => (v: ItemMutationResponse) =>
    Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
  const withItem =
    (over: Partial<ListItem>, top: Partial<ItemMutationResponse> = {}) =>
    (v: ItemMutationResponse) => ({
      ...v,
      ...top,
      item: { ...v.item, ...over },
    });
  const withTop =
    (over: Record<string, unknown>) => (v: ItemMutationResponse) => ({
      ...v,
      ...over,
    });
  // Server value kept for crossedOff: nothing applied, item still uncrossed.
  const conflicted = (conflicts: unknown) =>
    withItem(
      { crossedOffAt: null },
      {
        appliedFields: [],
        conflicts: conflicts as ItemMutationResponse['conflicts'],
      },
    );
  const crossedConflict = {
    field: 'crossedOff',
    attemptedValue: true,
    serverValue: false,
  };
  const invalidBodies: Array<[string, (v: ItemMutationResponse) => unknown]> = [
    ['empty', () => undefined],
    ['non-object', () => 'ok'],
    ['without an item', omit('item')],
    ['without conflicts', omit('conflicts')],
    ['without a mutation id', omit('mutationId')],
    ['without an item revision', omit('itemRevision')],
    ['without a household version', omit('version')],
    ['without applied fields', omit('appliedFields')],
    ['without replayed', omit('replayed')],
    ['another mutation id', withTop({ mutationId: 'someone-else' })],
    ['another item id', withItem({ id: 'i2' })],
    ['another list id', withItem({ listId: 'l2' })],
    ['a deleted item', withItem({ deletedAt: '2026-01-03T00:00:00.000Z' })],
    ['a revision that disagrees with the item', withTop({ itemRevision: 16 })],
    ['a zero revision', withItem({ itemRevision: 0 }, { itemRevision: 0 })],
    [
      'a fractional revision',
      withItem({ itemRevision: 15.5 }, { itemRevision: 15.5 }),
    ],
    [
      'an unsafe revision',
      withItem(
        { itemRevision: Number.MAX_SAFE_INTEGER + 1 },
        { itemRevision: Number.MAX_SAFE_INTEGER + 1 },
      ),
    ],
    [
      'a revision below the submitted base',
      withItem({ itemRevision: 13 }, { itemRevision: 13 }),
    ],
    [
      'applied fields without a revision advance',
      withItem({ itemRevision: 14 }, { itemRevision: 14 }),
    ],
    ['a negative household version', withTop({ version: -1 })],
    ['a fractional household version', withTop({ version: 40.5 })],
    ['a string household version', withTop({ version: '40' })],
    [
      'an unsafe household version',
      withTop({ version: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    ['a version below the item version', withItem({ version: 41 })],
    ['applied fields that are not an array', withTop({ appliedFields: 'x' })],
    ['an unknown applied field', withTop({ appliedFields: ['version'] })],
    [
      'an applied field that was not patched',
      withTop({ appliedFields: ['name'] }),
    ],
    [
      'a duplicated applied field',
      withTop({ appliedFields: ['crossedOff', 'crossedOff'] }),
    ],
    [
      'an applied value the item does not have',
      withItem({ crossedOffAt: null }),
    ],
    ['a non-boolean replayed', withTop({ replayed: 'false' })],
    ['conflicts that are not an array', withTop({ conflicts: {} })],
    ['a null conflict', conflicted([null])],
    [
      'an unknown conflict field',
      conflicted([{ ...crossedConflict, field: 'id' }]),
    ],
    [
      'a conflict with a mistyped attempted value',
      conflicted([{ ...crossedConflict, attemptedValue: 'true' }]),
    ],
    [
      'a conflict with a mistyped server value',
      conflicted([{ ...crossedConflict, serverValue: 'false' }]),
    ],
    [
      'a conflict for a field that was not patched',
      conflicted([{ field: 'name', attemptedValue: 'x', serverValue: 'i1' }]),
    ],
    [
      'a conflict whose attempted value was not submitted',
      conflicted([{ ...crossedConflict, attemptedValue: false }]),
    ],
    [
      'a conflict whose server value is not the item value',
      conflicted([{ ...crossedConflict, serverValue: true }]),
    ],
    ['a duplicated conflict', conflicted([crossedConflict, crossedConflict])],
    [
      'a conflict on an applied field',
      withTop({ conflicts: [{ ...crossedConflict, serverValue: true }] }),
    ],
    [
      'a submitted field that is neither applied nor conflicted and still differs, on an unchanged revision',
      withItem(
        { crossedOffAt: null, itemRevision: 14 },
        { appliedFields: [], conflicts: [], itemRevision: 14 },
      ),
    ],
    [
      'a submitted field that is neither applied nor conflicted and still differs, on an advanced revision',
      withItem({ crossedOffAt: null }, { appliedFields: [], conflicts: [] }),
    ],
  ];

  it.each(invalidBodies)(
    'keeps the edit queued, unchanged, and unsent dependents held on a 2xx with %s, then settles on a valid one',
    async (_name, makeInvalid) => {
      await db.items.put(rowOf('i1'));
      await crossOff('i1');
      await rename('i1', 'Renamed');
      const [first] = await queued();
      const before = await db.items.get('i1');
      const valid = response(
        first!.mutation.id,
        rowOf('i1', {
          crossedOffAt: '2026-01-02T00:00:00.000Z',
          itemRevision: 15,
        }),
        { appliedFields: ['crossedOff'] },
      );
      const invalid = makeInvalid(valid);
      const results: unknown[] = [
        invalid,
        invalid,
        valid,
        accepted(rowOf('i1', { name: 'Renamed', itemRevision: 16 }), {
          appliedFields: ['name'],
        }),
      ];
      let attempts = 0;
      const { engine, request, sleep } = makeEngine(() => results.shift());
      sleep.mockImplementation(async () => {
        attempts += 1;
        // Inspect the queue while the invalid responses are being retried.
        if (attempts <= 2) {
          const entries = await queued();
          expect(entries).toHaveLength(2);
          expect(entries[0]).toEqual({
            seq: first!.seq,
            mutation: first!.mutation,
          });
          expect(entries[1]!.mutation).toMatchObject({
            baseItemRevision: 14,
            changes: { name: 'Renamed' },
          });
          expect(writes(request)).toHaveLength(attempts);
          expect(await db.items.get('i1')).toEqual(before);
          expect(await db.itemConflicts.count()).toBe(0);
        }
      });
      await engine.flush();
      const sent = bodies(request) as Array<{ mutationId: string }>;
      expect(sent).toHaveLength(4);
      expect(sent[1]).toEqual(sent[0]);
      expect(sent[2]).toEqual(sent[0]);
      expect(sent[0]!.mutationId).toBe(first!.mutation.id);
      expect(sent[3]).toMatchObject({
        baseItemRevision: 15,
        changes: { name: 'Renamed' },
      });
      expect(await db.outbox.count()).toBe(0);
    },
  );

  it('keeps an unconfirmed update unblocked and unsettled when the engine stops retrying', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const { engine, onError, sleep } = makeEngine(() => undefined);
    sleep.mockImplementation(async () => engine.stop());
    await engine.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(await queued()).toMatchObject([
      { mutation: { kind: 'updateItem', changes: { crossedOff: true } } },
    ]);
    expect((await queued())[0]!.blocked).toBeUndefined();
    expect(await db.itemConflicts.count()).toBe(0);
    expect(await db.items.get('i1')).toMatchObject({ itemRevision: 14 });
  });

  it('pauses on 401 without blocking the edit', async () => {
    await db.items.put(rowOf('i1'));
    await crossOff('i1');
    const { engine, onAuthRequired } = makeEngine(() => new ApiError(401));
    await engine.flush();
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect((await queued())[0]!.blocked).toBeUndefined();
  });
});
