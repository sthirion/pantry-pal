import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { Suggestion } from '@pantry-pal/shared';
import { db } from '../services/db';
import { buildPool, refreshSuggestions } from '../services/suggestions';

/** Suggestion candidates from the local store (updates live); refreshes the cache from the server when it can. */
export function useSuggestionPool(): Suggestion[] {
  const [pool, setPool] = useState<Suggestion[]>([]);

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [stored, items] = await Promise.all([
        db.suggestions.toArray(),
        db.items.toArray(),
      ]);
      return buildPool(stored, items);
    }).subscribe({ next: setPool, error: () => setPool([]) });
    // Offline or signed out: the cached suggestions stay.
    void refreshSuggestions().catch(() => undefined);
    return () => subscription.unsubscribe();
  }, []);

  return pool;
}
