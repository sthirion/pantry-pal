import { nameKey } from '@pantry-pal/shared';
import type {
  ListItem,
  Suggestion,
  SuggestionsResponse,
} from '@pantry-pal/shared';
import { apiRequest } from './apiClient';
import { db } from './db';

export const MAX_SUGGESTIONS_SHOWN = 8;

/** Replaces the local suggestion cache with the server's list; rejects (cache untouched) when the request fails. */
export async function refreshSuggestions(): Promise<void> {
  const { suggestions } =
    await apiRequest<SuggestionsResponse>('/api/suggestions');
  await db.transaction('rw', db.suggestions, async () => {
    await db.suggestions.clear();
    await db.suggestions.bulkPut(
      suggestions.map((s) => ({ ...s, nameKey: nameKey(s.name) })),
    );
  });
}

/**
 * Candidates to suggest: the cached server suggestions plus names that exist only
 * in local items (for example added offline and not yet synced).
 */
export function buildPool(
  stored: readonly Suggestion[],
  items: readonly ListItem[],
): Suggestion[] {
  const pool = new Map<string, Suggestion>();
  for (const s of stored) pool.set(nameKey(s.name), s);
  const local = new Map<string, Suggestion>();
  for (const item of items) {
    const key = nameKey(item.name);
    if (pool.has(key)) continue;
    const seen = local.get(key);
    local.set(key, {
      name: seen?.name ?? item.name,
      useCount: (seen?.useCount ?? 0) + 1,
      lastUsedAt:
        seen && seen.lastUsedAt > item.updatedAt
          ? seen.lastUsedAt
          : item.updatedAt,
    });
  }
  return [...pool.values(), ...local.values()];
}

/**
 * Pool entries whose name, or any word in it, starts with what was typed. Items
 * already active on the list are left out. Highest use count first, then most recent.
 */
export function matchSuggestions(
  typed: string,
  pool: readonly Suggestion[],
  listItems: readonly ListItem[],
): Suggestion[] {
  const query = nameKey(typed);
  if (query === '') return [];
  const active = new Set(
    listItems
      .filter((item) => item.crossedOffAt === null && item.deletedAt === null)
      .map((item) => nameKey(item.name)),
  );
  return pool
    .filter((s) => {
      const key = nameKey(s.name);
      return (
        !active.has(key) && (key.startsWith(query) || key.includes(` ${query}`))
      );
    })
    .sort(
      (a, b) =>
        b.useCount - a.useCount ||
        (a.lastUsedAt < b.lastUsedAt
          ? 1
          : a.lastUsedAt > b.lastUsedAt
            ? -1
            : 0),
    )
    .slice(0, MAX_SUGGESTIONS_SHOWN);
}
