import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../services/db';
import { compareListNames, type ListSummary } from '../services/listsView';

export interface ListsState {
  /** False until the first read from the local store finishes. */
  loaded: boolean;
  error: boolean;
  summaries: ListSummary[];
}

async function readSummaries(): Promise<ListSummary[]> {
  const [lists, items] = await Promise.all([
    db.lists.toArray(),
    db.items.toArray(),
  ]);
  const remaining = new Map<string, number>();
  for (const item of items) {
    if (item.deletedAt === null && item.crossedOffAt === null) {
      remaining.set(item.listId, (remaining.get(item.listId) ?? 0) + 1);
    }
  }
  return lists
    .filter((list) => list.deletedAt === null)
    .map((list) => ({ list, remaining: remaining.get(list.id) ?? 0 }))
    .sort((a, b) => compareListNames(a.list.name, b.list.name));
}

/** The household's lists from the local store, sorted, with their remaining-item counts; updates live. */
export function useLists(): ListsState {
  const [state, setState] = useState<ListsState>({
    loaded: false,
    error: false,
    summaries: [],
  });

  useEffect(() => {
    const subscription = liveQuery(readSummaries).subscribe({
      next: (summaries) => setState({ loaded: true, error: false, summaries }),
      error: () => setState({ loaded: true, error: true, summaries: [] }),
    });
    return () => subscription.unsubscribe();
  }, []);

  return state;
}
