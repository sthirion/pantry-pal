import { db, type OutboxEntry } from './db';
import type { QueuedMutation } from './outbox.types';

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Delay before retry number `attempt` (0-based): 1 s, 2 s, 4 s, ... capped at 60 s. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt), BACKOFF_MAX_MS);
}

export type FailureAction = 'retry' | 'auth' | 'drop';

/** Sync Rules 6: what to do with the outbox entry after a failed request. */
export function classifyStatus(status: number): FailureAction {
  if (status === 401) return 'auth';
  if (status >= 500 || status === 408 || status === 429) return 'retry';
  if (status >= 400 && status < 500) return 'drop';
  return 'retry';
}

/** Appends a mutation. Call inside the same Dexie transaction as the local write. */
export async function enqueue(mutation: QueuedMutation): Promise<void> {
  await db.outbox.add({ mutation } as OutboxEntry);
}

/** The oldest queued change, or `undefined` when the queue is empty. */
export async function peekOldest(): Promise<OutboxEntry | undefined> {
  return db.outbox.orderBy('seq').first();
}

/** Ids of the items a queued change touches. */
function itemIdsOf(mutation: QueuedMutation): readonly string[] {
  switch (mutation.kind) {
    case 'putList':
    case 'deleteList':
      return [];
    case 'putItem':
    case 'deleteItem':
    case 'updateItem':
      return [mutation.itemId];
    case 'deleteItems':
      return mutation.body.itemIds;
  }
}

/** Ids of items whose queue is stopped on an edit the server did not accept. */
function blockedItems(entries: readonly OutboxEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const { mutation, blocked } of entries) {
    if (blocked) itemIdsOf(mutation).forEach((id) => ids.add(id));
  }
  return ids;
}

function isStopped(entry: OutboxEntry, blocked: ReadonlySet<string>): boolean {
  return itemIdsOf(entry.mutation).some((id) => blocked.has(id));
}

/** The oldest queued change that is not stopped behind a blocked edit of the same item. */
export async function nextSendable(): Promise<OutboxEntry | undefined> {
  const entries = await db.outbox.orderBy('seq').toArray();
  const blocked = blockedItems(entries);
  return entries.find((entry) => !isStopped(entry, blocked));
}

export async function removeEntry(seq: number): Promise<void> {
  await db.outbox.delete(seq);
}

/** Number of queued changes still waiting to be sent; stopped edits need review instead. */
export async function pendingCount(): Promise<number> {
  const entries = await db.outbox.toArray();
  const blocked = blockedItems(entries);
  return entries.filter((entry) => !isStopped(entry, blocked)).length;
}

/** Ids of the lists and items that still have sendable queued changes. */
export async function pendingTargets(): Promise<Set<string>> {
  const entries = await db.outbox.toArray();
  const blocked = blockedItems(entries);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (isStopped(entry, blocked)) continue;
    const { mutation } = entry;
    if (mutation.kind === 'putList' || mutation.kind === 'deleteList') {
      ids.add(mutation.listId);
    } else {
      itemIdsOf(mutation).forEach((id) => ids.add(id));
    }
  }
  return ids;
}

/** True while a create of the item is still queued, so the server does not know it yet. */
export async function hasQueuedCreate(itemId: string): Promise<boolean> {
  return (
    (await db.outbox
      .filter(
        ({ mutation }) =>
          mutation.kind === 'putItem' && mutation.itemId === itemId,
      )
      .count()) > 0
  );
}

/**
 * Sets the base of the item's next unsent edit to the revision its predecessor ended on.
 * Call inside a transaction on the outbox.
 */
export async function rebaseNextUnsentEdit(
  itemId: string,
  baseItemRevision: number,
): Promise<void> {
  const next = (await db.outbox.orderBy('seq').toArray()).find(
    ({ mutation, blocked }) =>
      !blocked && mutation.kind === 'updateItem' && mutation.itemId === itemId,
  );
  if (next && next.mutation.kind === 'updateItem') {
    await db.outbox.update(next.seq, {
      mutation: { ...next.mutation, baseItemRevision },
    });
  }
}

function remapMutation(
  mutation: QueuedMutation,
  oldId: string,
  newId: string,
): QueuedMutation {
  const swap = (id: string) => (id === oldId ? newId : id);
  switch (mutation.kind) {
    case 'putList':
    case 'deleteList':
      return { ...mutation, listId: swap(mutation.listId) };
    case 'putItem':
    case 'deleteItem':
    case 'updateItem':
      return {
        ...mutation,
        listId: swap(mutation.listId),
        itemId: swap(mutation.itemId),
      };
    case 'deleteItems':
      return {
        ...mutation,
        listId: swap(mutation.listId),
        body: { ...mutation.body, itemIds: mutation.body.itemIds.map(swap) },
      };
  }
}

/** Replaces a merged-away id in every queued change. */
export async function remapPendingIds(
  oldId: string,
  newId: string,
): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const entries = await db.outbox.toArray();
    for (const entry of entries) {
      const next = remapMutation(entry.mutation, oldId, newId);
      if (JSON.stringify(next) !== JSON.stringify(entry.mutation)) {
        await db.outbox.put({ ...entry, mutation: next });
      }
    }
  });
}
