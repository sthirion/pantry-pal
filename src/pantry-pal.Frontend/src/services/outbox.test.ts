import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllStores, db, getMeta, setMeta } from './db';
import {
  backoffDelayMs,
  classifyStatus,
  enqueue,
  pendingTargets,
  peekOldest,
  remapPendingIds,
} from './outbox';

beforeEach(clearAllStores);

describe('backoffDelayMs', () => {
  it.each([
    [0, 1000],
    [1, 2000],
    [2, 4000],
    [5, 32_000],
    [6, 60_000],
    [20, 60_000],
  ])('attempt %i waits %i ms', (attempt, expected) => {
    expect(backoffDelayMs(attempt)).toBe(expected);
  });
});

describe('classifyStatus', () => {
  it.each([
    [500, 'retry'],
    [503, 'retry'],
    [408, 'retry'],
    [429, 'retry'],
    [401, 'auth'],
    [400, 'drop'],
    [403, 'drop'],
    [404, 'drop'],
    [409, 'drop'],
    [302, 'retry'],
  ])('status %i is %s', (status, action) => {
    expect(classifyStatus(status)).toBe(action);
  });
});

describe('outbox queue', () => {
  it('returns entries oldest first', async () => {
    await enqueue({
      id: 'a',
      kind: 'deleteList',
      listId: 'l1',
      changedAt: 't',
    });
    await enqueue({
      id: 'b',
      kind: 'deleteList',
      listId: 'l2',
      changedAt: 't',
    });
    expect((await peekOldest())?.mutation.id).toBe('a');
  });

  it('collects the ids of every queued target', async () => {
    const changedAt = '2026-01-01T00:00:00.000Z';
    await enqueue({
      id: '1',
      kind: 'putList',
      listId: 'l',
      body: { name: 'x', changedAt },
    });
    await enqueue({
      id: '2',
      kind: 'deleteItem',
      listId: 'l',
      itemId: 'i',
      changedAt,
    });
    await enqueue({
      id: '3',
      kind: 'deleteItems',
      listId: 'l',
      body: { itemIds: ['j', 'k'], changedAt },
    });
    expect(await pendingTargets()).toEqual(new Set(['l', 'i', 'j', 'k']));
  });

  it('remaps a merged id in every kind of queued change and leaves others alone', async () => {
    const changedAt = '2026-01-01T00:00:00.000Z';
    await enqueue({
      id: '1',
      kind: 'putItem',
      listId: 'L',
      itemId: 'old',
      body: { name: 'x', crossedOff: true, changedAt },
    });
    await enqueue({
      id: '2',
      kind: 'deleteItems',
      listId: 'L',
      body: { itemIds: ['old', 'other'], changedAt },
    });
    await enqueue({
      id: '3',
      kind: 'putList',
      listId: 'old',
      body: { name: 'y', changedAt },
    });
    await enqueue({
      id: '4',
      kind: 'deleteItem',
      listId: 'L',
      itemId: 'other',
      changedAt,
    });

    await remapPendingIds('old', 'new');

    const all = (await db.outbox.toArray()).map((e) => e.mutation);
    expect(all[0]).toMatchObject({ itemId: 'new', listId: 'L' });
    expect(all[1]).toMatchObject({ body: { itemIds: ['new', 'other'] } });
    expect(all[2]).toMatchObject({ listId: 'new' });
    expect(all[3]).toMatchObject({ itemId: 'other' });
  });
});

describe('meta', () => {
  it('round-trips a value and returns undefined when absent', async () => {
    expect(await getMeta('cursor')).toBeUndefined();
    await setMeta('cursor', 7);
    expect(await getMeta('cursor')).toBe(7);
  });
});
