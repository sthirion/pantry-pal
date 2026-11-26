import { describe, expect, it } from 'vitest';
import type { ListItem } from '@pantry-pal/shared';
import {
  findItemByName,
  splitItems,
  validateItemName,
  validateItemRename,
} from './itemsView';

const item = (
  id: string,
  name: string,
  crossedOffAt: string | null = null,
  deletedAt: string | null = null,
) =>
  ({
    id,
    listId: 'l',
    name,
    crossedOffAt,
    version: 1,
    itemRevision: 1,
    updatedAt: '',
    deletedAt,
  }) as ListItem;

describe('validateItemName', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['a'.repeat(201), 'tooLong'],
    ['a'.repeat(200), null],
    ['milk', null],
  ])('%j -> %s', (name, expected) => {
    expect(validateItemName(name)).toBe(expected);
  });
});

describe('findItemByName', () => {
  const items = [item('1', 'Milk'), item('2', 'old', null, '2026-01-01')];

  it('matches ignoring case and spacing', () => {
    expect(findItemByName('  mILK ', items)?.id).toBe('1');
  });

  it('ignores deleted items and the excluded item', () => {
    expect(findItemByName('old', items)).toBeUndefined();
    expect(findItemByName('milk', items, '1')).toBeUndefined();
  });
});

describe('validateItemRename', () => {
  const items = [item('1', 'Milk'), item('2', 'Eggs')];

  it.each([
    ['', 'empty'],
    ['a'.repeat(201), 'tooLong'],
    ['eggs', 'duplicate'],
    ['MILK', null],
    ['bread', null],
  ])('%j -> %s', (name, expected) => {
    expect(validateItemRename(name, items, '1')).toBe(expected);
  });
});

describe('splitItems', () => {
  it('orders active by creation and crossed-off most recent first, dropping deleted', () => {
    const { active, crossedOff } = splitItems([
      item('b', 'second'),
      item('a', 'first'),
      item('c', 'old', '2026-01-01T00:00:00.000Z'),
      item('d', 'new', '2026-01-03T00:00:00.000Z'),
      item('e', 'mid', '2026-01-02T00:00:00.000Z'),
      item('f', 'same', '2026-01-02T00:00:00.000Z'),
      item('g', 'gone', null, '2026-01-01'),
    ]);

    expect(active.map((i) => i.name)).toEqual(['first', 'second']);
    expect(crossedOff.map((i) => i.name)).toEqual([
      'new',
      'mid',
      'same',
      'old',
    ]);
  });
});
