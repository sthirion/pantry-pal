import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PutListBody } from '@pantry-pal/shared';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import { listItem, shoppingList } from '../db/schema.js';
import { HouseholdEventHub } from '../realtime/household-event-hub.js';
import { ListService } from './list-service.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const H1 = 'household-1';
const H2 = 'household-2';
const ID_A = '0192f0c2-0000-7000-8000-00000000000a';
const ID_B = '0192f0c2-0000-7000-8000-00000000000b';
const ID_C = '0192f0c2-0000-7000-8000-00000000000c';

const iso = (ms: number) => new Date(ms).toISOString();
const body = (name: string, changedAt: number | string): PutListBody => ({
  name,
  changedAt: typeof changedAt === 'number' ? iso(changedAt) : changedAt,
});

let db: AppDatabase;
let hub: HouseholdEventHub;
let published: Array<{ householdId: string; version: number }>;
let service: ListService;

function listRow(id: string) {
  return db.select().from(shoppingList).where(eq(shoppingList.id, id)).get();
}

function counter(): number {
  return (
    db.$client.prepare('SELECT value FROM change_counter').get() as {
      value: number;
    }
  ).value;
}

function addItem(id: string, listId: string, deletedAt: number | null = null) {
  db.insert(listItem)
    .values({
      id,
      householdId: H1,
      listId,
      name: id,
      nameKey: id,
      crossedOffAt: null,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
    })
    .run();
}

function itemRow(id: string) {
  return db.select().from(listItem).where(eq(listItem.id, id)).get();
}

function thrownStatus(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof HTTPException ? err.status : undefined;
  }
  return undefined;
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  hub = new HouseholdEventHub();
  published = [];
  for (const householdId of [H1, H2]) {
    hub.subscribe(householdId, (version) =>
      published.push({ householdId, version }),
    );
  }
  service = new ListService(db, hub, () => NOW);
});

describe('ListService.put create', () => {
  it('creates a list with a new version and publishes it', () => {
    const result = service.put(H1, ID_A, body('Rural King', NOW - 1000));

    expect(result).toEqual({
      created: true,
      applied: true,
      list: {
        id: ID_A,
        name: 'Rural King',
        version: 1,
        updatedAt: iso(NOW - 1000),
        deletedAt: null,
      },
    });
    expect(listRow(ID_A)).toMatchObject({
      householdId: H1,
      nameKey: 'rural king',
      createdAt: NOW,
    });
    expect(published).toEqual([{ householdId: H1, version: 1 }]);
  });

  it('replays an identical request without a new version or event', () => {
    service.put(H1, ID_A, body('Rural King', NOW - 1000));

    const replay = service.put(H1, ID_A, body('Rural King', NOW - 1000));

    expect(replay.created).toBe(false);
    expect(replay.applied).toBe(false);
    expect(replay.list.version).toBe(1);
    expect(counter()).toBe(1);
    expect(published).toHaveLength(1);
  });

  it('treats a replay of a clamped future write with a later clock as a no-op', () => {
    service.put(H1, ID_A, body('Rural King', NOW + 60_000));
    const later = new ListService(db, hub, () => NOW + 5000);

    const replay = later.put(H1, ID_A, body('Rural King', NOW + 60_000));

    expect(replay.applied).toBe(false);
    expect(counter()).toBe(1);
  });

  it('clamps a future changedAt to server time', () => {
    const result = service.put(H1, ID_A, body('Milk', NOW + 3_600_000));
    expect(result.list.updatedAt).toBe(iso(NOW));
    expect(listRow(ID_A)?.updatedAt).toBe(NOW);
  });

  it('accepts a changedAt equal to server time unchanged', () => {
    const result = service.put(H1, ID_A, body('Milk', NOW));
    expect(result.list.updatedAt).toBe(iso(NOW));
  });

  it('applies a changedAt equal to server time to an older existing list', () => {
    service.put(H1, ID_A, body('Old', NOW - 10_000));
    published.length = 0;

    const result = service.put(H1, ID_A, body('New', NOW));

    expect(result).toMatchObject({
      applied: true,
      list: { name: 'New', version: 2, updatedAt: iso(NOW) },
    });
    expect(listRow(ID_A)).toMatchObject({ name: 'New', updatedAt: NOW });
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('accepts a one-character name', () => {
    const result = service.put(H1, ID_A, body('a', NOW - 1000));
    expect(result).toMatchObject({ created: true, list: { name: 'a' } });
  });

  it('still returns the committed result when a subscriber throws', () => {
    hub.subscribe(H1, () => {
      throw new Error('boom');
    });

    const result = service.put(H1, ID_B, body('Milk', NOW - 1000));

    expect(result).toMatchObject({ created: true, list: { version: 1 } });
    expect(listRow(ID_B)?.version).toBe(1);
    expect(published).toEqual([{ householdId: H1, version: 1 }]);
  });

  it('assigns increasing versions across lists and households', () => {
    service.put(H1, ID_A, body('A', NOW));
    service.put(H2, ID_B, body('B', NOW));
    expect(listRow(ID_A)?.version).toBe(1);
    expect(listRow(ID_B)?.version).toBe(2);
    expect(published).toEqual([
      { householdId: H1, version: 1 },
      { householdId: H2, version: 2 },
    ]);
  });

  it('allows the same name in different households without merging', () => {
    service.put(H2, ID_A, body('Market', NOW - 1000));

    const result = service.put(H1, ID_B, body('market', NOW));

    expect(result).toMatchObject({ created: true, list: { id: ID_B } });
    expect(result.mergedFromId).toBeUndefined();
    expect(listRow(ID_A)).toMatchObject({ householdId: H2, version: 1 });
  });

  it('creates beside a soft-deleted list with the same name', () => {
    service.put(H1, ID_A, body('Market', NOW - 2000));
    service.delete(H1, ID_A, iso(NOW - 1000));

    const result = service.put(H1, ID_B, body('market', NOW));

    expect(result).toMatchObject({ created: true, list: { id: ID_B } });
    expect(result.mergedFromId).toBeUndefined();
    expect(listRow(ID_A)?.deletedAt).toBe(NOW - 1000);
  });

  it('returns 403 for an id owned by another household and changes nothing', () => {
    service.put(H2, ID_A, body('Theirs', NOW - 1000));
    const versionBefore = counter();

    expect(thrownStatus(() => service.put(H1, ID_A, body('Mine', NOW)))).toBe(
      403,
    );

    expect(listRow(ID_A)).toMatchObject({ name: 'Theirs', householdId: H2 });
    expect(counter()).toBe(versionBefore);
    expect(published).toHaveLength(1);
  });
});

describe('ListService.put rename', () => {
  beforeEach(() => {
    service.put(H1, ID_A, body('Old', NOW - 10_000));
    published.length = 0;
  });

  it('applies a newer rename with a new version and event', () => {
    const result = service.put(H1, ID_A, body('New', NOW - 5000));

    expect(result).toEqual({
      created: false,
      applied: true,
      list: {
        id: ID_A,
        name: 'New',
        version: 2,
        updatedAt: iso(NOW - 5000),
        deletedAt: null,
      },
    });
    expect(listRow(ID_A)?.nameKey).toBe('new');
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('ignores an older rename and leaves the stored list unchanged', () => {
    const result = service.put(H1, ID_A, body('Older', NOW - 20_000));

    expect(result.applied).toBe(false);
    expect(result.list).toMatchObject({
      name: 'Old',
      version: 1,
      updatedAt: iso(NOW - 10_000),
    });
    expect(listRow(ID_A)).toMatchObject({ name: 'Old', version: 1 });
    expect(counter()).toBe(1);
    expect(published).toEqual([]);
  });

  it('applies a different name at exactly the stored change time', () => {
    const result = service.put(H1, ID_A, body('Equal', NOW - 10_000));

    expect(result).toMatchObject({
      applied: true,
      list: { name: 'Equal', version: 2 },
    });
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('compares instants, not strings, across UTC offsets', () => {
    // 2026-11-13T11:59:50.000Z written with a +02:00 offset is the stored instant.
    const sameInstant = body('Offset', '2026-11-13T13:59:50.000+02:00');
    expect(service.put(H1, ID_A, sameInstant)).toMatchObject({
      applied: true,
      list: { name: 'Offset' },
    });

    const olderInstant = body('Stale', '2026-11-13T13:59:49.999+02:00');
    expect(service.put(H1, ID_A, olderInstant).applied).toBe(false);
  });

  it('clamps a future rename to server time', () => {
    const result = service.put(H1, ID_A, body('Future', NOW + 86_400_000));
    expect(result.list.updatedAt).toBe(iso(NOW));
    expect(listRow(ID_A)?.updatedAt).toBe(NOW);
  });

  it('allows a rename that only changes casing of its own name', () => {
    const result = service.put(H1, ID_A, body('OLD', NOW - 5000));
    expect(result).toMatchObject({ applied: true, list: { name: 'OLD' } });
  });

  it('rejects a rename to another live list name with 409 and no change', () => {
    service.put(H1, ID_B, body('Taken', NOW - 9000));
    published.length = 0;
    const versionBefore = counter();

    const status = thrownStatus(() =>
      service.put(H1, ID_A, body(' taken ', NOW - 1000)),
    );

    expect(status).toBe(409);
    expect(listRow(ID_A)).toMatchObject({ name: 'Old', version: 1 });
    expect(counter()).toBe(versionBefore);
    expect(published).toEqual([]);
  });

  it('allows a rename to the name of a soft-deleted list', () => {
    service.put(H1, ID_B, body('Gone', NOW - 9000));
    service.delete(H1, ID_B, iso(NOW - 8000));

    const result = service.put(H1, ID_A, body('Gone', NOW - 1000));

    expect(result.applied).toBe(true);
  });

  it('ignores a stale write even when its name would conflict', () => {
    service.put(H1, ID_B, body('Taken', NOW - 9000));

    const result = service.put(H1, ID_A, body('Taken', NOW - 20_000));

    expect(result.applied).toBe(false);
  });
});

describe('ListService.put restore', () => {
  beforeEach(() => {
    service.put(H1, ID_A, body('Market', NOW - 10_000));
    service.delete(H1, ID_A, iso(NOW - 5000));
    published.length = 0;
  });

  it('restores a soft-deleted list with a newer changedAt', () => {
    const result = service.put(H1, ID_A, body('Market', NOW - 1000));

    expect(result).toMatchObject({
      created: false,
      applied: true,
      list: { id: ID_A, deletedAt: null, version: 3 },
    });
    expect(listRow(ID_A)?.deletedAt).toBeNull();
    expect(published).toEqual([{ householdId: H1, version: 3 }]);
  });

  it('restores at exactly the deletion time', () => {
    const result = service.put(H1, ID_A, body('Market', NOW - 5000));
    expect(result).toMatchObject({ applied: true, list: { deletedAt: null } });
  });

  it('returns the stored deleted projection for an older write', () => {
    const result = service.put(H1, ID_A, body('Market', NOW - 6000));

    expect(result.applied).toBe(false);
    expect(result.list.deletedAt).toBe(iso(NOW - 5000));
    expect(listRow(ID_A)?.deletedAt).toBe(NOW - 5000);
    expect(published).toEqual([]);
  });

  it('rejects a restore whose name is now used by another live list', () => {
    service.put(H1, ID_B, body('Market', NOW - 4000));

    expect(
      thrownStatus(() => service.put(H1, ID_A, body('Market', NOW - 1000))),
    ).toBe(409);
    expect(listRow(ID_A)?.deletedAt).toBe(NOW - 5000);
  });
});

describe('ListService.put same-name merge', () => {
  beforeEach(() => {
    service.put(H1, ID_A, body('Market', NOW - 10_000));
    published.length = 0;
  });

  it('merges into the existing list with a new version when the clamped time is newer', () => {
    const result = service.put(H1, ID_B, body(' market ', NOW - 5000));

    expect(result.created).toBe(false);
    expect(result.applied).toBe(true);
    expect(result.mergedFromId).toBe(ID_B);
    expect(result.list.id).toBe(ID_A);
    expect(result.list.name).toBe('Market');
    expect(listRow(ID_A)?.name).toBe('Market');
    expect(result.list).toMatchObject({
      version: 2,
      updatedAt: iso(NOW - 5000),
    });
    expect(listRow(ID_B)).toBeUndefined();
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('applies the merge at exactly the existing change time', () => {
    const result = service.put(H1, ID_B, body('market', NOW - 10_000));
    expect(result).toMatchObject({ applied: true, mergedFromId: ID_B });
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('merges with the clamped time when changedAt is in the future', () => {
    const result = service.put(H1, ID_B, body('market', NOW + 60_000));
    expect(result.applied).toBe(true);
    expect(result.list.updatedAt).toBe(iso(NOW));
  });

  it('reports an older merge as unapplied without a version or event', () => {
    const result = service.put(H1, ID_B, body('market', NOW - 20_000));

    expect(result.applied).toBe(false);
    expect(result.mergedFromId).toBe(ID_B);
    expect(result.list).toMatchObject({
      id: ID_A,
      name: 'Market',
      version: 1,
      updatedAt: iso(NOW - 10_000),
    });
    expect(result.list.name).toBe('Market');
    expect(listRow(ID_A)?.name).toBe('Market');
    expect(counter()).toBe(1);
    expect(published).toEqual([]);
    expect(listRow(ID_B)).toBeUndefined();
  });

  it('merges NFC-equivalent names', () => {
    service.put(H1, ID_C, body('Cafe\u0301', NOW - 8000));

    const result = service.put(H1, ID_B, body('caf\u00e9', NOW - 1000));

    expect(result).toMatchObject({ applied: true, mergedFromId: ID_B });
    expect(result.list.id).toBe(ID_C);
  });
});

describe('ListService.delete', () => {
  beforeEach(() => {
    service.put(H1, ID_A, body('Market', NOW - 10_000));
    addItem('item-1', ID_A);
    addItem('item-2', ID_A);
    addItem('item-gone', ID_A, 500);
    published.length = 0;
  });

  it('soft-deletes the list and its live items under one new version', () => {
    const result = service.delete(H1, ID_A, iso(NOW - 5000));

    expect(result).toEqual({ status: 'deleted' });
    expect(listRow(ID_A)).toMatchObject({
      deletedAt: NOW - 5000,
      updatedAt: NOW - 5000,
      version: 2,
    });
    for (const id of ['item-1', 'item-2']) {
      expect(itemRow(id)).toMatchObject({
        deletedAt: NOW - 5000,
        updatedAt: NOW - 5000,
        version: 2,
      });
    }
    expect(published).toEqual([{ householdId: H1, version: 2 }]);
  });

  it('leaves already-deleted items untouched', () => {
    service.delete(H1, ID_A, iso(NOW - 5000));
    expect(itemRow('item-gone')).toMatchObject({
      deletedAt: 500,
      updatedAt: 1,
      version: 1,
    });
  });

  it('does not lower an item updatedAt that is newer than the delete', () => {
    db.update(listItem)
      .set({ updatedAt: NOW - 1000 })
      .where(eq(listItem.id, 'item-1'))
      .run();

    service.delete(H1, ID_A, iso(NOW - 5000));

    expect(itemRow('item-1')).toMatchObject({
      deletedAt: NOW - 5000,
      updatedAt: NOW - 1000,
    });
  });

  it('does not touch items of other lists', () => {
    service.put(H1, ID_B, body('Other', NOW - 9000));
    addItem('other-item', ID_B);

    service.delete(H1, ID_A, iso(NOW - 5000));

    expect(itemRow('other-item')?.deletedAt).toBeNull();
    expect(listRow(ID_B)?.deletedAt).toBeNull();
  });

  it('deletes at exactly the stored change time', () => {
    expect(service.delete(H1, ID_A, iso(NOW - 10_000))).toEqual({
      status: 'deleted',
    });
    expect(listRow(ID_A)?.deletedAt).toBe(NOW - 10_000);
  });

  it('clamps a future changedAt to server time', () => {
    service.delete(H1, ID_A, iso(NOW + 60_000));
    expect(listRow(ID_A)?.deletedAt).toBe(NOW);
    expect(itemRow('item-1')?.deletedAt).toBe(NOW);
  });

  it('is idempotent on repeat with no further version or event', () => {
    service.delete(H1, ID_A, iso(NOW - 5000));
    published.length = 0;

    expect(service.delete(H1, ID_A, iso(NOW - 4000))).toEqual({
      status: 'deleted',
    });

    expect(counter()).toBe(2);
    expect(listRow(ID_A)?.deletedAt).toBe(NOW - 5000);
    for (const id of ['item-1', 'item-2']) {
      expect(itemRow(id)).toMatchObject({
        deletedAt: NOW - 5000,
        updatedAt: NOW - 5000,
        version: 2,
      });
    }
    expect(itemRow('item-gone')).toMatchObject({
      deletedAt: 500,
      updatedAt: 1,
      version: 1,
    });
    expect(published).toEqual([]);
  });

  it('returns deleted for an id that exists nowhere', () => {
    expect(service.delete(H1, ID_C, iso(NOW))).toEqual({ status: 'deleted' });
    expect(counter()).toBe(1);
    expect(published).toEqual([]);
  });

  it('returns 403 for another household and changes nothing', () => {
    expect(thrownStatus(() => service.delete(H2, ID_A, iso(NOW)))).toBe(403);

    expect(listRow(ID_A)?.deletedAt).toBeNull();
    expect(itemRow('item-1')?.deletedAt).toBeNull();
    expect(published).toEqual([]);
  });

  it('returns 403 for another household even when the list is soft-deleted', () => {
    service.delete(H1, ID_A, iso(NOW - 5000));
    expect(thrownStatus(() => service.delete(H2, ID_A, iso(NOW)))).toBe(403);
  });

  it('returns the current list as stale for an older delete', () => {
    const result = service.delete(H1, ID_A, iso(NOW - 20_000));

    expect(result).toEqual({
      status: 'stale',
      list: {
        id: ID_A,
        name: 'Market',
        version: 1,
        updatedAt: iso(NOW - 10_000),
        deletedAt: null,
      },
    });
    expect(listRow(ID_A)?.deletedAt).toBeNull();
    expect(itemRow('item-1')?.deletedAt).toBeNull();
    expect(counter()).toBe(1);
    expect(published).toEqual([]);
  });

  it('rolls back the list, items and version when the item update fails', () => {
    db.$client.exec(`
      CREATE TRIGGER block_item_delete BEFORE UPDATE ON list_item
      BEGIN SELECT RAISE(ABORT, 'blocked'); END;
    `);

    expect(() => service.delete(H1, ID_A, iso(NOW - 5000))).toThrow('blocked');

    expect(listRow(ID_A)).toMatchObject({ deletedAt: null, version: 1 });
    expect(itemRow('item-1')?.deletedAt).toBeNull();
    expect(counter()).toBe(1);
    expect(published).toEqual([]);
  });
});
