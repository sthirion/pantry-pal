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
