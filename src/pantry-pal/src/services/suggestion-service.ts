import { desc, eq } from 'drizzle-orm';
import type { Suggestion } from '@pantry-pal/shared';
import type { AppDatabase } from '../db/database.js';
import { itemSuggestion } from '../db/schema.js';

export const MAX_SUGGESTIONS = 2000;

export class SuggestionService {
  constructor(private readonly db: AppDatabase) {}

  /** Up to `MAX_SUGGESTIONS` of the household's suggestions, most recently used first. */
  list(householdId: string): Suggestion[] {
    return this.db
      .select()
      .from(itemSuggestion)
      .where(eq(itemSuggestion.householdId, householdId))
      .orderBy(desc(itemSuggestion.lastUsedAt), itemSuggestion.nameKey)
      .limit(MAX_SUGGESTIONS)
      .all()
      .map((row) => ({
        name: row.name,
        useCount: row.useCount,
        lastUsedAt: new Date(row.lastUsedAt).toISOString(),
      }));
  }
}
