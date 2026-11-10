import { describe, expect, it } from 'vitest';
import {
  changedAtSchema,
  deleteItemsBodySchema,
  putItemBodySchema,
  putListBodySchema,
  sinceQuerySchema,
  uuidSchema,
} from './schemas.js';

const changedAt = '2026-11-09T18:00:00.000Z';
const uuid = '0192f0c3-7b1e-7000-8000-000000000001';
const uuids = (n: number) => Array.from({ length: n }, () => uuid);

function failingPath(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('putListBodySchema', () => {
  it('accepts 1 and 100 characters and outputs the displayName form', () => {
    expect(
      putListBodySchema.parse({ name: ' Rural   King ', changedAt }).name,
    ).toBe('Rural King');
    expect(putListBodySchema.safeParse({ name: 'a', changedAt }).success).toBe(
      true,
    );
    expect(
      putListBodySchema.safeParse({ name: 'a'.repeat(100), changedAt }).success,
    ).toBe(true);
  });

  it.each(['', '   ', 'a'.repeat(101), undefined, 5])(
    'rejects name %j',
    (name) => {
      const result = putListBodySchema.safeParse({ name, changedAt });
      expect(result.success).toBe(false);
      expect(failingPath(result)).toEqual(['name']);
    },
  );

  it('reports the length message for a too-long name', () => {
    const result = putListBodySchema.safeParse({
      name: 'a'.repeat(101),
      changedAt,
    });
    expect(result.error?.issues[0]?.message).toBe(
      'Must be 1 to 100 characters.',
    );
  });

  it('strips unknown properties', () => {
    const parsed = putListBodySchema.parse({ name: 'x', changedAt, extra: 1 });
    expect(parsed).toEqual({ name: 'x', changedAt });
  });
});

describe('putItemBodySchema', () => {
  it('accepts 1 and 200 characters and both booleans', () => {
    expect(
      putItemBodySchema.safeParse({ name: 'a', crossedOff: true, changedAt })
        .success,
    ).toBe(true);
    expect(
      putItemBodySchema.safeParse({
        name: 'a'.repeat(200),
        crossedOff: false,
        changedAt,
      }).success,
    ).toBe(true);
  });

  it.each(['', '   ', 'a'.repeat(201)])('rejects name %j', (name) => {
    const result = putItemBodySchema.safeParse({
      name,
      crossedOff: true,
      changedAt,
    });
    expect(failingPath(result)).toEqual(['name']);
  });

  it.each([undefined, 'true', 1, null])(
    'rejects crossedOff %j',
    (crossedOff) => {
      const result = putItemBodySchema.safeParse({
        name: 'a',
        crossedOff,
        changedAt,
      });
      expect(failingPath(result)).toEqual(['crossedOff']);
    },
  );
});

describe('deleteItemsBodySchema', () => {
  it('accepts 1 and 500 UUIDs', () => {
    expect(
      deleteItemsBodySchema.safeParse({ itemIds: uuids(1), changedAt }).success,
    ).toBe(true);
    expect(
      deleteItemsBodySchema.safeParse({ itemIds: uuids(500), changedAt })
        .success,
    ).toBe(true);
  });

  it.each([[0], [501]])('rejects %i ids', (n) => {
    const result = deleteItemsBodySchema.safeParse({
      itemIds: uuids(n),
      changedAt,
    });
    expect(failingPath(result)).toEqual(['itemIds']);
  });

  it('names the index of a non-UUID entry', () => {
    const itemIds = uuids(4);
    itemIds[3] = 'nope';
    const result = deleteItemsBodySchema.safeParse({ itemIds, changedAt });
    expect(failingPath(result)).toEqual(['itemIds.3']);
  });
});

describe('changedAtSchema', () => {
  it.each(['2026-11-09T18:00:00.000Z', '2026-11-09T18:00:00+02:00'])(
    'accepts %s',
    (value) => {
      expect(changedAtSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(['2026-11-09', 'yesterday', 1731175200000, undefined])(
    'rejects %j',
    (value) => {
      expect(changedAtSchema.safeParse(value).success).toBe(false);
    },
  );

  it('reports the path when missing from a body', () => {
    const result = putListBodySchema.safeParse({ name: 'x' });
    expect(failingPath(result)).toEqual(['changedAt']);
  });
});

describe('sinceQuerySchema', () => {
  it.each([
    ['0', 0],
    ['1532', 1532],
    [undefined, 0],
  ])('parses %j as %j', (input, expected) => {
    expect(sinceQuerySchema.parse(input)).toBe(expected);
  });

  it('accepts Number.MAX_SAFE_INTEGER', () => {
    expect(sinceQuerySchema.parse(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    String(Number.MAX_SAFE_INTEGER + 1),
    '9'.repeat(400),
    '-1',
    '1.5',
    'abc',
    '',
  ])('rejects %j', (input) => {
    expect(sinceQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('uuidSchema', () => {
  it('accepts a v7 and a v4 UUID', () => {
    expect(uuidSchema.safeParse(uuid).success).toBe(true);
    expect(
      uuidSchema.safeParse('3b241101-e2bb-4255-8caf-4136c566a962').success,
    ).toBe(true);
  });

  it.each(['abc', ''])('rejects %j', (value) => {
    expect(uuidSchema.safeParse(value).success).toBe(false);
  });
});
