import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListItem } from '@pantry-pal/shared';
import { clearAllStores, db, PantryDb } from './db';
import {
  clearCrossedOff,
  removeItem,
  removeList,
  saveItem,
  saveList,
} from './mutations';

beforeEach(clearAllStores);

const queue = async () => (await db.outbox.toArray()).map((e) => e.mutation);

describe('mutations', () => {
  it('saveList writes the row and the outbox entry together', async () => {
    const id = await saveList('Rural King');
    expect(await db.lists.get(id)).toMatchObject({
      name: 'Rural King',
      deletedAt: null,
    });
    expect(await queue()).toMatchObject([
      { kind: 'putList', listId: id, body: { name: 'Rural King' } },
    ]);
  });

  it('saveList keeps the server version when renaming', async () => {
    await db.lists.put({
      id: 'l',
      name: 'A',
      version: 9,
      updatedAt: 't',
      deletedAt: null,
    });
    await saveList('B', 'l');
    expect((await db.lists.get('l'))?.version).toBe(9);
  });

  it('writes nothing to the store when the outbox write fails', async () => {
    const spy = vi
      .spyOn(db.outbox, 'add')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(saveList('X', 'l')).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await db.lists.get('l')).toBeUndefined();
  });

  it('removeList soft-deletes the list and its items only', async () => {
    const list = await saveList('L');
    const item = await saveItem(list, { name: 'milk', crossedOff: false });
    const otherItem = await saveItem('other', {
      name: 'eggs',
      crossedOff: false,
    });
    await removeList(list);
    expect((await db.lists.get(list))?.deletedAt).not.toBeNull();
    expect((await db.items.get(item))?.deletedAt).not.toBeNull();
    expect((await db.items.get(otherItem))?.deletedAt).toBeNull();
    expect((await queue()).at(-1)).toMatchObject({
      kind: 'deleteList',
      listId: list,
    });
  });

  it('saveItem sets and clears crossedOffAt, keeping the first cross-off time', async () => {
    const id = await saveItem('l', { name: 'milk', crossedOff: true });
    const first = (await db.items.get(id))?.crossedOffAt;
    expect(first).toEqual(expect.any(String));
    await saveItem('l', { name: 'milk', crossedOff: true }, id);
    expect((await db.items.get(id))?.crossedOffAt).toBe(first);
    await saveItem('l', { name: 'milk', crossedOff: false }, id);
    expect((await db.items.get(id))?.crossedOffAt).toBeNull();
  });

  it('removeItem soft-deletes and queues a delete', async () => {
    const id = await saveItem('l', { name: 'milk', crossedOff: false });
    await removeItem('l', id);
    expect((await db.items.get(id))?.deletedAt).not.toBeNull();
    expect((await queue()).at(-1)).toMatchObject({
      kind: 'deleteItem',
      itemId: id,
    });
  });

  it('clearCrossedOff deletes only live crossed-off items of that list', async () => {
    const done = await saveItem('l', { name: 'a', crossedOff: true });
    const open = await saveItem('l', { name: 'b', crossedOff: false });
    const elsewhere = await saveItem('m', { name: 'c', crossedOff: true });
    await clearCrossedOff('l');
    expect((await db.items.get(done))?.deletedAt).not.toBeNull();
    expect((await db.items.get(open))?.deletedAt).toBeNull();
    expect((await db.items.get(elsewhere))?.deletedAt).toBeNull();
    expect((await queue()).at(-1)).toMatchObject({
      kind: 'deleteItems',
      listId: 'l',
      body: { itemIds: [done] },
    });
  });

  it('clearCrossedOff queues nothing when no item is crossed off', async () => {
    await saveItem('l', { name: 'a', crossedOff: false });
    const before = (await queue()).length;
    await clearCrossedOff('l');
    expect((await queue()).length).toBe(before);
  });
});

describe('item edits of a server-known item', () => {
  const known = (over: Partial<ListItem> = {}): ListItem => ({
    id: 'i1',
    listId: 'l',
    name: 'milk',
    crossedOffAt: null,
    version: 7,
    itemRevision: 14,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  });

  it('queues only the changed field with the item id, base revision, and a UUID mutation id', async () => {
    await db.items.put(known());
    await saveItem('l', { name: 'milk', crossedOff: true }, 'i1');
    const [mutation] = await queue();
    expect(mutation).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: 'updateItem',
      listId: 'l',
      itemId: 'i1',
      baseItemRevision: 14,
      changes: { crossedOff: true },
    });
  });

  it('queues only a changed name when renaming', async () => {
    await db.items.put(known({ crossedOffAt: '2026-01-01T00:00:00.000Z' }));
    await saveItem('l', { name: 'oat milk', crossedOff: true }, 'i1');
    expect(await queue()).toMatchObject([{ changes: { name: 'oat milk' } }]);
  });

  it('updates the local row at once and keeps its server revision', async () => {
    await db.items.put(known());
    await saveItem('l', { name: 'oat milk', crossedOff: true }, 'i1');
    expect(await db.items.get('i1')).toMatchObject({
      name: 'oat milk',
      crossedOffAt: expect.any(String),
      version: 7,
      itemRevision: 14,
    });
  });

  it('queues nothing when no field changed', async () => {
    await db.items.put(known());
    await saveItem('l', { name: 'milk', crossedOff: false }, 'i1');
    expect(await queue()).toEqual([]);
  });

  it('keeps successive edits as distinct mutations in creation order', async () => {
    await db.items.put(known());
    await saveItem('l', { name: 'milk', crossedOff: true }, 'i1');
    await saveItem('l', { name: 'oat milk', crossedOff: true }, 'i1');
    const [first, second] = await queue();
    expect(first!.id).not.toBe(second!.id);
    expect([first, second]).toMatchObject([
      { changes: { crossedOff: true } },
      { changes: { name: 'oat milk' } },
    ]);
  });

  it('keeps the queued patch and its id after a reload', async () => {
    await db.items.put(known());
    await saveItem('l', { name: 'milk', crossedOff: true }, 'i1');
    const before = await queue();
    const reopened = new PantryDb();
    const after = (await reopened.outbox.toArray()).map((e) => e.mutation);
    reopened.close();
    expect(after).toEqual(before);
  });

  it('sends a full create while the item itself is still queued as new', async () => {
    const id = await saveItem('l', { name: 'milk', crossedOff: false });
    await saveItem('l', { name: 'milk', crossedOff: true }, id);
    expect((await queue()).map((m) => m.kind)).toEqual(['putItem', 'putItem']);
  });

  it('sends a full upsert to restore a deleted item', async () => {
    await db.items.put(known({ deletedAt: '2026-01-02T00:00:00.000Z' }));
    await saveItem('l', { name: 'milk', crossedOff: false }, 'i1');
    expect(await queue()).toMatchObject([{ kind: 'putItem', itemId: 'i1' }]);
  });

  it('gives a new item the first revision', async () => {
    const id = await saveItem('l', { name: 'milk', crossedOff: false });
    expect((await db.items.get(id))?.itemRevision).toBe(1);
  });
});
