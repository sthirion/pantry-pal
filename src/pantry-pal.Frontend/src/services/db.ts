import Dexie, { type EntityTable } from 'dexie';
import type {
  ListItem,
  OutboxMutation,
  ShoppingList,
  Suggestion,
} from '@pantry-pal/shared';

/** One queued change; `seq` is auto-incremented, so it orders the queue. */
export interface OutboxEntry {
  seq: number;
  mutation: OutboxMutation;
}

export type MetaKey = 'cursor' | 'userId' | 'householdId';

export interface MetaRecord {
  key: MetaKey;
  value: string | number;
}

/** A suggestion row keyed by its normalized name so lookups are case-insensitive. */
export interface StoredSuggestion extends Suggestion {
  nameKey: string;
}

export class PantryDb extends Dexie {
  lists!: EntityTable<ShoppingList, 'id'>;
  items!: EntityTable<ListItem, 'id'>;
  suggestions!: EntityTable<StoredSuggestion, 'nameKey'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<MetaRecord, 'key'>;

  constructor(name = 'pantry-pal') {
    super(name);
    this.version(1).stores({
      lists: 'id',
      items: 'id, listId',
      suggestions: 'nameKey',
      outbox: '++seq',
      meta: 'key',
    });
  }
}

export const db = new PantryDb();

export async function getMeta<T extends string | number>(
  key: MetaKey,
): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(
  key: MetaKey,
  value: string | number,
): Promise<void> {
  await db.meta.put({ key, value });
}

/** Empties every store, including the outbox (used when a different user signs in). */
export async function clearAllStores(): Promise<void> {
  await db.transaction(
    'rw',
    [db.lists, db.items, db.suggestions, db.outbox, db.meta],
    async () => {
      await Promise.all([
        db.lists.clear(),
        db.items.clear(),
        db.suggestions.clear(),
        db.outbox.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

/** Asks the browser not to evict the store; call after sign-in. Returns whether storage is persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  return navigator.storage.persist();
}
