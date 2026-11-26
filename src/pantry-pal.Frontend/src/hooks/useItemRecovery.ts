import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type {
  ApiErrorDetail,
  ItemChanges,
  ItemMutationConflict,
} from '@pantry-pal/shared';
import { db } from '../services/db';
import type { BlockReason } from '../services/outbox.types';

/** Attempted values the server did not take because the field changed after the edit's base. */
export interface ConflictView {
  mutationId: string;
  /** `null` when the item is no longer stored locally. */
  itemName: string | null;
  conflicts: ItemMutationConflict[];
}

/** An edit the server did not accept; its complete patch is kept until the member reconciles it. */
export interface BlockedView {
  seq: number;
  itemName: string | null;
  reason: BlockReason;
  status: number;
  changes: ItemChanges;
  details: ApiErrorDetail[];
}

export interface RecoveryState {
  conflicts: ConflictView[];
  blocked: BlockedView[];
}

const EMPTY: RecoveryState = { conflicts: [], blocked: [] };

async function read(listId: string): Promise<RecoveryState> {
  const [entries, records, items] = await Promise.all([
    db.outbox.orderBy('seq').toArray(),
    db.itemConflicts.where('listId').equals(listId).sortBy('recordedAt'),
    db.items.where('listId').equals(listId).toArray(),
  ]);
  const nameOf = (itemId: string) =>
    items.find((item) => item.id === itemId)?.name ?? null;
  return {
    conflicts: records.map((record) => ({
      mutationId: record.mutationId,
      itemName: nameOf(record.itemId),
      conflicts: record.conflicts,
    })),
    blocked: entries.flatMap(({ seq, mutation, blocked }) =>
      blocked && mutation.kind === 'updateItem' && mutation.listId === listId
        ? [
            {
              seq,
              itemName:
                nameOf(mutation.itemId) ?? mutation.changes.name ?? null,
              reason: blocked.reason,
              status: blocked.status,
              changes: mutation.changes,
              details: blocked.details ?? [],
            },
          ]
        : [],
    ),
  };
}

/** The conflicts and blocked edits of one list, from the local store; updates live. */
export function useItemRecovery(listId: string): RecoveryState {
  const [state, setState] = useState<RecoveryState>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    const subscription = liveQuery(() => read(listId)).subscribe({
      next: setState,
      error: () => setState(EMPTY),
    });
    return () => subscription.unsubscribe();
  }, [listId]);

  return state;
}
