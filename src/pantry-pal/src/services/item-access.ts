import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { ListItem } from '@pantry-pal/shared';
import type { AppTransaction } from '../db/database.js';
import { itemSuggestion, listItem, shoppingList } from '../db/schema.js';
import { CodedHttpException } from '../errors.js';

export type ItemRow = typeof listItem.$inferSelect;

/** What a write transaction returns; `version` is set only when a new shared version was assigned. */
export interface Outcome<T> {
  result: T;
  version?: number;
}

export function toListItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    crossedOffAt:
      row.crossedOffAt === null
        ? null
        : new Date(row.crossedOffAt).toISOString(),
    version: row.version,
    itemRevision: row.itemRevision,
    updatedAt: new Date(row.updatedAt).toISOString(),
    deletedAt:
      row.deletedAt === null ? null : new Date(row.deletedAt).toISOString(),
  };
}

export function onOtherList(): CodedHttpException {
  return new CodedHttpException(409, 'item_on_other_list');
}

export function findLiveByKey(
  tx: AppTransaction,
  listId: string,
  key: string,
  excludeId?: string,
): ItemRow | undefined {
  return tx
    .select()
    .from(listItem)
    .where(
      and(
        eq(listItem.listId, listId),
        eq(listItem.nameKey, key),
        isNull(listItem.deletedAt),
        excludeId === undefined ? undefined : ne(listItem.id, excludeId),
      ),
    )
    .get();
}

/** A list of another household is `403`; a missing or soft-deleted list of this household is `404`. */
export function requireLiveList(
  tx: AppTransaction,
  householdId: string,
  listId: string,
): void {
  const list = tx
    .select()
    .from(shoppingList)
    .where(eq(shoppingList.id, listId))
    .get();
  if (list && list.householdId !== householdId) {
    throw new HTTPException(403);
  }
  if (!list || list.deletedAt !== null) throw new HTTPException(404);
}

export function findItem(tx: AppTransaction, id: string): ItemRow | undefined {
  return tx.select().from(listItem).where(eq(listItem.id, id)).get();
}

/**
 * Reads an item only within the household and list in one query. A missing item and an item of another list
 * or household are indistinguishable (`undefined`), and no unscoped lookup is made.
 */
export function findItemInScope(
  tx: AppTransaction,
  householdId: string,
  listId: string,
  id: string,
): ItemRow | undefined {
  return tx
    .select()
    .from(listItem)
    .where(
      and(
        eq(listItem.id, id),
        eq(listItem.householdId, householdId),
        eq(listItem.listId, listId),
      ),
    )
    .get();
}

export function requireOnList(
  row: ItemRow,
  householdId: string,
  listId: string,
): void {
  if (row.householdId !== householdId) throw new HTTPException(403);
  if (row.listId !== listId) throw onOtherList();
}

/** Counts a use of the name; an existing suggestion keeps its stored display name. */
export function recordSuggestion(
  tx: AppTransaction,
  householdId: string,
  key: string,
  name: string,
  lastUsedAt: number,
): void {
  tx.insert(itemSuggestion)
    .values({ householdId, nameKey: key, name, useCount: 1, lastUsedAt })
    .onConflictDoUpdate({
      target: [itemSuggestion.householdId, itemSuggestion.nameKey],
      set: { useCount: sql`${itemSuggestion.useCount} + 1`, lastUsedAt },
    })
    .run();
}
