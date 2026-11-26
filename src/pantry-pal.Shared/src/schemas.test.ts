import { describe, expect, it } from 'vitest';
import {
  changedAtSchema,
  deleteItemsBodySchema,
  itemChangesSchema,
  itemMutationBodySchema,
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

describe('itemChangesSchema', () => {
  it('accepts a name-only, a crossedOff-only and a two-field patch', () => {
    expect(itemChangesSchema.parse({ name: 'Milk' })).toEqual({ name: 'Milk' });
    expect(itemChangesSchema.parse({ crossedOff: false })).toEqual({
      crossedOff: false,
    });
    expect(itemChangesSchema.parse({ name: 'Milk', crossedOff: true })).toEqual(
      { name: 'Milk', crossedOff: true },
    );
  });

  it('outputs the displayName form of the name', () => {
    expect(itemChangesSchema.parse({ name: ' Whole   milk ' }).name).toBe(
      'Whole milk',
    );
  });

  it('accepts a name of 1 and 200 characters', () => {
    expect(itemChangesSchema.safeParse({ name: 'a' }).success).toBe(true);
    expect(itemChangesSchema.safeParse({ name: 'a'.repeat(200) }).success).toBe(
      true,
    );
  });

  it.each(['', '   ', 'a'.repeat(201)])('rejects name %j', (name) => {
    const result = itemChangesSchema.safeParse({ name });
    expect(failingPath(result)).toEqual(['name']);
  });

  it('reports the length message for a too-long name', () => {
    const result = itemChangesSchema.safeParse({ name: 'a'.repeat(201) });
    expect(result.error?.issues[0]?.message).toBe(
      'Must be 1 to 200 characters.',
    );
  });

  it.each(['true', 1, 0, null])('rejects crossedOff %j', (crossedOff) => {
    const result = itemChangesSchema.safeParse({ crossedOff });
    expect(failingPath(result)).toEqual(['crossedOff']);
  });

  it('rejects a name that is not a string', () => {
    const result = itemChangesSchema.safeParse({ name: 5 });
    expect(failingPath(result)).toEqual(['name']);
  });

  it('rejects a null name', () => {
    const result = itemChangesSchema.safeParse({ name: null });
    expect(failingPath(result)).toEqual(['name']);
  });

  it('measures the name length after normalization', () => {
    const padded = `  ${'a'.repeat(200)}  `;
    const spaced = `${'a'.repeat(100)}     ${'a'.repeat(100)}`;

    expect(itemChangesSchema.parse({ name: padded }).name).toBe(
      'a'.repeat(200),
    );
    expect(itemChangesSchema.safeParse({ name: spaced }).success).toBe(false);
  });

  it('rejects an empty patch', () => {
    const result = itemChangesSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Must change at least one field.',
    );
  });

  it.each([
    ['version', 5],
    ['itemRevision', 2],
    ['deletedAt', null],
    ['listId', 'x'],
    ['id', 'x'],
  ])('rejects the unsupported field %s', (field, value) => {
    const result = itemChangesSchema.safeParse({
      crossedOff: true,
      [field]: value,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('rejects a patch of only unsupported fields', () => {
    expect(itemChangesSchema.safeParse({ version: 5 }).success).toBe(false);
  });
});

describe('itemMutationBodySchema', () => {
  const valid = {
    mutationId: uuid,
    baseItemRevision: 14,
    changes: { crossedOff: true },
  };

  it('accepts a complete mutation and keeps only the patch fields', () => {
    expect(itemMutationBodySchema.parse(valid)).toEqual(valid);
  });

  it('normalizes the patch name', () => {
    const parsed = itemMutationBodySchema.parse({
      ...valid,
      changes: { name: ' Granny   Smith ' },
    });
    expect(parsed.changes).toEqual({ name: 'Granny Smith' });
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'abc'],
    ['empty', ''],
    ['a number', 7],
  ])('rejects a mutationId that is %s', (_label, mutationId) => {
    const result = itemMutationBodySchema.safeParse({ ...valid, mutationId });
    expect(failingPath(result)).toEqual(['mutationId']);
  });

  it.each([1, 2, Number.MAX_SAFE_INTEGER])(
    'accepts baseItemRevision %i',
    (baseItemRevision) => {
      expect(
        itemMutationBodySchema.safeParse({ ...valid, baseItemRevision })
          .success,
      ).toBe(true);
    },
  );

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['beyond the safe range', Number.MAX_SAFE_INTEGER + 1],
    ['infinite', Infinity],
    ['a numeric string', '5'],
    ['null', null],
    ['missing', undefined],
  ])('rejects a baseItemRevision that is %s', (_label, baseItemRevision) => {
    const result = itemMutationBodySchema.safeParse({
      ...valid,
      baseItemRevision,
    });
    expect(failingPath(result)).toEqual(['baseItemRevision']);
  });

  it('rejects a missing changes object', () => {
    const result = itemMutationBodySchema.safeParse({
      mutationId: uuid,
      baseItemRevision: 1,
    });
    expect(failingPath(result)).toEqual(['changes']);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'crossedOff'],
  ])('rejects changes that is %s', (_label, changes) => {
    const result = itemMutationBodySchema.safeParse({ ...valid, changes });
    expect(failingPath(result)).toEqual(['changes']);
  });

  it.each([null, 'body', 5, []])('rejects a body of %j', (body) => {
    expect(itemMutationBodySchema.safeParse(body).success).toBe(false);
  });

  it('rejects an empty patch at the changes path', () => {
    const result = itemMutationBodySchema.safeParse({ ...valid, changes: {} });
    expect(failingPath(result)).toEqual(['changes']);
  });

  it('rejects an unsupported patch field at the changes path', () => {
    const result = itemMutationBodySchema.safeParse({
      ...valid,
      changes: { crossedOff: true, version: 9 },
    });
    expect(failingPath(result)).toEqual(['changes']);
  });

  it('rejects an invalid crossedOff and name length inside the patch', () => {
    expect(
      failingPath(
        itemMutationBodySchema.safeParse({
          ...valid,
          changes: { crossedOff: 'yes' },
        }),
      ),
    ).toEqual(['changes.crossedOff']);
    expect(
      failingPath(
        itemMutationBodySchema.safeParse({
          ...valid,
          changes: { name: 'a'.repeat(201) },
        }),
      ),
    ).toEqual(['changes.name']);
  });

  it('rejects an unknown top-level property', () => {
    const result = itemMutationBodySchema.safeParse({
      ...valid,
      householdId: 'other',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
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
