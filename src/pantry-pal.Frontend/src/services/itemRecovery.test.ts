import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ItemMutationResponse, ListItem } from '@pantry-pal/shared';
import { clearAllStores, db } from './db';
import {
  discardBlockedEdit,
  isItemMutationResponse,
  keepServerValues,
  parseRejection,
  resubmitAttemptedValues,
  resubmitBlockedEdit,
} from './itemRecovery';
import { enqueue } from './outbox';
import type { ConflictRecord, UpdateItemMutation } from './outbox.types';

beforeEach(clearAllStores);

const row = (over: Partial<ListItem> = {}): ListItem => ({
  id: 'i1',
  listId: 'l',
  name: 'Online name',
  crossedOffAt: null,
  version: 30,
  itemRevision: 16,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const edit = (
  id: string,
  changes: UpdateItemMutation['changes'],
  baseItemRevision = 14,
): UpdateItemMutation => ({
  id,
  kind: 'updateItem',
  listId: 'l',
  itemId: 'i1',
  baseItemRevision,
  changes,
});

const queued = () => db.outbox.orderBy('seq').toArray();

describe('isItemMutationResponse', () => {
  const sent = edit('m1', { name: '  Offline   name ', crossedOff: true });
  const response = (
    over: Partial<ItemMutationResponse> = {},
    item: Partial<ListItem> = {},
  ): ItemMutationResponse => ({
    mutationId: 'm1',
    item: row({
      name: 'Offline name',
      crossedOffAt: '2026-01-02T00:00:00.000Z',
      itemRevision: 15,
      version: 28,
      ...item,
    }),
    itemRevision: 15,
    version: 28,
    appliedFields: ['name', 'crossedOff'],
    conflicts: [],
    replayed: false,
    ...over,
  });

  it('accepts a complete response that applies every submitted field', () => {
    expect(isItemMutationResponse(response(), sent)).toBe(true);
  });

  it('accepts a no-op that applied nothing and left the revision unchanged', () => {
    const noop = response(
      { itemRevision: 14, appliedFields: [] },
      { itemRevision: 14, name: 'Offline name' },
    );
    expect(isItemMutationResponse(noop, sent)).toBe(true);
  });

  it('accepts a same-field conflict that keeps the server value next to applied fields', () => {
    const merged = response(
      {
        appliedFields: ['crossedOff'],
        conflicts: [
          {
            field: 'name',
            attemptedValue: 'Offline name',
            serverValue: 'Online name',
          },
        ],
      },
      { name: 'Online name' },
    );
    expect(isItemMutationResponse(merged, sent)).toBe(true);
  });

  it('accepts a conflict on every field with nothing applied', () => {
    const conflicted = response(
      {
        appliedFields: [],
        conflicts: [
          {
            field: 'name',
            attemptedValue: 'Offline name',
            serverValue: 'Online name',
          },
          { field: 'crossedOff', attemptedValue: true, serverValue: false },
        ],
      },
      { name: 'Online name', crossedOffAt: null },
    );
    expect(isItemMutationResponse(conflicted, sent)).toBe(true);
  });

  it('accepts a replayed outcome whose item has since moved on', () => {
    const replayed = response(
      {
        replayed: true,
        itemRevision: 22,
        version: 60,
        conflicts: [
          {
            field: 'name',
            attemptedValue: 'Offline name',
            serverValue: 'Online name',
          },
        ],
        appliedFields: ['crossedOff'],
      },
      {
        name: 'Newest name',
        crossedOffAt: null,
        itemRevision: 22,
        version: 60,
      },
    );
    expect(isItemMutationResponse(replayed, sent)).toBe(true);
  });

  it('still holds a replayed outcome to the submitted patch', () => {
    const stray = response({
      replayed: true,
      appliedFields: ['version' as never],
    });
    const foreign = response({
      replayed: true,
      appliedFields: ['crossedOff'],
      conflicts: [{ field: 'name', attemptedValue: 'Other', serverValue: 'x' }],
    });
    expect(isItemMutationResponse(stray, sent)).toBe(false);
    expect(isItemMutationResponse(foreign, sent)).toBe(false);
  });

  it('rejects a fresh outcome whose server value is not the item value', () => {
    const stale = response(
      {
        appliedFields: ['crossedOff'],
        conflicts: [
          {
            field: 'name',
            attemptedValue: 'Offline name',
            serverValue: 'Something else',
          },
        ],
      },
      { name: 'Online name' },
    );
    expect(isItemMutationResponse(stale, sent)).toBe(false);
  });

  it('rejects a patch field reported as both applied and conflicting', () => {
    const both = response({
      conflicts: [
        {
          field: 'crossedOff',
          attemptedValue: true,
          serverValue: true,
        },
      ],
    });
    expect(isItemMutationResponse(both, sent)).toBe(false);
  });

  it('rejects a response for another mutation, item, or list', () => {
    expect(isItemMutationResponse(response({ mutationId: 'm2' }), sent)).toBe(
      false,
    );
    expect(isItemMutationResponse(response({}, { id: 'i2' }), sent)).toBe(
      false,
    );
    expect(isItemMutationResponse(response({}, { listId: 'l2' }), sent)).toBe(
      false,
    );
  });

  it.each([undefined, null, 'ok', 15, []])('rejects %j', (body) => {
    expect(isItemMutationResponse(body, sent)).toBe(false);
  });
});

describe('parseRejection', () => {
  it.each(['BASE_VERSION_EXPIRED', 'BASE_VERSION_AHEAD', 'MUTATION_ID_REUSED'])(
    'reads the stable code %s and the server item',
    (code) => {
      const item = row({ itemRevision: 20 });
      expect(
        parseRejection(409, { error: { code, message: 'm' }, item }),
      ).toEqual({
        blocked: { reason: code, status: 409, serverItemRevision: 20 },
        item,
      });
    },
  );

  it.each([
    ['a body without a code', 400, { error: { message: 'm' } }],
    ['an unknown code', 409, { error: { code: 'name_taken', message: 'm' } }],
    ['no body', 404, undefined],
    ['a body that is not an object', 403, 'nope'],
  ])('reports %s as a plain rejection with no item', (_case, status, body) => {
    expect(parseRejection(status, body)).toEqual({
      blocked: { reason: 'rejected', status },
    });
  });

  it('keeps the field-level details of a 400', () => {
    const details = [
      { path: 'changes.name', message: 'Must be 1 to 200 characters.' },
    ];

    expect(
      parseRejection(400, {
        error: { code: 'validation_failed', message: 'm', details },
      }),
    ).toEqual({ blocked: { reason: 'rejected', status: 400, details } });
  });

  it('drops malformed details and details of other statuses', () => {
    const error = (details: unknown) => ({
      error: { code: 'validation_failed', message: 'm', details },
    });

    expect(
      parseRejection(400, error([{ path: 'changes.name' }, 'x', null])),
    ).toEqual({ blocked: { reason: 'rejected', status: 400 } });
    expect(parseRejection(404, error([{ path: 'a', message: 'b' }]))).toEqual({
      blocked: { reason: 'rejected', status: 404 },
    });
  });

  it('ignores an item that is not a complete list item', () => {
    expect(
      parseRejection(409, {
        error: { code: 'BASE_VERSION_EXPIRED', message: 'm' },
        item: { id: 'i1' },
      }),
    ).toEqual({ blocked: { reason: 'BASE_VERSION_EXPIRED', status: 409 } });
  });
});

describe('discardBlockedEdit', () => {
  it('removes the blocked edit and rebases the next edit of the item on the server revision', async () => {
    await db.outbox.add({
      mutation: edit('1', { crossedOff: true }),
      blocked: {
        reason: 'BASE_VERSION_EXPIRED',
        status: 409,
        serverItemRevision: 20,
      },
    });
    await enqueue(edit('2', { name: 'later' }));

    await discardBlockedEdit((await queued())[0]!.seq);

    expect(await queued()).toMatchObject([
      { mutation: { id: '2', baseItemRevision: 20 } },
    ]);
  });

  it('keeps an edit that is not blocked', async () => {
    await enqueue(edit('1', { crossedOff: true }));

    await discardBlockedEdit((await queued())[0]!.seq);

    expect(await queued()).toHaveLength(1);
  });
});

describe('resubmitBlockedEdit', () => {
  it('queues the same patch as a new mutation on the server revision, in the same place', async () => {
    await db.items.put(row({ itemRevision: 20 }));
    await db.outbox.add({
      mutation: edit('1', { crossedOff: true }),
      blocked: {
        reason: 'BASE_VERSION_EXPIRED',
        status: 409,
        serverItemRevision: 20,
      },
    });
    await enqueue(edit('2', { name: 'later' }));
    const [blocked] = await queued();

    await resubmitBlockedEdit(blocked!.seq);

    const [first, second] = await queued();
    expect(first).toEqual({
      seq: blocked!.seq,
      mutation: {
        ...edit('1', { crossedOff: true }, 20),
        id: expect.not.stringMatching(/^1$/),
      },
    });
    expect(first!.blocked).toBeUndefined();
    expect(second!.mutation.id).toBe('2');
  });

  it('falls back to the stored item revision when the server sent none', async () => {
    await db.items.put(row({ itemRevision: 25 }));
    await db.outbox.add({
      mutation: edit('1', { crossedOff: true }),
      blocked: { reason: 'rejected', status: 404 },
    });

    await resubmitBlockedEdit((await queued())[0]!.seq);

    expect((await queued())[0]!.mutation).toMatchObject({
      baseItemRevision: 25,
    });
  });
});

describe('conflict records', () => {
  const record = (conflicts: ConflictRecord['conflicts']) =>
    db.itemConflicts.put({
      mutationId: 'm1',
      listId: 'l',
      itemId: 'i1',
      conflicts,
      recordedAt: '2026-01-01T00:00:00.000Z',
    });

  it('keeping the server value forgets the attempted one without queueing anything', async () => {
    await record([
      { field: 'name', attemptedValue: 'Offline', serverValue: 'Online name' },
    ]);

    await keepServerValues('m1');

    expect(await db.itemConflicts.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it('using my value queues the attempted value as a new mutation on the current revision', async () => {
    await db.items.put(row());
    await record([
      { field: 'name', attemptedValue: 'Offline', serverValue: 'Online name' },
    ]);

    await resubmitAttemptedValues('m1');

    expect(await queued()).toMatchObject([
      {
        mutation: {
          kind: 'updateItem',
          itemId: 'i1',
          baseItemRevision: 16,
          changes: { name: 'Offline' },
        },
      },
    ]);
    expect((await queued())[0]!.mutation.id).not.toBe('m1');
    expect((await db.items.get('i1'))?.name).toBe('Offline');
    expect(await db.itemConflicts.count()).toBe(0);
  });

  it('queues nothing when the item already has the attempted value', async () => {
    await db.items.put(row({ crossedOffAt: '2026-01-01T00:00:00.000Z' }));
    await record([
      { field: 'crossedOff', attemptedValue: true, serverValue: false },
    ]);

    await resubmitAttemptedValues('m1');

    expect(await queued()).toEqual([]);
    expect(await db.itemConflicts.count()).toBe(0);
  });

  it('keeps the attempted values while the item is deleted', async () => {
    await db.items.put(row({ deletedAt: '2026-01-02T00:00:00.000Z' }));
    await record([
      { field: 'name', attemptedValue: 'Offline', serverValue: 'Online name' },
    ]);

    await resubmitAttemptedValues('m1');

    expect(await queued()).toEqual([]);
    expect(await db.itemConflicts.count()).toBe(1);
  });

  it('keeps the attempted values while the item is not stored locally', async () => {
    await record([
      { field: 'name', attemptedValue: 'Offline', serverValue: 'Online name' },
    ]);

    await resubmitAttemptedValues('m1');

    expect(await queued()).toEqual([]);
    expect(await db.itemConflicts.count()).toBe(1);
  });
});
