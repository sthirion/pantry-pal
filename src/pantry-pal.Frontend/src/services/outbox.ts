import type { OutboxMutation } from '@pantry-pal/shared';
import { db, type OutboxEntry } from './db';

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
export async function enqueue(mutation: OutboxMutation): Promise<void> {
  await db.outbox.add({ mutation } as OutboxEntry);
}

/** The oldest queued change, or `undefined` when the queue is empty. */
export async function peekOldest(): Promise<OutboxEntry | undefined> {
  return db.outbox.orderBy('seq').first();
}

export async function removeEntry(seq: number): Promise<void> {
  await db.outbox.delete(seq);
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}

/** Ids of the lists and items that still have queued changes. */
export async function pendingTargets(): Promise<Set<string>> {
  const ids = new Set<string>();
  await db.outbox.each(({ mutation }) => {
    if (mutation.kind === 'putList' || mutation.kind === 'deleteList') {
      ids.add(mutation.listId);
    } else if (mutation.kind === 'putItem' || mutation.kind === 'deleteItem') {
      ids.add(mutation.itemId);
    } else {
      mutation.body.itemIds.forEach((id) => ids.add(id));
    }
  });
  return ids;
}

function remapMutation(
  mutation: OutboxMutation,
  oldId: string,
  newId: string,
): OutboxMutation {
  const swap = (id: string) => (id === oldId ? newId : id);
  switch (mutation.kind) {
    case 'putList':
    case 'deleteList':
      return { ...mutation, listId: swap(mutation.listId) };
    case 'putItem':
    case 'deleteItem':
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
        await db.outbox.put({ seq: entry.seq, mutation: next });
      }
    }
  });
}
