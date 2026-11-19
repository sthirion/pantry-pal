import { describe, expect, it } from 'vitest';
import type { ShoppingList } from '@pantry-pal/shared';
import { compareListNames, validateListName } from './listsView';

const list = (id: string, name: string, deletedAt: string | null = null) =>
  ({ id, name, version: 1, updatedAt: '', deletedAt }) as ShoppingList;

describe('compareListNames', () => {
  it('sorts case-insensitively', () => {
    expect(
      ['pharmacy', 'Garden Center', 'Market'].sort(compareListNames),
    ).toEqual(['Garden Center', 'Market', 'pharmacy']);
  });
});

describe('validateListName', () => {
  const lists = [list('1', 'Market'), list('2', 'Old', '2026-01-01')];

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['a'.repeat(101), 'tooLong'],
    ['  MARKET ', 'duplicate'],
    ['Mar ket', null],
    ['a'.repeat(100), null],
    ['Old', null],
  ])('%j -> %s', (name, expected) => {
    expect(validateListName(name, lists)).toBe(expected);
  });

  it('measures length after collapsing whitespace', () => {
    expect(validateListName('a' + ' '.repeat(200) + 'b', [])).toBeNull();
  });

  it('ignores the list being renamed', () => {
    expect(validateListName('market', lists, '1')).toBeNull();
  });
});
