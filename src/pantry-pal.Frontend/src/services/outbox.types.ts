import type {
  ApiErrorDetail,
  ItemChanges,
  ItemMutationConflict,
  ItemMutationRejectionCode,
  OutboxMutation,
} from '@pantry-pal/shared';

/** A changed-field edit of an item the server already knows; `baseItemRevision` is the merge base. */
export interface UpdateItemMutation {
  id: string;
  kind: 'updateItem';
  listId: string;
  itemId: string;
  baseItemRevision: number;
  changes: ItemChanges;
}

export type QueuedMutation = OutboxMutation | UpdateItemMutation;

/** Why a queued edit stopped: a stable server code, or `rejected` for any other non-accepted status. */
export type BlockReason = ItemMutationRejectionCode | 'rejected';

/** Marks a queued edit the server did not accept; it waits here until the member reconciles it. */
export interface BlockedState {
  reason: BlockReason;
  status: number;
  /** Item revision the server reported with the rejection, the base for a new attempt. */
  serverItemRevision?: number;
  /** Field-level validation details of a `400`, so the member can correct the patch. */
  details?: ApiErrorDetail[];
}

/** One queued change; `seq` is auto-incremented, so it orders the queue. */
export interface OutboxEntry {
  seq: number;
  mutation: QueuedMutation;
  blocked?: BlockedState;
}

/** Attempted values the server did not take because the same field changed after the edit's base. */
export interface ConflictRecord {
  /** Id of the accepted mutation that reported the conflict. */
  mutationId: string;
  listId: string;
  itemId: string;
  conflicts: ItemMutationConflict[];
  recordedAt: string;
}
