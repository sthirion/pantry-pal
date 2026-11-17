import { and, eq, gt, isNull, max } from 'drizzle-orm';
import type { SyncResponse } from '@pantry-pal/shared';
import type { AppDatabase } from '../db/database.js';
import { listItem, shoppingList, syncState } from '../db/schema.js';
import { toListItem } from './item-service.js';
import { toShoppingList } from './list-service.js';

export class SyncService {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Rows of the household changed after `since` (tombstones included). When `since` is older than the
   * purge horizon, tombstones may be gone, so a full snapshot of live rows is returned instead.
   */
  getChanges(householdId: string, since: number): SyncResponse {
    return this.db.transaction((tx) => {
      const horizon =
        tx
          .select({ value: syncState.purgedThroughVersion })
          .from(syncState)
          .where(eq(syncState.householdId, householdId))
          .get()?.value ?? 0;
      const full = since < horizon;

      const listFilter = and(
        eq(shoppingList.householdId, householdId),
        full ? isNull(shoppingList.deletedAt) : gt(shoppingList.version, since),
      );
      const itemFilter = and(
        eq(listItem.householdId, householdId),
        full ? isNull(listItem.deletedAt) : gt(listItem.version, since),
      );

      const lists = tx
        .select()
        .from(shoppingList)
        .where(listFilter)
        .orderBy(shoppingList.version)
        .all();
      const items = tx
        .select()
        .from(listItem)
        .where(itemFilter)
        .orderBy(listItem.version)
        .all();

      const listMax =
        tx
          .select({ value: max(shoppingList.version) })
          .from(shoppingList)
          .where(eq(shoppingList.householdId, householdId))
          .get()?.value ?? 0;
      const itemMax =
        tx
          .select({ value: max(listItem.version) })
          .from(listItem)
          .where(eq(listItem.householdId, householdId))
          .get()?.value ?? 0;

      return {
        version: Math.max(listMax, itemMax),
        full,
        lists: lists.map(toShoppingList),
        items: items.map(toListItem),
      };
    });
  }
}
