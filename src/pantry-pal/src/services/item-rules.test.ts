import { describe, expect, it } from 'vitest';
import {
  crossedOffAtFor,
  decideDelete,
  isBatchEligible,
  isMergeIgnored,
  isPutIgnored,
  isStale,
  renamesItem,
} from './item-rules.js';
import type { ItemState } from './item-rules.js';

const T = 1_000;

function state(overrides: Partial<ItemState> = {}): ItemState {
  return {
    name: 'Milk',
    crossedOffAt: null,
    updatedAt: T,
    deletedAt: null,
    ...overrides,
  };
}

describe('isStale', () => {
  it.each([
    [T - 1, true],
    [T, false],
    [T + 1, false],
  ])('changedAt %i against updatedAt 1000 is stale: %s', (changedAt, stale) => {
    expect(isStale(changedAt, T)).toBe(stale);
  });
});

describe('crossedOffAtFor', () => {
  it.each([
    ['sets the time on false to true', null, true, 5, 5],
    ['keeps the stored time on true to true', 3, true, 5, 3],
    ['clears on false from crossed off', 3, false, 5, null],
    ['stays null on false to false', null, false, 5, null],
  ])('%s', (_label, previous, crossedOff, changedAt, expected) => {
    expect(crossedOffAtFor(previous, crossedOff, changedAt)).toBe(expected);
  });
});

describe('isPutIgnored', () => {
  it('ignores a stale write even when it changes the name', () => {
    expect(isPutIgnored(state(), 'Bread', false, T - 1)).toBe(true);
  });

  it('applies a rename with an equal timestamp', () => {
    expect(isPutIgnored(state(), 'Bread', false, T)).toBe(false);
  });

  it('applies a case-only rename', () => {
    expect(isPutIgnored(state(), 'milk', false, T + 1)).toBe(false);
  });

  it('applies a cross off', () => {
    expect(isPutIgnored(state(), 'Milk', true, T + 1)).toBe(false);
  });

  it('applies a restore of a crossed-off item', () => {
    expect(isPutIgnored(state({ crossedOffAt: 5 }), 'Milk', false, T + 1)).toBe(
      false,
    );
  });

  it('ignores a state-identical live item whatever the newer timestamp', () => {
    expect(isPutIgnored(state(), 'Milk', false, T + 1_000_000)).toBe(true);
  });

  it('ignores a state-identical crossed-off live item', () => {
    expect(isPutIgnored(state({ crossedOffAt: 5 }), 'Milk', true, T)).toBe(
      true,
    );
  });

  it('applies an undelete even when name and state are identical', () => {
    expect(isPutIgnored(state({ deletedAt: T }), 'Milk', false, T)).toBe(false);
  });

  it('ignores a stale undelete', () => {
    expect(isPutIgnored(state({ deletedAt: T }), 'Milk', false, T - 1)).toBe(
      true,
    );
  });
});

describe('isMergeIgnored', () => {
  it('ignores a stale merge', () => {
    expect(isMergeIgnored(state({ crossedOffAt: 5 }), false, T - 1)).toBe(true);
  });

  it('ignores a merge into a target already in the requested state', () => {
    expect(isMergeIgnored(state(), false, T + 1)).toBe(true);
    expect(isMergeIgnored(state({ crossedOffAt: 5 }), true, T + 1)).toBe(true);
  });

  it('applies a merge that changes the crossed-off state at an equal timestamp', () => {
    expect(isMergeIgnored(state({ crossedOffAt: 5 }), false, T)).toBe(false);
    expect(isMergeIgnored(state(), true, T)).toBe(false);
  });
});

describe('renamesItem', () => {
  it.each([
    ['Milk', false],
    ['milk', true],
    ['Milk 2', true],
  ])('stored "Milk" against "%s" renames: %s', (name, renamed) => {
    expect(renamesItem(state(), name)).toBe(renamed);
  });
});

describe('decideDelete', () => {
  it('treats an already deleted row as missing whatever the timestamp', () => {
    expect(decideDelete(state({ deletedAt: T }), T - 1)).toBe('missing');
    expect(decideDelete(state({ deletedAt: T }), T + 1)).toBe('missing');
  });

  it('reports a live row newer than the delete as stale', () => {
    expect(decideDelete(state(), T - 1)).toBe('stale');
  });

  it.each([T, T + 1])('deletes a live row at changedAt %i', (changedAt) => {
    expect(decideDelete(state(), changedAt)).toBe('delete');
  });
});

describe('isBatchEligible', () => {
  it('accepts a live row not newer than the batch, crossed off or not', () => {
    expect(isBatchEligible(state(), T)).toBe(true);
    expect(isBatchEligible(state({ crossedOffAt: 5 }), T + 1)).toBe(true);
  });

  it('rejects a live row newer than the batch', () => {
    expect(isBatchEligible(state(), T - 1)).toBe(false);
  });

  it('rejects a soft-deleted row', () => {
    expect(isBatchEligible(state({ deletedAt: T }), T + 1)).toBe(false);
  });
});
