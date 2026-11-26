import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { nameKey } from '@pantry-pal/shared';
import type {
  ItemField,
  ItemMutationBody,
  ItemMutationConflict,
  ItemMutationRejectionCode,
  ItemMutationResponse,
  ListItem,
} from '@pantry-pal/shared';
import { nextVersion } from '../db/change-counter.js';
import type { AppTransaction } from '../db/database.js';
import { householdVersion } from '../db/household-cursor.js';
import { itemMutationReceipt, listItem } from '../db/schema.js';
import {
  findItemInScope,
  findLiveByKey,
  recordSuggestion,
  requireLiveList,
  toListItem,
} from './item-access.js';
import type { ItemRow, Outcome } from './item-access.js';
import { fieldsChangedAfter, recordItemChange } from './item-journal.js';
import {
  canonicalChanges,
  crossedOffAtFor,
  mergeChanges,
} from './item-rules.js';

export type ItemMutationResult =
  | { status: 'accepted'; response: ItemMutationResponse }
  | {
      status: 'rejected';
      code: ItemMutationRejectionCode;
      item: ListItem;
      itemRevision: number;
      version: number;
    };

type ReceiptRow = typeof itemMutationReceipt.$inferSelect;

function reject(
  tx: AppTransaction,
  code: ItemMutationRejectionCode,
  row: ItemRow,
): Outcome<ItemMutationResult> {
  return {
    result: {
      status: 'rejected',
      code,
      item: toListItem(row),
      itemRevision: row.itemRevision,
      version: householdVersion(tx, row.householdId),
    },
  };
}

function accept(
  tx: AppTransaction,
  mutationId: string,
  row: ItemRow,
  appliedFields: ItemField[],
  conflicts: ItemMutationConflict[],
  replayed: boolean,
): ItemMutationResponse {
  return {
    mutationId,
    item: toListItem(row),
    itemRevision: row.itemRevision,
    version: householdVersion(tx, row.householdId),
    appliedFields,
    conflicts,
    replayed,
  };
}

function isSameMutation(
  receipt: ReceiptRow,
  itemId: string,
  body: ItemMutationBody,
): boolean {
  return (
    receipt.itemId === itemId &&
    receipt.baseItemRevision === body.baseItemRevision &&
    receipt.changes === canonicalChanges(body.changes)
  );
}

/**
 * Applies one item mutation inside a write transaction: household authorization first, then idempotency,
 * base-revision checks and a field-level merge in which the server value wins overlapping fields.
 */
export function applyItemMutation(
  tx: AppTransaction,
  now: number,
  householdId: string,
  listId: string,
  itemId: string,
  body: ItemMutationBody,
): Outcome<ItemMutationResult> {
  requireLiveList(tx, householdId, listId);
  const existing = findItemInScope(tx, householdId, listId, itemId);
  if (!existing) throw new HTTPException(404);

  const receipt = tx
    .select()
    .from(itemMutationReceipt)
    .where(
      and(
        eq(itemMutationReceipt.householdId, householdId),
        eq(itemMutationReceipt.mutationId, body.mutationId),
      ),
    )
    .get();
  if (receipt) {
    if (!isSameMutation(receipt, itemId, body)) {
      return reject(tx, 'MUTATION_ID_REUSED', existing);
    }
    return {
      result: {
        status: 'accepted',
        response: accept(
          tx,
          body.mutationId,
          existing,
          JSON.parse(receipt.appliedFields) as ItemField[],
          JSON.parse(receipt.conflicts) as ItemMutationConflict[],
          true,
        ),
      },
    };
  }

  if (existing.deletedAt !== null) throw new HTTPException(404);
  if (body.baseItemRevision > existing.itemRevision) {
    return reject(tx, 'BASE_VERSION_AHEAD', existing);
  }
  if (body.baseItemRevision < existing.prunedThroughItemRevision) {
    return reject(tx, 'BASE_VERSION_EXPIRED', existing);
  }

  const intervening = fieldsChangedAfter(
    tx,
    householdId,
    itemId,
    body.baseItemRevision,
  );
  const { changed, conflicts } = mergeChanges(
    { name: existing.name, crossedOff: existing.crossedOffAt !== null },
    body.changes,
    intervening,
  );

  let row = existing;
  let version: number | undefined;
  if (changed.length > 0) {
    const renamed = changed.includes('name');
    const newName = body.changes.name ?? existing.name;
    const key = nameKey(newName);
    if (renamed && findLiveByKey(tx, existing.listId, key, existing.id)) {
      throw new HTTPException(409);
    }
    const updatedAt = Math.max(now, existing.updatedAt);
    version = nextVersion(tx);
    row = tx
      .update(listItem)
      .set({
        ...(renamed && { name: newName, nameKey: key }),
        crossedOffAt: changed.includes('crossedOff')
          ? crossedOffAtFor(
              existing.crossedOffAt,
              body.changes.crossedOff === true,
              updatedAt,
            )
          : existing.crossedOffAt,
        updatedAt,
        version,
        itemRevision: existing.itemRevision + 1,
      })
      .where(
        and(
          eq(listItem.id, itemId),
          eq(listItem.householdId, householdId),
          eq(listItem.listId, listId),
        ),
      )
      .returning()
      .get();
    recordItemChange(tx, {
      householdId,
      itemId,
      itemRevision: row.itemRevision,
      mutationId: body.mutationId,
      fields: changed,
      createdAt: now,
    });
    if (renamed) recordSuggestion(tx, householdId, key, newName, now);
  }

  tx.insert(itemMutationReceipt)
    .values({
      householdId,
      mutationId: body.mutationId,
      itemId,
      baseItemRevision: body.baseItemRevision,
      changes: canonicalChanges(body.changes),
      appliedFields: JSON.stringify(changed),
      conflicts: JSON.stringify(conflicts),
      createdAt: now,
    })
    .run();

  return {
    result: {
      status: 'accepted',
      response: accept(tx, body.mutationId, row, changed, conflicts, false),
    },
    version,
  };
}
