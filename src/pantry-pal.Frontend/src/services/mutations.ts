import { v7 as uuidv7 } from 'uuid';
import type { ItemChanges, ListItem, ShoppingList } from '@pantry-pal/shared';
import { db } from './db';
import { enqueue, hasQueuedCreate } from './outbox';

/**
 * Local-first writes: each function updates the local store and appends to the
 * outbox in ONE Dexie transaction, so the UI (reading from Dexie) updates at once
 * and a crash can never leave a change applied but not queued, or the reverse.
 * Callers should afterwards ask the sync engine to flush.
 */

const writeTables = () => [db.lists, db.items, db.outbox];

const now = () => new Date().toISOString();

/** Creates (no `id`) or renames a list; returns its id. */
export async function saveList(
  name: string,
  id: string = uuidv7(),
): Promise<string> {
  const changedAt = now();
  await db.transaction('rw', writeTables(), async () => {
    const existing = await db.lists.get(id);
    const row: ShoppingList = {
      id,
      name,
      version: existing?.version ?? 0,
      updatedAt: changedAt,
      deletedAt: null,
    };
    await db.lists.put(row);
    await enqueue({
      id: uuidv7(),
      kind: 'putList',
      listId: id,
      body: { name, changedAt },
    });
  });
  return id;
}

/** Soft-deletes a list and its items locally. */
export async function removeList(listId: string): Promise<void> {
  const changedAt = now();
  await db.transaction('rw', writeTables(), async () => {
    await db.lists.update(listId, {
      deletedAt: changedAt,
      updatedAt: changedAt,
    });
    await db.items
      .where('listId')
      .equals(listId)
      .modify({ deletedAt: changedAt, updatedAt: changedAt });
    await enqueue({ id: uuidv7(), kind: 'deleteList', listId, changedAt });
  });
}

/**
 * Applies changed fields to a server-known item locally and queues them as one mutation based on the
 * row's `itemRevision`. Queues nothing for an empty patch. Call inside a transaction on items and outbox.
 */
export async function queueItemUpdate(
  existing: ListItem,
  changes: ItemChanges,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  const changedAt = now();
  await db.items.put({
    ...existing,
    ...(changes.name !== undefined && { name: changes.name }),
    ...(changes.crossedOff !== undefined && {
      crossedOffAt: changes.crossedOff
        ? (existing.crossedOffAt ?? changedAt)
        : null,
    }),
    updatedAt: changedAt,
  });
  await enqueue({
    id: uuidv7(),
    kind: 'updateItem',
    listId: existing.listId,
    itemId: existing.id,
    baseItemRevision: existing.itemRevision ?? 1,
    changes,
  });
}

function changedFields(
  existing: ListItem,
  fields: { name: string; crossedOff: boolean },
): ItemChanges {
  return {
    ...(fields.name !== existing.name && { name: fields.name }),
    ...(fields.crossedOff !== (existing.crossedOffAt !== null) && {
      crossedOff: fields.crossedOff,
    }),
  };
}

/**
 * Creates (no `itemId`), renames, crosses off, or restores an item; returns its id.
 * An item the server already knows is queued as a changed-field patch; a new one as a full create.
 */
export async function saveItem(
  listId: string,
  fields: { name: string; crossedOff: boolean },
  itemId: string = uuidv7(),
): Promise<string> {
  const changedAt = now();
  await db.transaction('rw', writeTables(), async () => {
    const existing = await db.items.get(itemId);
    if (
      existing &&
      existing.deletedAt === null &&
      !(await hasQueuedCreate(itemId))
    ) {
      await queueItemUpdate(existing, changedFields(existing, fields));
      return;
    }
    const row: ListItem = {
      id: itemId,
      listId,
      name: fields.name,
      crossedOffAt: fields.crossedOff
        ? (existing?.crossedOffAt ?? changedAt)
        : null,
      version: existing?.version ?? 0,
      itemRevision: existing?.itemRevision ?? 1,
      updatedAt: changedAt,
      deletedAt: null,
    };
    await db.items.put(row);
    await enqueue({
      id: uuidv7(),
      kind: 'putItem',
      listId,
      itemId,
      body: { name: fields.name, crossedOff: fields.crossedOff, changedAt },
    });
  });
  return itemId;
}

export async function removeItem(
  listId: string,
  itemId: string,
): Promise<void> {
  const changedAt = now();
  await db.transaction('rw', writeTables(), async () => {
    await db.items.update(itemId, {
      deletedAt: changedAt,
      updatedAt: changedAt,
    });
    await enqueue({
      id: uuidv7(),
      kind: 'deleteItem',
      listId,
      itemId,
      changedAt,
    });
  });
}

/** Deletes the crossed-off items shown for the list; does nothing when there are none. */
export async function clearCrossedOff(listId: string): Promise<void> {
  const changedAt = now();
  await db.transaction('rw', writeTables(), async () => {
    const crossed = (await db.items.where('listId').equals(listId).toArray())
      .filter((item) => item.crossedOffAt !== null && item.deletedAt === null)
      .slice(0, 500);
    if (crossed.length === 0) return;
    const itemIds = crossed.map((item) => item.id);
    await db.items.where('id').anyOf(itemIds).modify({
      deletedAt: changedAt,
      updatedAt: changedAt,
    });
    await enqueue({
      id: uuidv7(),
      kind: 'deleteItems',
      listId,
      body: { itemIds, changedAt },
    });
  });
}
