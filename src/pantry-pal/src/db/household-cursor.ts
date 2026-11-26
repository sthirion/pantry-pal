import { eq, max } from 'drizzle-orm';
import type { AppTransaction } from './database.js';
import { listItem, shoppingList } from './schema.js';

/** The household's sync cursor: the highest `version` among its lists and items (tombstones included). */
export function householdVersion(
  tx: AppTransaction,
  householdId: string,
): number {
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
  return Math.max(listMax, itemMax);
}
