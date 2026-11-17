import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import { listItem, shoppingList, syncState } from '../db/schema.js';
import { SyncService } from './sync-service.js';

const H1 = 'h1';
const H2 = 'h2';

let db: AppDatabase;
let service: SyncService;

function addList(
  id: string,
  householdId: string,
  version: number,
  deletedAt: number | null = null,
) {
  db.insert(shoppingList)
    .values({
      id,
      householdId,
      name: id,
      nameKey: id,
      version,
      createdAt: 1,
      updatedAt: 1000 + version,
      deletedAt,
    })
    .run();
}

function addItem(
  id: string,
  listId: string,
  householdId: string,
  version: number,
  deletedAt: number | null = null,
) {
  db.insert(listItem)
    .values({
      id,
      householdId,
      listId,
      name: id,
      nameKey: id,
      crossedOffAt: null,
      version,
      createdAt: 1,
      updatedAt: 2000 + version,
      deletedAt,
    })
    .run();
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  service = new SyncService(db);
  addList('l1', H1, 1);
  addList('l2', H1, 2, 500);
  addItem('i1', 'l1', H1, 3);
  addItem('i2', 'l1', H1, 5, 600);
  addList('other-list', H2, 4);
  addItem('other-item', 'other-list', H2, 6);
});

describe('SyncService.getChanges', () => {
  it('returns every live and deleted row and the highest version for since=0', () => {
    const result = service.getChanges(H1, 0);

    expect(result.full).toBe(false);
    expect(result.version).toBe(5);
    expect(result.lists.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(result.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(result.lists[1]!.deletedAt).toBe(new Date(500).toISOString());
    expect(result.items[1]!.deletedAt).toBe(new Date(600).toISOString());
    expect(result.items[0]).toEqual({
      id: 'i1',
      listId: 'l1',
      name: 'i1',
      crossedOffAt: null,
      version: 3,
      updatedAt: new Date(2003).toISOString(),
      deletedAt: null,
    });
  });

  it('returns only rows with version greater than since, tombstones included', () => {
    const result = service.getChanges(H1, 3);

    expect(result.lists).toEqual([]);
    expect(result.items.map((i) => i.id)).toEqual(['i2']);
    expect(result.version).toBe(5);
  });

  it('excludes a row whose version equals since', () => {
    expect(service.getChanges(H1, 2).lists).toEqual([]);
    expect(service.getChanges(H1, 1).lists.map((l) => l.id)).toEqual(['l2']);
  });

  it('returns no rows but the current version when since is the highest version', () => {
    const result = service.getChanges(H1, 5);

    expect(result).toEqual({ version: 5, full: false, lists: [], items: [] });
  });

  it('never returns rows of another household', () => {
    const result = service.getChanges(H2, 0);

    expect(result.lists.map((l) => l.id)).toEqual(['other-list']);
    expect(result.items.map((i) => i.id)).toEqual(['other-item']);
    expect(result.version).toBe(6);
  });

  it('returns version 0 for a household without rows', () => {
    expect(service.getChanges('empty', 0)).toEqual({
      version: 0,
      full: false,
      lists: [],
      items: [],
    });
  });

  it('returns a live-only full snapshot when since is below the purge horizon', () => {
    db.insert(syncState)
      .values({ householdId: H1, purgedThroughVersion: 4 })
      .run();

    const result = service.getChanges(H1, 3);

    expect(result.full).toBe(true);
    expect(result.lists.map((l) => l.id)).toEqual(['l1']);
    expect(result.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('returns a delta when since equals the purge horizon', () => {
    db.insert(syncState)
      .values({ householdId: H1, purgedThroughVersion: 3 })
      .run();

    const result = service.getChanges(H1, 3);

    expect(result.full).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(['i2']);
  });

  it('does not apply another household purge horizon', () => {
    db.insert(syncState)
      .values({ householdId: H2, purgedThroughVersion: 100 })
      .run();

    expect(service.getChanges(H1, 0).full).toBe(false);
  });

  it('reports the highest actual row version, not the purge horizon', () => {
    db.insert(syncState)
      .values({ householdId: H1, purgedThroughVersion: 900 })
      .run();

    const result = service.getChanges(H1, 900);

    // Highest row version of H1 in the fixture is a tombstone, which a full snapshot omits.
    expect(result.version).toBe(5);
  });

  it('reports version 0 when the household has no rows', () => {
    db.delete(listItem).run();
    db.delete(shoppingList).run();
    db.insert(syncState)
      .values({ householdId: H1, purgedThroughVersion: 9 })
      .run();

    expect(service.getChanges(H1, 9).version).toBe(0);
  });
});
