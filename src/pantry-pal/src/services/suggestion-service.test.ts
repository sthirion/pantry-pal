import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import { itemSuggestion } from '../db/schema.js';
import { MAX_SUGGESTIONS, SuggestionService } from './suggestion-service.js';

let db: AppDatabase;
let service: SuggestionService;

function add(
  householdId: string,
  key: string,
  lastUsedAt: number,
  useCount = 1,
  name = key,
) {
  db.insert(itemSuggestion)
    .values({ householdId, nameKey: key, name, useCount, lastUsedAt })
    .run();
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  service = new SuggestionService(db);
});

describe('SuggestionService.list', () => {
  it('returns an empty list when there is no history', () => {
    expect(service.list('h1')).toEqual([]);
  });

  it('returns display name, use count and ISO last-used time, most recent first', () => {
    add('h1', 'milk', 1000, 2, 'Milk');
    add('h1', 'eggs', 3000, 12, 'Eggs');
    add('h1', 'bread', 2000);

    expect(service.list('h1')).toEqual([
      { name: 'Eggs', useCount: 12, lastUsedAt: new Date(3000).toISOString() },
      { name: 'bread', useCount: 1, lastUsedAt: new Date(2000).toISOString() },
      { name: 'Milk', useCount: 2, lastUsedAt: new Date(1000).toISOString() },
    ]);
  });

  it('orders equal timestamps by name key for a stable result', () => {
    add('h1', 'b', 1000);
    add('h1', 'a', 1000);

    expect(service.list('h1').map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('never returns another household suggestions', () => {
    add('h1', 'milk', 1000);
    add('h2', 'secret', 2000);

    expect(service.list('h1').map((s) => s.name)).toEqual(['milk']);
  });

  it('caps the result at 2,000 keeping the most recent', () => {
    const rows = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => ({
      householdId: 'h1',
      nameKey: `k${i}`,
      name: `k${i}`,
      useCount: 1,
      lastUsedAt: i + 1,
    }));
    db.insert(itemSuggestion).values(rows).run();

    const result = service.list('h1');

    expect(MAX_SUGGESTIONS).toBe(2000);
    expect(result).toHaveLength(2000);
    expect(result[0]!.name).toBe(`k${MAX_SUGGESTIONS + 4}`);
    expect(result.at(-1)!.name).toBe('k5');
  });
});
