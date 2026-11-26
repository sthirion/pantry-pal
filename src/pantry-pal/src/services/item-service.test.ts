import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemMutationBody, PutItemBody } from '@pantry-pal/shared';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import {
  itemChange,
  itemMutationReceipt,
  itemSuggestion,
  listItem,
  shoppingList,
} from '../db/schema.js';
import { HouseholdEventHub } from '../realtime/household-event-hub.js';
import { ItemService } from './item-service.js';
import type { ItemMutationResult } from './item-mutation.js';
import { MaintenanceService } from './maintenance-service.js';
import { SyncService } from './sync-service.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const H1 = 'household-1';
const H2 = 'household-2';
const LIST_1 = 'list-1';
const LIST_2 = 'list-2';
const LIST_OTHER = 'list-other';
const ITEM = 'item-1';
const ITEM_OTHER_HOUSEHOLD = 'item-h2';
const START_VERSION = 10;

const mutationId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (ms: number) => new Date(ms).toISOString();

let db: AppDatabase;
let hub: HouseholdEventHub;
let published: number[];
let clock: number;
let service: ItemService;

function addList(
  id: string,
  householdId: string,
  deletedAt: number | null = null,
) {
  db.insert(shoppingList)
    .values({
      id,
      householdId,
      name: id,
      nameKey: id,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
    })
    .run();
}

function addItem(
  id: string,
  listId: string,
  householdId: string,
  name: string,
  overrides: Partial<typeof listItem.$inferInsert> = {},
) {
  db.insert(listItem)
    .values({
      id,
      householdId,
      listId,
      name,
      nameKey: name.toLowerCase(),
      crossedOffAt: null,
      version: START_VERSION,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      ...overrides,
    })
    .run();
}

const itemRow = (id: string) =>
  db.select().from(listItem).where(eq(listItem.id, id)).get()!;
const journal = (id: string) =>
  db
    .select()
    .from(itemChange)
    .where(eq(itemChange.itemId, id))
    .orderBy(itemChange.itemRevision)
    .all();
const receipts = () => db.select().from(itemMutationReceipt).all();

function counter(): number {
  return (
    db.$client.prepare('SELECT value FROM change_counter').get() as {
      value: number;
    }
  ).value;
}

function mutate(
  n: number,
  baseItemRevision: number,
  changes: ItemMutationBody['changes'],
  target: { householdId?: string; listId?: string; itemId?: string } = {},
): ItemMutationResult {
  return service.mutate(
    target.householdId ?? H1,
    target.listId ?? LIST_1,
    target.itemId ?? ITEM,
    { mutationId: mutationId(n), baseItemRevision, changes },
  );
}

function accepted(result: ItemMutationResult) {
  if (result.status !== 'accepted') {
    throw new Error(`expected an accepted mutation, got ${result.code}`);
  }
  return result.response;
}

function rejected(result: ItemMutationResult) {
  if (result.status !== 'rejected') {
    throw new Error('expected a rejected mutation');
  }
  return result;
}

function thrownStatus(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof HTTPException ? err.status : undefined;
  }
  return undefined;
}

interface ExecutedQuery {
  sql: string;
  params: unknown[];
}

/** Records every statement the database executes, with its bound parameters. */
function recordQueries(): ExecutedQuery[] {
  const queries: ExecutedQuery[] = [];
  const client = db.$client;
  const prepare = client.prepare.bind(client) as (sql: string) => object;
  vi.spyOn(client, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    const proxy: object = new Proxy(statement, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        return (...params: unknown[]) => {
          if (['get', 'all', 'run', 'values'].includes(String(prop))) {
            queries.push({ sql, params });
          }
          const result: unknown = value.apply(target, params);
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  }) as unknown as typeof client.prepare);
  return queries;
}

const touching = (queries: ExecutedQuery[], table: string) =>
  queries.filter((q) => q.sql.includes(`"${table}"`));

const putBody = (name: string, crossedOff = false): PutItemBody => ({
  name,
  crossedOff,
  changedAt: iso(NOW),
});

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  db.$client.prepare('UPDATE change_counter SET value = ?').run(START_VERSION);
  clock = NOW;
  hub = new HouseholdEventHub();
  published = [];
  hub.subscribe(H1, (version) => published.push(version));
  service = new ItemService(db, hub, () => clock);
  addList(LIST_1, H1);
  addList(LIST_2, H1);
  addList(LIST_OTHER, H2);
  addItem(ITEM, LIST_1, H1, 'Apples');
  addItem(ITEM_OTHER_HOUSEHOLD, LIST_OTHER, H2, 'Pears');
});

describe('ItemService.mutate acceptance', () => {
  it('applies a changed field, advances the item revision and household version once, and publishes', () => {
    const response = accepted(mutate(1, 1, { crossedOff: true }));

    expect(response).toMatchObject({
      mutationId: mutationId(1),
      itemRevision: 2,
      version: START_VERSION + 1,
      appliedFields: ['crossedOff'],
      conflicts: [],
      replayed: false,
    });
    expect(response.item).toMatchObject({
      id: ITEM,
      name: 'Apples',
      crossedOffAt: iso(NOW),
      itemRevision: 2,
      version: START_VERSION + 1,
    });
    expect(counter()).toBe(START_VERSION + 1);
    expect(published).toEqual([START_VERSION + 1]);
  });

  it('writes one journal entry and one receipt with the accepted outcome', () => {
    accepted(mutate(1, 1, { crossedOff: true }));

    expect(journal(ITEM)).toEqual([
      {
        itemId: ITEM,
        householdId: H1,
        itemRevision: 2,
        mutationId: mutationId(1),
        fields: '["crossedOff"]',
        createdAt: NOW,
      },
    ]);
    expect(receipts()).toEqual([
      {
        householdId: H1,
        mutationId: mutationId(1),
        itemId: ITEM,
        baseItemRevision: 1,
        changes: '{"crossedOff":true}',
        appliedFields: '["crossedOff"]',
        conflicts: '[]',
        createdAt: NOW,
      },
    ]);
  });

  it('exposes the accepted change to a sync from the cursor before it, never by item revision', () => {
    const sync = new SyncService(db);
    accepted(mutate(1, 1, { crossedOff: true }));

    const changes = sync.getChanges(H1, START_VERSION);

    expect(changes.items).toHaveLength(1);
    expect(changes.items[0]).toMatchObject({ id: ITEM, itemRevision: 2 });
    expect(changes.version).toBe(START_VERSION + 1);
    expect(sync.getChanges(H1, START_VERSION + 1).items).toEqual([]);
  });

  it('clears the cross-off time when crossedOff becomes false', () => {
    addItem('crossed', LIST_1, H1, 'Eggs', { crossedOffAt: 5 });

    accepted(mutate(1, 1, { crossedOff: false }, { itemId: 'crossed' }));

    expect(itemRow('crossed').crossedOffAt).toBeNull();
  });

  it('renames, updates the name key, and counts a suggestion use', () => {
    const response = accepted(mutate(1, 1, { name: 'Granny Smith' }));

    expect(response.appliedFields).toEqual(['name']);
    expect(itemRow(ITEM)).toMatchObject({
      name: 'Granny Smith',
      nameKey: 'granny smith',
    });
    expect(
      db
        .select()
        .from(itemSuggestion)
        .where(eq(itemSuggestion.nameKey, 'granny smith'))
        .get(),
    ).toMatchObject({ householdId: H1, useCount: 1, lastUsedAt: NOW });
  });

  it('accepts a case-only rename of the same item', () => {
    const response = accepted(mutate(1, 1, { name: 'apples' }));

    expect(response.appliedFields).toEqual(['name']);
    expect(itemRow(ITEM).name).toBe('apples');
  });

  it('applies both fields of a patch and journals them together', () => {
    const response = accepted(
      mutate(1, 1, { name: 'Pears', crossedOff: true }),
    );

    expect(response.appliedFields).toEqual(['name', 'crossedOff']);
    expect(response.itemRevision).toBe(2);
    expect(journal(ITEM)[0]?.fields).toBe('["name","crossedOff"]');
  });
});

describe('ItemService.mutate field merge', () => {
  it('keeps an intervening rename and applies a disjoint crossedOff from the old base', () => {
    accepted(mutate(1, 1, { name: 'Granny Smith apples' }));

    const response = accepted(mutate(2, 1, { crossedOff: true }));

    expect(response.appliedFields).toEqual(['crossedOff']);
    expect(response.conflicts).toEqual([]);
    expect(response.itemRevision).toBe(3);
    expect(response.item.name).toBe('Granny Smith apples');
    expect(response.item.crossedOffAt).not.toBeNull();
  });

  it('keeps the server name, applies the other field, and reports the conflict values', () => {
    accepted(mutate(1, 1, { name: 'Online name' }));

    const response = accepted(
      mutate(2, 1, { name: 'Offline name', crossedOff: true }),
    );

    expect(response.appliedFields).toEqual(['crossedOff']);
    expect(response.conflicts).toEqual([
      {
        field: 'name',
        attemptedValue: 'Offline name',
        serverValue: 'Online name',
      },
    ]);
    expect(response.item.name).toBe('Online name');
    expect(response.itemRevision).toBe(3);
  });

  it('reports a crossedOff conflict with boolean attempted and server values', () => {
    accepted(mutate(1, 1, { crossedOff: true }));

    const response = accepted(mutate(2, 1, { crossedOff: false }));

    expect(response.conflicts).toEqual([
      { field: 'crossedOff', attemptedValue: false, serverValue: true },
    ]);
    expect(response.item.crossedOffAt).not.toBeNull();
  });

  it('records the outcome without any change when every field conflicts', () => {
    accepted(mutate(1, 1, { name: 'Online name' }));
    const versionBefore = counter();
    published.length = 0;

    const response = accepted(mutate(2, 1, { name: 'Offline name' }));

    expect(response.appliedFields).toEqual([]);
    expect(response.conflicts).toHaveLength(1);
    expect(response.itemRevision).toBe(2);
    expect(counter()).toBe(versionBefore);
    expect(published).toEqual([]);
    expect(journal(ITEM)).toHaveLength(1);
    expect(receipts()).toHaveLength(2);
  });

  it('applies a patch from a base equal to the current revision without conflicts', () => {
    accepted(mutate(1, 1, { name: 'Online name' }));

    const response = accepted(mutate(2, 2, { name: 'Newer name' }));

    expect(response.conflicts).toEqual([]);
    expect(response.item.name).toBe('Newer name');
  });

  it('treats an intervening legacy whole-item PUT as a field change', () => {
    service.put(H1, LIST_1, ITEM, putBody('Renamed by legacy'));

    const response = accepted(mutate(1, 1, { name: 'Stale rename' }));

    expect(response.conflicts).toEqual([
      {
        field: 'name',
        attemptedValue: 'Stale rename',
        serverValue: 'Renamed by legacy',
      },
    ]);
  });

  it('rejects a rename onto another live item of the list and changes nothing', () => {
    addItem('bread', LIST_1, H1, 'Bread');
    const versionBefore = counter();

    expect(thrownStatus(() => mutate(1, 1, { name: 'bread' }))).toBe(409);

    expect(itemRow(ITEM)).toMatchObject({ name: 'Apples', itemRevision: 1 });
    expect(counter()).toBe(versionBefore);
    expect(receipts()).toEqual([]);
    expect(journal(ITEM)).toEqual([]);
  });
});

describe('ItemService.mutate no-op', () => {
  it('accepts matching values without advancing revision, version, journal or events', () => {
    const response = accepted(
      mutate(1, 1, { name: 'Apples', crossedOff: false }),
    );

    expect(response).toMatchObject({
      itemRevision: 1,
      version: START_VERSION,
      appliedFields: [],
      conflicts: [],
      replayed: false,
    });
    expect(counter()).toBe(START_VERSION);
    expect(journal(ITEM)).toEqual([]);
    expect(published).toEqual([]);
    expect(receipts()).toHaveLength(1);
  });

  it('returns the stored outcome with replayed true on retry and still does not advance', () => {
    mutate(1, 1, { crossedOff: false });

    const replay = accepted(mutate(1, 1, { crossedOff: false }));

    expect(replay).toMatchObject({
      replayed: true,
      itemRevision: 1,
      version: START_VERSION,
      appliedFields: [],
    });
    expect(counter()).toBe(START_VERSION);
    expect(journal(ITEM)).toEqual([]);
    expect(receipts()).toHaveLength(1);
  });
});

describe('ItemService.mutate idempotency', () => {
  it('applies a retried mutation once and replays the recorded outcome with current state', () => {
    accepted(mutate(1, 1, { crossedOff: true }));
    accepted(mutate(2, 2, { name: 'Later name' }));

    const replay = accepted(mutate(1, 1, { crossedOff: true }));

    expect(replay).toMatchObject({
      replayed: true,
      appliedFields: ['crossedOff'],
      conflicts: [],
      itemRevision: 3,
    });
    expect(replay.item.name).toBe('Later name');
    expect(journal(ITEM)).toHaveLength(2);
    expect(counter()).toBe(START_VERSION + 2);
  });

  it('replays a recorded conflict with its original attempted and server values', () => {
    accepted(mutate(1, 1, { name: 'Online name' }));
    accepted(mutate(2, 1, { name: 'Offline name' }));
    accepted(mutate(3, 2, { name: 'Even newer' }));

    const replay = accepted(mutate(2, 1, { name: 'Offline name' }));

    expect(replay.replayed).toBe(true);
    expect(replay.conflicts).toEqual([
      {
        field: 'name',
        attemptedValue: 'Offline name',
        serverValue: 'Online name',
      },
    ]);
  });

  it('still replays after the journal is pruned and the base is expired', () => {
    accepted(mutate(1, 1, { crossedOff: true }));
    clock = NOW + 26 * HOUR;
    new MaintenanceService(db, () => clock).pruneItemJournal();

    const replay = accepted(mutate(1, 1, { crossedOff: true }));

    expect(replay.replayed).toBe(true);
    expect(journal(ITEM)).toEqual([]);
  });

  it('does not publish an event for a replay', () => {
    accepted(mutate(1, 1, { crossedOff: true }));
    published.length = 0;

    mutate(1, 1, { crossedOff: true });

    expect(published).toEqual([]);
  });

  it('replays a mutation whose item was soft-deleted afterwards', () => {
    accepted(mutate(1, 1, { crossedOff: true }));
    service.delete(H1, LIST_1, ITEM, iso(NOW));

    const replay = accepted(mutate(1, 1, { crossedOff: true }));

    expect(replay.replayed).toBe(true);
    expect(replay.item.deletedAt).not.toBeNull();
  });

  it.each([
    ['a different patch', 1, { crossedOff: false }, ITEM],
    ['a different patch field', 1, { name: 'Other' }, ITEM],
    ['a different base revision', 2, { crossedOff: true }, ITEM],
    ['a different item', 1, { crossedOff: true }, 'item-2'],
  ] as const)(
    'rejects reuse of a mutation id with %s and changes nothing',
    (_label, base, changes, itemId) => {
      addItem('item-2', LIST_1, H1, 'Milk');
      accepted(mutate(1, 1, { crossedOff: true }));
      const versionBefore = counter();
      const journalBefore = journal(ITEM);

      const result = rejected(mutate(1, base, changes, { itemId }));

      expect(result.code).toBe('MUTATION_ID_REUSED');
      expect(result.item.id).toBe(itemId);
      expect(counter()).toBe(versionBefore);
      expect(journal(ITEM)).toEqual(journalBefore);
      expect(receipts()).toHaveLength(1);
    },
  );

  it('keeps receipts independent per household for the same mutation id', () => {
    accepted(mutate(1, 1, { crossedOff: true }));

    const other = accepted(
      mutate(
        1,
        1,
        { crossedOff: true },
        { householdId: H2, listId: LIST_OTHER, itemId: ITEM_OTHER_HOUSEHOLD },
      ),
    );

    expect(other.replayed).toBe(false);
    expect(other.item.id).toBe(ITEM_OTHER_HOUSEHOLD);
    expect(receipts().map((r) => r.householdId)).toEqual([H1, H2]);
  });
});

describe('ItemService.mutate base revision', () => {
  beforeEach(() => {
    db.update(listItem)
      .set({ itemRevision: 6, prunedThroughItemRevision: 5 })
      .where(eq(listItem.id, ITEM))
      .run();
  });

  it('rejects a base below the pruning watermark with the current state and applies nothing', () => {
    const result = rejected(mutate(1, 4, { crossedOff: true }));

    expect(result).toMatchObject({
      code: 'BASE_VERSION_EXPIRED',
      itemRevision: 6,
      version: START_VERSION,
    });
    expect(result.item).toMatchObject({ id: ITEM, itemRevision: 6 });
    expect(itemRow(ITEM).crossedOffAt).toBeNull();
    expect(receipts()).toEqual([]);
    expect(counter()).toBe(START_VERSION);
  });

  it('accepts a base equal to the pruning watermark', () => {
    const response = accepted(mutate(1, 5, { crossedOff: true }));

    expect(response.itemRevision).toBe(7);
  });

  it('rejects a base ahead of the current revision and applies nothing', () => {
    const result = rejected(mutate(1, 7, { crossedOff: true }));

    expect(result).toMatchObject({
      code: 'BASE_VERSION_AHEAD',
      itemRevision: 6,
      version: START_VERSION,
    });
    expect(itemRow(ITEM).crossedOffAt).toBeNull();
    expect(receipts()).toEqual([]);
  });

  it('accepts a retry of a rejected mutation once the base is valid', () => {
    rejected(mutate(1, 4, { crossedOff: true }));

    const response = accepted(mutate(1, 6, { crossedOff: true }));

    expect(response.replayed).toBe(false);
  });
});

describe('ItemService.mutate authorization and lookup', () => {
  it('returns 404 for a missing item', () => {
    expect(
      thrownStatus(() =>
        mutate(1, 1, { crossedOff: true }, { itemId: 'nope' }),
      ),
    ).toBe(404);
  });

  it('returns 404 for a soft-deleted item without a receipt', () => {
    service.delete(H1, LIST_1, ITEM, iso(NOW));

    expect(thrownStatus(() => mutate(1, 1, { crossedOff: true }))).toBe(404);
    expect(receipts()).toEqual([]);
  });

  it('returns 404 for a soft-deleted list of the household', () => {
    addList('gone', H1, 5);

    expect(
      thrownStatus(() =>
        mutate(1, 1, { crossedOff: true }, { listId: 'gone' }),
      ),
    ).toBe(404);
  });

  it('returns 403 for a list of another household before any item lookup', () => {
    const queries = recordQueries();

    expect(
      thrownStatus(() =>
        mutate(
          1,
          1,
          { crossedOff: true },
          { listId: LIST_OTHER, itemId: ITEM_OTHER_HOUSEHOLD },
        ),
      ),
    ).toBe(403);
    expect(touching(queries, 'list_item')).toEqual([]);
    expect(touching(queries, 'item_change')).toEqual([]);
    expect(touching(queries, 'item_mutation_receipt')).toEqual([]);
    expect(itemRow(ITEM_OTHER_HOUSEHOLD).itemRevision).toBe(1);
    expect(receipts()).toEqual([]);
  });

  it("returns 404, as for a missing item, for another household's item addressed through an own list", () => {
    const missing = thrownStatus(() =>
      mutate(1, 1, { crossedOff: true }, { itemId: 'nope' }),
    );
    const queries = recordQueries();

    const status = thrownStatus(() =>
      mutate(1, 1, { crossedOff: true }, { itemId: ITEM_OTHER_HOUSEHOLD }),
    );

    expect(status).toBe(404);
    expect(status).toBe(missing);
    const itemReads = touching(queries, 'list_item');
    expect(itemReads).toHaveLength(1);
    expect(itemReads[0]?.sql).toContain('"household_id" = ?');
    expect(itemReads[0]?.sql).toContain('"list_id" = ?');
    expect(itemReads[0]?.params).toEqual([ITEM_OTHER_HOUSEHOLD, H1, LIST_1]);
    expect(touching(queries, 'item_change')).toEqual([]);
    expect(touching(queries, 'item_mutation_receipt')).toEqual([]);
    expect(itemRow(ITEM_OTHER_HOUSEHOLD).crossedOffAt).toBeNull();
    expect(receipts()).toEqual([]);
  });

  it('makes one household, list and item scoped item read for a missing item and reads no journal or receipt', () => {
    const queries = recordQueries();

    expect(
      thrownStatus(() =>
        mutate(1, 1, { crossedOff: true }, { itemId: 'nope' }),
      ),
    ).toBe(404);

    const itemReads = touching(queries, 'list_item');
    expect(itemReads).toHaveLength(1);
    expect(itemReads[0]?.params).toEqual(['nope', H1, LIST_1]);
    expect(touching(queries, 'item_change')).toEqual([]);
    expect(touching(queries, 'item_mutation_receipt')).toEqual([]);
  });

  it('scopes the item lookup and the update to the household and list', () => {
    const queries = recordQueries();

    accepted(mutate(1, 1, { crossedOff: true }));

    const itemQueries = touching(queries, 'list_item');
    const select = itemQueries.find((q) => q.sql.startsWith('select'));
    const update = itemQueries.find((q) => q.sql.startsWith('update'));
    expect(select?.params).toEqual(expect.arrayContaining([ITEM, H1, LIST_1]));
    expect(update?.sql).toContain('"household_id" = ?');
    expect(update?.sql).toContain('"list_id" = ?');
    expect(update?.params).toEqual(expect.arrayContaining([ITEM, H1, LIST_1]));
  });

  it('returns 403 for a household that does not own the addressed list', () => {
    expect(
      thrownStatus(() =>
        mutate(1, 1, { crossedOff: true }, { householdId: H2 }),
      ),
    ).toBe(403);
    expect(itemRow(ITEM).crossedOffAt).toBeNull();
  });

  it('returns the same 404 as for a missing item for an item of another list of the household', () => {
    const missing = thrownStatus(() =>
      mutate(1, 1, { crossedOff: true }, { listId: LIST_2, itemId: 'nope' }),
    );
    const queries = recordQueries();

    const status = thrownStatus(() =>
      mutate(1, 1, { crossedOff: true }, { listId: LIST_2 }),
    );

    expect(status).toBe(404);
    expect(status).toBe(missing);
    const itemReads = touching(queries, 'list_item');
    expect(itemReads).toHaveLength(1);
    expect(itemReads[0]?.params).toEqual([ITEM, H1, LIST_2]);
    expect(touching(queries, 'item_change')).toEqual([]);
    expect(touching(queries, 'item_mutation_receipt')).toEqual([]);
    expect(itemRow(ITEM)).toMatchObject({
      crossedOffAt: null,
      itemRevision: 1,
    });
    expect(receipts()).toEqual([]);
  });

  it("ignores another household's journal when computing conflicts", () => {
    db.insert(itemChange)
      .values({
        itemId: ITEM,
        householdId: H2,
        itemRevision: 5,
        mutationId: 'foreign',
        fields: '["name"]',
        createdAt: NOW,
      })
      .run();

    const response = accepted(mutate(1, 1, { name: 'Mine' }));

    expect(response.conflicts).toEqual([]);
    expect(response.appliedFields).toEqual(['name']);
  });
});

describe('ItemService.mutate atomicity', () => {
  const assertUntouched = (versionBefore: number) => {
    expect(itemRow(ITEM)).toMatchObject({
      crossedOffAt: null,
      itemRevision: 1,
      version: START_VERSION,
    });
    expect(counter()).toBe(versionBefore);
    expect(journal(ITEM)).toEqual([]);
    expect(receipts()).toEqual([]);
    expect(published).toEqual([]);
  };

  it('rolls back the row, version, journal and receipt when the journal write fails', () => {
    db.$client.exec(
      "CREATE TRIGGER fail_journal BEFORE INSERT ON item_change BEGIN SELECT RAISE(ABORT, 'journal failed'); END",
    );

    expect(() => mutate(1, 1, { crossedOff: true })).toThrow('journal failed');

    assertUntouched(START_VERSION);
  });

  it('rolls back the row, version and journal when the receipt write fails', () => {
    db.$client.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON item_mutation_receipt BEGIN SELECT RAISE(ABORT, 'receipt failed'); END",
    );

    expect(() => mutate(1, 1, { crossedOff: true })).toThrow('receipt failed');

    assertUntouched(START_VERSION);
  });
});

describe('ItemService.put item revision', () => {
  it('creates an item at revision 1 with no journal entry', () => {
    const result = service.put(H1, LIST_1, 'new-item', putBody('Bread'));

    expect(result.item.itemRevision).toBe(1);
    expect(journal('new-item')).toEqual([]);
  });

  it('advances the revision and journals the changed fields on a rename', () => {
    const result = service.put(H1, LIST_1, ITEM, putBody('Granny Smith'));

    expect(result.item.itemRevision).toBe(2);
    expect(result.item.version).toBe(START_VERSION + 1);
    expect(journal(ITEM)).toMatchObject([
      { itemRevision: 2, fields: '["name"]', householdId: H1, createdAt: NOW },
    ]);
    expect(journal(ITEM)[0]?.mutationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('journals both fields when a PUT changes name and crossedOff', () => {
    service.put(H1, LIST_1, ITEM, putBody('Pears', true));

    expect(journal(ITEM)[0]?.fields).toBe('["name","crossedOff"]');
  });

  it('keeps the revision and journal when a PUT only revives a deleted item', () => {
    service.delete(H1, LIST_1, ITEM, iso(NOW));

    const result = service.put(H1, LIST_1, ITEM, putBody('Apples'));

    expect(result.applied).toBe(true);
    expect(result.item.itemRevision).toBe(1);
    expect(journal(ITEM)).toEqual([]);
  });

  it('keeps the revision when the PUT is an ignored no-op', () => {
    const result = service.put(H1, LIST_1, ITEM, putBody('Apples'));

    expect(result.applied).toBe(false);
    expect(result.item.itemRevision).toBe(1);
    expect(journal(ITEM)).toEqual([]);
  });

  it('advances the revision and journals crossedOff when a same-name create merges into a live item', () => {
    const result = service.put(
      H1,
      LIST_1,
      'duplicate',
      putBody('apples', true),
    );

    expect(result.mergedFromId).toBe('duplicate');
    expect(result.item.itemRevision).toBe(2);
    expect(journal(ITEM)).toMatchObject([
      { itemRevision: 2, fields: '["crossedOff"]' },
    ]);
  });

  it('does not touch the revision when soft-deleting', () => {
    service.delete(H1, LIST_1, ITEM, iso(NOW));

    expect(itemRow(ITEM).itemRevision).toBe(1);
    expect(journal(ITEM)).toEqual([]);
  });
});

describe('ItemService.put authorization and lookup', () => {
  const put = (
    itemId: string,
    body: PutItemBody,
    target: { householdId?: string; listId?: string } = {},
  ) =>
    service.put(
      target.householdId ?? H1,
      target.listId ?? LIST_1,
      itemId,
      body,
    );

  const itemCount = () => db.select().from(listItem).all().length;

  it('returns 403 for a list of another household before any item, journal or receipt lookup', () => {
    const queries = recordQueries();

    expect(
      thrownStatus(() =>
        put(ITEM_OTHER_HOUSEHOLD, putBody('Plums'), { listId: LIST_OTHER }),
      ),
    ).toBe(403);

    expect(touching(queries, 'list_item')).toEqual([]);
    expect(touching(queries, 'item_change')).toEqual([]);
    expect(touching(queries, 'item_mutation_receipt')).toEqual([]);
    expect(itemRow(ITEM_OTHER_HOUSEHOLD).name).toBe('Pears');
  });

  it("returns 404 for another household's item id addressed through an own list and changes nothing", () => {
    const queries = recordQueries();

    const status = thrownStatus(() =>
      put(ITEM_OTHER_HOUSEHOLD, putBody('Plums', true)),
    );

    expect(status).toBe(404);
    const itemSelects = touching(queries, 'list_item').filter((q) =>
      q.sql.startsWith('select'),
    );
    expect(itemSelects[0]?.sql).toContain('"household_id" = ?');
    expect(itemSelects[0]?.sql).toContain('"list_id" = ?');
    expect(itemSelects[0]?.params).toEqual([ITEM_OTHER_HOUSEHOLD, H1, LIST_1]);
    expect(itemRow(ITEM_OTHER_HOUSEHOLD)).toMatchObject({
      householdId: H2,
      listId: LIST_OTHER,
      name: 'Pears',
      crossedOffAt: null,
      itemRevision: 1,
    });
    expect(itemCount()).toBe(2);
    expect(journal(ITEM_OTHER_HOUSEHOLD)).toEqual([]);
    expect(counter()).toBe(START_VERSION);
    expect(published).toEqual([]);
    expect(db.select().from(itemSuggestion).all()).toEqual([]);
  });

  it('returns 404 for an item id of another list of the household and changes nothing', () => {
    const status = thrownStatus(() =>
      put(ITEM, putBody('Apples', true), { listId: LIST_2 }),
    );

    expect(status).toBe(404);
    expect(itemRow(ITEM)).toMatchObject({
      listId: LIST_1,
      crossedOffAt: null,
      itemRevision: 1,
    });
    expect(itemCount()).toBe(2);
    expect(journal(ITEM)).toEqual([]);
    expect(counter()).toBe(START_VERSION);
    expect(published).toEqual([]);
  });

  it('answers a foreign item id and an own-household other-list item id with the same status and body', () => {
    const errorOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err as HTTPException;
      }
      throw new Error('expected the put to throw');
    };

    const foreign = errorOf(() => put(ITEM_OTHER_HOUSEHOLD, putBody('Plums')));
    const otherList = errorOf(() =>
      put(ITEM, putBody('Plums'), { listId: LIST_2 }),
    );

    expect(foreign.status).toBe(404);
    expect(otherList.status).toBe(404);
    expect(foreign.message).toBe(otherList.message);
  });

  it.each([
    ['a foreign item id', ITEM_OTHER_HOUSEHOLD, LIST_1],
    ['an other-list item id', ITEM, LIST_2],
  ])(
    'answers a same-name create with %s like a missing-scope id and leaves the local item untouched',
    async (_label, id, listId) => {
      addItem('local-pears', listId, H1, 'Pears');
      const errorOf = (fn: () => unknown) => {
        try {
          fn();
        } catch (err) {
          return err as HTTPException;
        }
        throw new Error('expected the put to throw');
      };
      const items = db.select().from(listItem).all();
      const suggestions = db.select().from(itemSuggestion).all();

      const collided = errorOf(() =>
        put(id, putBody('pears', true), { listId }),
      );
      const plain = errorOf(() => put(id, putBody('Plums'), { listId }));

      expect(collided.status).toBe(404);
      expect(collided.status).toBe(plain.status);
      expect(await collided.getResponse().text()).toBe(
        await plain.getResponse().text(),
      );
      expect(db.select().from(listItem).all()).toEqual(items);
      expect(itemRow('local-pears')).toMatchObject({
        crossedOffAt: null,
        version: START_VERSION,
        itemRevision: 1,
      });
      expect(counter()).toBe(START_VERSION);
      expect(db.select().from(itemChange).all()).toEqual([]);
      expect(db.select().from(itemSuggestion).all()).toEqual(suggestions);
      expect(published).toEqual([]);
    },
  );

  it('merges an unused id with a same-name local item as before and leaves no candidate row', () => {
    const result = put('unused', putBody('apples', true));

    expect(result).toMatchObject({
      created: false,
      applied: true,
      mergedFromId: 'unused',
    });
    expect(result.item).toMatchObject({
      id: ITEM,
      name: 'Apples',
      itemRevision: 2,
      version: START_VERSION + 1,
    });
    expect(
      db.select().from(listItem).where(eq(listItem.id, 'unused')).all(),
    ).toEqual([]);
    expect(counter()).toBe(START_VERSION + 1);
    expect(journal(ITEM)).toMatchObject([
      { itemRevision: 2, fields: '["crossedOff"]' },
    ]);
    expect(db.select().from(itemSuggestion).all()).toEqual([]);
    expect(published).toEqual([START_VERSION + 1]);
  });

  it('does not advance the cursor or leave a candidate when the same-name merge is a no-op', () => {
    const before = db.select().from(listItem).all();

    const result = put('unused', putBody('apples', false));

    expect(result).toMatchObject({
      created: false,
      applied: false,
      mergedFromId: 'unused',
    });
    expect(db.select().from(listItem).all()).toEqual(before);
    expect(counter()).toBe(START_VERSION);
    expect(published).toEqual([]);
  });

  it('creates an item for an unused id on an authorized list under exactly one version', () => {
    const result = put('fresh', putBody('Bread'));

    expect(result).toMatchObject({ created: true, applied: true });
    expect(result.item).toMatchObject({
      id: 'fresh',
      name: 'Bread',
      version: START_VERSION + 1,
      itemRevision: 1,
      deletedAt: null,
    });
    expect(itemRow('fresh')).toMatchObject({
      householdId: H1,
      listId: LIST_1,
      createdAt: NOW,
      deletedAt: null,
    });
    expect(counter()).toBe(START_VERSION + 1);
    expect(journal('fresh')).toEqual([]);
    expect(db.select().from(itemSuggestion).all()).toMatchObject([
      { householdId: H1, nameKey: 'bread', useCount: 1 },
    ]);
    expect(published).toEqual([START_VERSION + 1]);
  });

  it('never reads a list item by id alone, even when the id is taken elsewhere', () => {
    addItem('local-pears', LIST_1, H1, 'Pears');
    const queries = recordQueries();

    thrownStatus(() => put(ITEM_OTHER_HOUSEHOLD, putBody('pears')));

    const selects = touching(queries, 'list_item').filter((q) =>
      q.sql.startsWith('select'),
    );
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select.sql).toContain('"list_id" = ?');
      expect(select.params).not.toEqual([ITEM_OTHER_HOUSEHOLD]);
    }
    const reservation = touching(queries, 'list_item').filter((q) =>
      q.sql.startsWith('insert'),
    );
    expect(reservation).toHaveLength(1);
    expect(reservation[0]?.sql).toMatch(/on conflict \(.*"id".*\) do nothing/);
  });

  it('still updates an existing item of the addressed list', () => {
    const result = put(ITEM, putBody('Granny Smith'));

    expect(result).toMatchObject({ created: false, applied: true });
    expect(itemRow(ITEM).name).toBe('Granny Smith');
  });

  it('returns 404 for a soft-deleted list of the household', () => {
    addList('gone', H1, 5);

    expect(
      thrownStatus(() => put('fresh', putBody('Bread'), { listId: 'gone' })),
    ).toBe(404);
    expect(itemCount()).toBe(2);
  });
});
