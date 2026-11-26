import { and, eq, gt } from 'drizzle-orm';
import type { ItemField } from '@pantry-pal/shared';
import type { AppTransaction } from '../db/database.js';
import { itemChange } from '../db/schema.js';

export interface ItemChangeEntry {
  householdId: string;
  itemId: string;
  itemRevision: number;
  mutationId: string;
  fields: ItemField[];
  createdAt: number;
}

/** Appends the journal entry of one accepted item change; call in the transaction that updates the row. */
export function recordItemChange(
  tx: AppTransaction,
  entry: ItemChangeEntry,
): void {
  tx.insert(itemChange)
    .values({ ...entry, fields: JSON.stringify(entry.fields) })
    .run();
}

/** Fields the item's journal records as changed after `baseItemRevision`, within the household. */
export function fieldsChangedAfter(
  tx: AppTransaction,
  householdId: string,
  itemId: string,
  baseItemRevision: number,
): Set<ItemField> {
  const entries = tx
    .select({ fields: itemChange.fields })
    .from(itemChange)
    .where(
      and(
        eq(itemChange.householdId, householdId),
        eq(itemChange.itemId, itemId),
        gt(itemChange.itemRevision, baseItemRevision),
      ),
    )
    .all();
  return new Set(
    entries.flatMap((entry) => JSON.parse(entry.fields) as ItemField[]),
  );
}
