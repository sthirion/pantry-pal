import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllStores, db, getMeta, setMeta } from './db';
import {
  backoffDelayMs,
  classifyStatus,
  enqueue,
  hasQueuedCreate,
  nextSendable,
  pendingCount,
  pendingTargets,
  peekOldest,
  rebaseNextUnsentEdit,
  remapPendingIds,
} from './outbox';
import type { UpdateItemMutation } from './outbox.types';

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

  it('keeps the blocked mark and remaps updateItem when an id is merged', async () => {
    await db.outbox.add({
      mutation: edit('1', 'old', { crossedOff: true }),
      blocked: { reason: 'rejected', status: 404 },
    });

    await remapPendingIds('old', 'new');

    expect(await db.outbox.toArray()).toMatchObject([
      {
        mutation: { itemId: 'new' },
        blocked: { reason: 'rejected', status: 404 },
      },
    ]);
  });
});

const edit = (
  id: string,
  itemId: string,
  changes: UpdateItemMutation['changes'],
  baseItemRevision = 14,
): UpdateItemMutation => ({
  id,
  kind: 'updateItem',
  listId: 'l',
  itemId,
  baseItemRevision,
  changes,
});
const block = (seq: number) =>
  db.outbox.update(seq, {
    blocked: { reason: 'BASE_VERSION_EXPIRED', status: 409 },
  });

describe('blocked edits', () => {
  it('skips every queued change of a blocked item but still offers other items', async () => {
    const changedAt = '2026-01-01T00:00:00.000Z';
    await enqueue(edit('1', 'a', { crossedOff: true }));
    await enqueue(edit('2', 'a', { name: 'x' }));
    await enqueue({
      id: '3',
      kind: 'deleteItems',
      listId: 'l',
      body: { itemIds: ['a', 'z'], changedAt },
    });
    await enqueue(edit('4', 'b', { crossedOff: true }));
    await block((await peekOldest())!.seq);

    expect((await nextSendable())?.mutation.id).toBe('4');
  });

  it('offers nothing when every queued change is stopped', async () => {
    await enqueue(edit('1', 'a', { crossedOff: true }));
    await enqueue(edit('2', 'a', { name: 'x' }));
    await block((await peekOldest())!.seq);

    expect(await nextSendable()).toBeUndefined();
  });

  it('does not count stopped changes as waiting or protect their rows from a pull', async () => {
    await enqueue(edit('1', 'a', { crossedOff: true }));
    await enqueue(edit('2', 'a', { name: 'x' }));
    await enqueue(edit('3', 'b', { crossedOff: true }));
    await block((await peekOldest())!.seq);

    expect(await pendingCount()).toBe(1);
    expect(await pendingTargets()).toEqual(new Set(['b']));
  });
});

describe('rebaseNextUnsentEdit', () => {
  it('sets the base of only the next unsent edit of that item', async () => {
    await enqueue(edit('1', 'a', { crossedOff: true }, 14));
    await enqueue(edit('2', 'b', { crossedOff: true }, 14));
    await enqueue(edit('3', 'a', { name: 'x' }, 14));
    await enqueue(edit('4', 'a', { name: 'y' }, 14));
    await db.outbox.delete((await peekOldest())!.seq);

    await rebaseNextUnsentEdit('a', 15);

    expect(
      (await db.outbox.toArray()).map(
        ({ mutation }) => (mutation as UpdateItemMutation).baseItemRevision,
      ),
    ).toEqual([14, 15, 14]);
  });

  it('never changes the mutation id or patch', async () => {
    await enqueue(edit('1', 'a', { name: 'x' }, 14));

    await rebaseNextUnsentEdit('a', 15);

    expect((await peekOldest())?.mutation).toEqual(
      edit('1', 'a', { name: 'x' }, 15),
    );
  });
});

describe('hasQueuedCreate', () => {
  it('is true only while a create of that item is queued', async () => {
    await enqueue({
      id: '1',
      kind: 'putItem',
      listId: 'l',
      itemId: 'a',
      body: { name: 'x', crossedOff: false, changedAt: 't' },
    });
    await enqueue(edit('2', 'b', { name: 'y' }));

    expect(await hasQueuedCreate('a')).toBe(true);
    expect(await hasQueuedCreate('b')).toBe(false);
  });
});

describe('meta', () => {
  it('round-trips a value and returns undefined when absent', async () => {
    expect(await getMeta('cursor')).toBeUndefined();
    await setMeta('cursor', 7);
    expect(await getMeta('cursor')).toBe(7);
  });
});
