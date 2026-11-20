import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListItem, Suggestion } from '@pantry-pal/shared';
import { apiRequest } from './apiClient';
import { clearAllStores, db } from './db';
import {
  buildPool,
  matchSuggestions,
  MAX_SUGGESTIONS_SHOWN,
  refreshSuggestions,
} from './suggestions';

vi.mock('./apiClient', () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);

const suggestion = (
  name: string,
  useCount = 1,
  lastUsedAt = '2026-11-01T00:00:00.000Z',
): Suggestion => ({ name, useCount, lastUsedAt });

const item = (name: string, overrides: Partial<ListItem> = {}): ListItem => ({
  id: `id-${name}`,
  listId: 'list-1',
  name,
  crossedOffAt: null,
  version: 1,
  updatedAt: '2026-11-01T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const names = (list: Suggestion[]) => list.map((s) => s.name);

beforeEach(async () => {
  request.mockReset();
  await clearAllStores();
});

describe('matchSuggestions', () => {
  const pool = [
    suggestion('ice cream'),
    suggestion('iced tea'),
    suggestion('rice'),
  ];

  it('matches names that start with the text and leaves out names that only contain it', () => {
    expect(names(matchSuggestions('ic', pool, []))).toEqual([
      'ice cream',
      'iced tea',
    ]);
  });

  it('matches the start of any word in the name', () => {
    expect(names(matchSuggestions('cre', pool, []))).toEqual(['ice cream']);
    expect(names(matchSuggestions('ice c', pool, []))).toEqual(['ice cream']);
  });

  it('ignores case and surrounding whitespace in the typed text', () => {
    expect(names(matchSuggestions('  ICE  ', pool, []))).toEqual([
      'ice cream',
      'iced tea',
    ]);
  });

  it.each(['', '   '])('returns nothing for the blank text %j', (typed) => {
    expect(matchSuggestions(typed, pool, [])).toEqual([]);
  });

  it('returns nothing when no name matches', () => {
    expect(matchSuggestions('zzz', pool, [])).toEqual([]);
  });

  it('shows the top 8 by use count', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      suggestion(`ch${i + 1}`, i + 1),
    );

    const shown = matchSuggestions('ch', many, []);

    expect(MAX_SUGGESTIONS_SHOWN).toBe(8);
    expect(names(shown)).toEqual([
      'ch10',
      'ch9',
      'ch8',
      'ch7',
      'ch6',
      'ch5',
      'ch4',
      'ch3',
    ]);
  });

  it('breaks a use-count tie by the most recent use', () => {
    const tied = [
      suggestion('chips', 4, '2026-11-02T00:00:00.000Z'),
      suggestion('cherries', 4, '2026-11-09T00:00:00.000Z'),
      suggestion('chives', 4, '2026-11-05T00:00:00.000Z'),
    ];

    expect(names(matchSuggestions('ch', tied, []))).toEqual([
      'cherries',
      'chives',
      'chips',
    ]);
  });

  it('leaves out an item that is active on the list, ignoring case', () => {
    const shown = matchSuggestions('ice', pool, [item('Ice Cream')]);

    expect(names(shown)).toEqual(['iced tea']);
  });

  it('still suggests an item that is crossed off or deleted on the list', () => {
    const listItems = [
      item('ice cream', { crossedOffAt: '2026-11-02T00:00:00.000Z' }),
      item('iced tea', { deletedAt: '2026-11-02T00:00:00.000Z' }),
    ];

    expect(names(matchSuggestions('ice', pool, listItems))).toEqual([
      'ice cream',
      'iced tea',
    ]);
  });
});

describe('buildPool', () => {
  it('keeps the server suggestion when a local item has the same name', () => {
    const stored = [suggestion('Milk', 7, '2026-11-05T00:00:00.000Z')];

    const pool = buildPool(stored, [item('milk')]);

    expect(pool).toEqual(stored);
  });

  it('adds names that exist only in local items, counting uses and keeping the latest time', () => {
    const items = [
      item('Oat milk', { id: 'a', updatedAt: '2026-11-03T00:00:00.000Z' }),
      item('oat MILK', { id: 'b', updatedAt: '2026-11-07T00:00:00.000Z' }),
    ];

    expect(buildPool([], items)).toEqual([
      suggestion('Oat milk', 2, '2026-11-07T00:00:00.000Z'),
    ]);
  });

  it('keeps the latest time when the newer item comes first', () => {
    const items = [
      item('Oat milk', { id: 'a', updatedAt: '2026-11-07T00:00:00.000Z' }),
      item('oat MILK', { id: 'b', updatedAt: '2026-11-03T00:00:00.000Z' }),
    ];

    expect(buildPool([], items)).toEqual([
      suggestion('Oat milk', 2, '2026-11-07T00:00:00.000Z'),
    ]);
  });

  it('includes the name of a soft-deleted local item, as the server keeps a suggestion after a delete', () => {
    const deleted = item('Oat milk', {
      deletedAt: '2026-11-02T00:00:00.000Z',
    });

    expect(buildPool([], [deleted])).toEqual([suggestion('Oat milk')]);
  });

  it('returns an empty pool when there is nothing', () => {
    expect(buildPool([], [])).toEqual([]);
  });
});

describe('refreshSuggestions', () => {
  it('replaces the cache with the server list, keyed by normalized name', async () => {
    await db.suggestions.put({ ...suggestion('stale'), nameKey: 'stale' });
    request.mockResolvedValue({
      suggestions: [suggestion('  Ice   Cream ', 3), suggestion('Rice', 1)],
    });

    await refreshSuggestions();

    expect(request).toHaveBeenCalledWith('/api/suggestions');
    const cached = await db.suggestions.orderBy('nameKey').toArray();
    expect(cached.map((s) => s.nameKey)).toEqual(['ice cream', 'rice']);
  });

  it('rejects and leaves the cache as it was when the request fails', async () => {
    await db.suggestions.put({ ...suggestion('kept'), nameKey: 'kept' });
    request.mockRejectedValue(new TypeError('offline'));

    await expect(refreshSuggestions()).rejects.toThrow('offline');

    expect((await db.suggestions.toArray()).map((s) => s.name)).toEqual([
      'kept',
    ]);
  });
});

describe('WireMock suggestions stub', () => {
  const root = join(import.meta.dirname, '..', '..', 'wiremock');
  const body = JSON.parse(
    readFileSync(join(root, '__files', 'suggestions', 'response.json'), 'utf8'),
  ) as { suggestions: Suggestion[] };

  it('serves GET /api/suggestions from a body file that exists', () => {
    const { mappings } = JSON.parse(
      readFileSync(join(root, 'mappings', 'suggestions-stubs.json'), 'utf8'),
    ) as {
      mappings: {
        request: { urlPath: string; method: string };
        response: { bodyFileName: string };
      }[];
    };

    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.request).toMatchObject({
      urlPath: '/api/suggestions',
      method: 'GET',
    });
    expect(
      existsSync(join(root, '__files', mappings[0]!.response.bodyFileName)),
    ).toBe(true);
  });

  it('has more than 8 matches for "ch", ranked by use count then recency', () => {
    const matching = body.suggestions.filter((s) => s.name.startsWith('ch'));
    const shown = names(matchSuggestions('ch', body.suggestions, []));

    expect(matching.length).toBeGreaterThan(MAX_SUGGESTIONS_SHOWN);
    expect(shown).toHaveLength(MAX_SUGGESTIONS_SHOWN);
    expect(shown.indexOf('chips')).toBeLessThan(
      shown.indexOf('cheddar cheese'),
    );
    expect(shown).not.toContain('chewing gum');
  });

  it('has the word-start example: "ic" and "cre" match ice cream, not rice', () => {
    expect(names(matchSuggestions('ic', body.suggestions, []))).toEqual([
      'ice cream',
      'iced tea',
    ]);
    expect(names(matchSuggestions('cre', body.suggestions, []))).toEqual([
      'ice cream',
    ]);
  });
});
