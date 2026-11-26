import type {
  ItemChanges,
  ItemField,
  ItemMutationConflict,
} from '@pantry-pal/shared';

/** The mergeable view of a stored item. */
export interface ItemValues {
  name: string;
  crossedOff: boolean;
}

export interface MergeDecision {
  /** Fields whose value actually changes; empty when the mutation is a no-op. */
  changed: ItemField[];
  /** Overlapping fields: the server value wins and the attempted value is reported. */
  conflicts: ItemMutationConflict[];
}

/**
 * Splits a patch into fields to apply and fields that overlap a change newer than the patch's base.
 * An overlapping field is always a conflict; a non-overlapping field already at its target value is a no-op.
 */
export function mergeChanges(
  current: ItemValues,
  changes: ItemChanges,
  intervening: ReadonlySet<ItemField>,
): MergeDecision {
  const changed: ItemField[] = [];
  const conflicts: ItemMutationConflict[] = [];
  if (changes.name !== undefined) {
    if (intervening.has('name')) {
      conflicts.push({
        field: 'name',
        attemptedValue: changes.name,
        serverValue: current.name,
      });
    } else if (changes.name !== current.name) {
      changed.push('name');
    }
  }
  if (changes.crossedOff !== undefined) {
    if (intervening.has('crossedOff')) {
      conflicts.push({
        field: 'crossedOff',
        attemptedValue: changes.crossedOff,
        serverValue: current.crossedOff,
      });
    } else if (changes.crossedOff !== current.crossedOff) {
      changed.push('crossedOff');
    }
  }
  return { changed, conflicts };
}

/** Field-ordered JSON of a patch, so equal patches always compare equal. */
export function canonicalChanges(changes: ItemChanges): string {
  return JSON.stringify({
    ...(changes.name !== undefined && { name: changes.name }),
    ...(changes.crossedOff !== undefined && { crossedOff: changes.crossedOff }),
  });
}

/** The fields whose stored value differs from the target, in field order. */
export function changedFields(
  existing: { name: string; crossedOffAt: number | null },
  target: ItemValues,
): ItemField[] {
  const changed: ItemField[] = [];
  if (existing.name !== target.name) changed.push('name');
  if ((existing.crossedOffAt !== null) !== target.crossedOff) {
    changed.push('crossedOff');
  }
  return changed;
}

/** The stored fields the item write rules depend on; timestamps are epoch milliseconds. */
export interface ItemState {
  name: string;
  crossedOffAt: number | null;
  updatedAt: number;
  deletedAt: number | null;
}

/** A write is stale only when it is older than the stored row; an equal timestamp applies. */
export function isStale(changedAt: number, updatedAt: number): boolean {
  return changedAt < updatedAt;
}

/** `crossedOffAt` is set on false to true, cleared on false, and kept on true to true. */
export function crossedOffAtFor(
  previous: number | null,
  crossedOff: boolean,
  changedAt: number,
): number | null {
  if (!crossedOff) return null;
  return previous ?? changedAt;
}

/** Whether a `PUT` on an existing row (live or soft-deleted) is ignored rather than applied. */
export function isPutIgnored(
  existing: ItemState,
  name: string,
  crossedOff: boolean,
  changedAt: number,
): boolean {
  if (isStale(changedAt, existing.updatedAt)) return true;
  return (
    existing.deletedAt === null &&
    existing.name === name &&
    (existing.crossedOffAt !== null) === crossedOff
  );
}

/** Whether a same-name create merged into a live target is ignored rather than applied. */
export function isMergeIgnored(
  target: ItemState,
  crossedOff: boolean,
  changedAt: number,
): boolean {
  return (
    isStale(changedAt, target.updatedAt) ||
    (target.crossedOffAt !== null) === crossedOff
  );
}

/** An applied `PUT` upserts a suggestion only when the stored name changes. */
export function renamesItem(existing: ItemState, name: string): boolean {
  return existing.name !== name;
}

export type DeleteDecision = 'missing' | 'stale' | 'delete';

/** Single `DELETE`: an already deleted row is a no-op whatever the timestamp. */
export function decideDelete(
  existing: ItemState,
  changedAt: number,
): DeleteDecision {
  if (existing.deletedAt !== null) return 'missing';
  return isStale(changedAt, existing.updatedAt) ? 'stale' : 'delete';
}

/** Batch delete: a listed row is deleted when it is live and not newer than the batch. */
export function isBatchEligible(
  existing: ItemState,
  changedAt: number,
): boolean {
  return existing.deletedAt === null && !isStale(changedAt, existing.updatedAt);
}
