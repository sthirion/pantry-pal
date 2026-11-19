import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { ListItem, ShoppingList } from '@pantry-pal/shared';
import { db } from '../services/db';

export interface ListItemsState {
  /** False until the first read from the local store finishes. */
  loaded: boolean;
  error: boolean;
  /** `null` when the list does not exist or was deleted. */
  list: ShoppingList | null;
  /** Every not-deleted item of the list, unsorted. */
  items: ListItem[];
}

async function read(listId: string) {
  const [list, items] = await Promise.all([
    db.lists.get(listId),
    db.items.where('listId').equals(listId).toArray(),
  ]);
  return {
    list: list && list.deletedAt === null ? list : null,
    items: items.filter((item) => item.deletedAt === null),
  };
}

/** One list and its items from the local store; updates live. */
export function useListItems(listId: string): ListItemsState {
  const [state, setState] = useState<ListItemsState>({
    loaded: false,
    error: false,
    list: null,
    items: [],
  });

  useEffect(() => {
    setState({ loaded: false, error: false, list: null, items: [] });
    const subscription = liveQuery(() => read(listId)).subscribe({
      next: (data) => setState({ loaded: true, error: false, ...data }),
      error: () =>
        setState({ loaded: true, error: true, list: null, items: [] }),
    });
    return () => subscription.unsubscribe();
  }, [listId]);

  return state;
}
