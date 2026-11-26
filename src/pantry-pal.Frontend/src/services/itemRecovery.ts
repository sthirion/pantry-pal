import { v7 as uuidv7 } from 'uuid';
import { displayName } from '@pantry-pal/shared';
import type {
  ApiErrorDetail,
  ItemChanges,
  ItemField,
  ItemMutationConflict,
  ItemMutationRejectionCode,
  ItemMutationResponse,
  ListItem,
} from '@pantry-pal/shared';
import { db } from './db';
import { queueItemUpdate } from './mutations';
import { rebaseNextUnsentEdit } from './outbox';
import type { BlockedState, UpdateItemMutation } from './outbox.types';

const REJECTION_CODES: readonly ItemMutationRejectionCode[] = [
  'BASE_VERSION_EXPIRED',
  'BASE_VERSION_AHEAD',
  'MUTATION_ID_REUSED',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isListItem(value: unknown): value is ListItem {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.listId === 'string' &&
    typeof value.name === 'string' &&
    (value.crossedOffAt === null || typeof value.crossedOffAt === 'string') &&
    typeof value.version === 'number' &&
    typeof value.itemRevision === 'number' &&
    typeof value.updatedAt === 'string' &&
    (value.deletedAt === null || typeof value.deletedAt === 'string')
  );
}

function isConflict(value: unknown): value is ItemMutationConflict {
  if (!isRecord(value)) return false;
  if (value.field === 'name') {
    return (
      typeof value.attemptedValue === 'string' &&
      typeof value.serverValue === 'string'
    );
  }
  return (
    value.field === 'crossedOff' &&
    typeof value.attemptedValue === 'boolean' &&
    typeof value.serverValue === 'boolean'
  );
}

function isSafeInt(value: unknown, min: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min
  );
}

const SUBMITTABLE_FIELDS: readonly ItemField[] = ['name', 'crossedOff'];

function isItemField(value: unknown): value is ItemField {
  return value === 'name' || value === 'crossedOff';
}

/** The value the mutation tried to set for a field, as the server normalizes it; undefined if not patched. */
function attemptedValue(
  changes: ItemChanges,
  field: ItemField,
): string | boolean | undefined {
  if (field === 'crossedOff') return changes.crossedOff;
  return changes.name === undefined ? undefined : displayName(changes.name);
}

function currentValue(item: ListItem, field: ItemField): string | boolean {
  return field === 'name' ? item.name : item.crossedOffAt !== null;
}

function hasDuplicates(fields: readonly ItemField[]): boolean {
  return new Set(fields).size !== fields.length;
}

/**
 * True only for a complete accepted-mutation body that answers `mutation`; anything else cannot
 * confirm the edit was applied. Fields of a replayed outcome are checked only against the patch,
 * because the item may have moved on since the receipt was recorded.
 */
export function isItemMutationResponse(
  value: unknown,
  mutation: UpdateItemMutation,
): value is ItemMutationResponse {
  if (!isRecord(value) || !isListItem(value.item)) return false;
  const { item } = value;
  if (
    value.mutationId !== mutation.id ||
    item.id !== mutation.itemId ||
    item.listId !== mutation.listId ||
    !isSafeInt(item.itemRevision, 1) ||
    !isSafeInt(item.version, 0) ||
    !isSafeInt(value.itemRevision, 1) ||
    value.itemRevision !== item.itemRevision ||
    value.itemRevision < mutation.baseItemRevision ||
    !isSafeInt(value.version, 0) ||
    value.version < item.version ||
    typeof value.replayed !== 'boolean' ||
    !Array.isArray(value.appliedFields) ||
    !Array.isArray(value.conflicts)
  ) {
    return false;
  }

  const applied: unknown[] = value.appliedFields;
  if (
    !applied.every(isItemField) ||
    hasDuplicates(applied) ||
    applied.some(
      (field) => attemptedValue(mutation.changes, field) === undefined,
    )
  ) {
    return false;
  }
  const conflicts: unknown[] = value.conflicts;
  if (!conflicts.every(isConflict)) return false;
  const conflictFields = conflicts.map((conflict) => conflict.field);
  if (
    hasDuplicates(conflictFields) ||
    conflicts.some(
      (conflict) =>
        applied.includes(conflict.field) ||
        conflict.attemptedValue !==
          attemptedValue(mutation.changes, conflict.field),
    )
  ) {
    return false;
  }
  if (value.replayed) return true;

  // A fresh outcome describes the row it just produced.
  return (
    item.deletedAt === null &&
    (applied.length === 0 || value.itemRevision > mutation.baseItemRevision) &&
    applied.every(
      (field) =>
        currentValue(item, field) === attemptedValue(mutation.changes, field),
    ) &&
    conflicts.every(
      (conflict) => conflict.serverValue === currentValue(item, conflict.field),
    ) &&
    // A submitted field in neither list is a no-op only if the item already holds the attempted value.
    SUBMITTABLE_FIELDS.every((field) => {
      const attempted = attemptedValue(mutation.changes, field);
      return (
        attempted === undefined ||
        applied.includes(field) ||
        conflictFields.includes(field) ||
        currentValue(item, field) === attempted
      );
    })
  );
}

function readDetails(body: unknown): ApiErrorDetail[] {
  if (!isRecord(body) || !isRecord(body.error)) return [];
  const { details } = body.error;
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail: unknown) =>
    isRecord(detail) &&
    typeof detail.path === 'string' &&
    typeof detail.message === 'string'
      ? [{ path: detail.path, message: detail.message }]
      : [],
  );
}

/** Reads a non-accepted item mutation response into a blocked state and, when sent, the server's item. */
export function parseRejection(
  status: number,
  body: unknown,
): { blocked: BlockedState; item?: ListItem } {
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : null;
  const reason = REJECTION_CODES.find((known) => known === code) ?? 'rejected';
  const item = isRecord(body) && isListItem(body.item) ? body.item : undefined;
  const details = status === 400 ? readDetails(body) : [];
  return {
    blocked: {
      reason,
      status,
      ...(item && { serverItemRevision: item.itemRevision }),
      ...(details.length > 0 && { details }),
    },
    ...(item && { item }),
  };
}

/** Drops a blocked edit; the item's later queued edits continue from the revision the server reported. */
export async function discardBlockedEdit(seq: number): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const entry = await db.outbox.get(seq);
    if (!entry?.blocked || entry.mutation.kind !== 'updateItem') return;
    await db.outbox.delete(seq);
    if (entry.blocked.serverItemRevision !== undefined) {
      await rebaseNextUnsentEdit(
        entry.mutation.itemId,
        entry.blocked.serverItemRevision,
      );
    }
  });
}

/** Resubmits a blocked edit's patch as a new mutation on the refreshed revision, keeping its queue position. */
export async function resubmitBlockedEdit(seq: number): Promise<void> {
  await db.transaction('rw', [db.outbox, db.items], async () => {
    const entry = await db.outbox.get(seq);
    if (!entry?.blocked || entry.mutation.kind !== 'updateItem') return;
    const row = await db.items.get(entry.mutation.itemId);
    await db.outbox.put({
      seq,
      mutation: {
        ...entry.mutation,
        id: uuidv7(),
        baseItemRevision:
          entry.blocked.serverItemRevision ??
          row?.itemRevision ??
          entry.mutation.baseItemRevision,
      },
    });
  });
}

/** Accepts the server's value for a conflict and forgets the attempted one. */
export async function keepServerValues(mutationId: string): Promise<void> {
  await db.itemConflicts.delete(mutationId);
}

/** Resubmits the attempted values of a conflict as a new mutation based on the item's current revision. */
export async function resubmitAttemptedValues(
  mutationId: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.items, db.outbox, db.itemConflicts],
    async () => {
      const record = await db.itemConflicts.get(mutationId);
      if (!record) return;
      const row = await db.items.get(record.itemId);
      // The record is the only copy of the attempted values; keep it while they cannot be queued.
      if (!row || row.deletedAt !== null) return;
      const changes: ItemChanges = {};
      for (const conflict of record.conflicts) {
        if (conflict.field === 'name' && conflict.attemptedValue !== row.name) {
          changes.name = conflict.attemptedValue;
        } else if (
          conflict.field === 'crossedOff' &&
          conflict.attemptedValue !== (row.crossedOffAt !== null)
        ) {
          changes.crossedOff = conflict.attemptedValue;
        }
      }
      await queueItemUpdate(row, changes);
      await db.itemConflicts.delete(mutationId);
    },
  );
}
