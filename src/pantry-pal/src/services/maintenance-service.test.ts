import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, openSqlite, runMigrations } from '../db/database.js';
import type { AppDatabase } from '../db/database.js';
import {
  itemChange,
  listItem,
  maintenanceState,
  shoppingList,
  syncState,
} from '../db/schema.js';
import {
  JOURNAL_PRUNE_INTERVAL_MS,
  MaintenanceService,
  msUntilNextRun,
  startJournalPruneScheduler,
  startMaintenanceScheduler,
} from './maintenance-service.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-13T12:00:00.000Z');

let db: AppDatabase;
let clock: number;
let service: MaintenanceService;

function addList(
  id: string,
  householdId: string,
  version: number,
  deletedAt: number | null,
) {
  db.insert(shoppingList)
    .values({
      id,
      householdId,
      name: id,
      nameKey: id,
      version,
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
  version: number,
  deletedAt: number | null,
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
      updatedAt: 1,
      deletedAt,
    })
    .run();
}

const listIds = () =>
  db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .all()
    .map((r) => r.id)
    .sort();
const itemIds = () =>
  db
    .select({ id: listItem.id })
    .from(listItem)
    .all()
    .map((r) => r.id)
    .sort();
const horizon = (householdId: string) =>
  db
    .select()
    .from(syncState)
    .all()
    .find((r) => r.householdId === householdId)?.purgedThroughVersion;

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  clock = NOW;
  service = new MaintenanceService(db, () => clock);
});

describe('MaintenanceService.purgeTombstones', () => {
  it('removes rows deleted 31 days ago and keeps rows deleted 29 days ago', () => {
    addList('live', 'h1', 1, null);
    addList('old-list', 'h1', 2, NOW - 31 * DAY);
    addList('new-list', 'h1', 3, NOW - 29 * DAY);
    addItem('old-item', 'live', 'h1', 4, NOW - 31 * DAY);
    addItem('new-item', 'live', 'h1', 5, NOW - 29 * DAY);
    addItem('live-item', 'live', 'h1', 6, null);

    const result = service.purgeTombstones();

    expect(result).toEqual({ lists: 1, items: 1 });
    expect(listIds()).toEqual(['live', 'new-list']);
    expect(itemIds()).toEqual(['live-item', 'new-item']);
  });

  it('keeps a row deleted exactly 30 days ago', () => {
    addList('edge', 'h1', 1, NOW - 30 * DAY);

    service.purgeTombstones();

    expect(listIds()).toEqual(['edge']);
  });

  it('records the highest purged version per household as the horizon', () => {
    addList('a', 'h1', 2, NOW - 40 * DAY);
    addItem('b', 'a', 'h1', 7, NOW - 40 * DAY);
    addList('c', 'h2', 4, NOW - 40 * DAY);
    addList('d', 'h3', 9, NOW - 1 * DAY);

    service.purgeTombstones();

    expect(horizon('h1')).toBe(7);
    expect(horizon('h2')).toBe(4);
    expect(horizon('h3')).toBeUndefined();
  });

  it('never lowers an existing horizon', () => {
    db.insert(syncState)
      .values({ householdId: 'h1', purgedThroughVersion: 50 })
      .run();
    addList('a', 'h1', 2, NOW - 40 * DAY);

    service.purgeTombstones();

    expect(horizon('h1')).toBe(50);
  });

  it('raises an existing lower horizon', () => {
    db.insert(syncState)
      .values({ householdId: 'h1', purgedThroughVersion: 1 })
      .run();
    addList('a', 'h1', 8, NOW - 40 * DAY);

    service.purgeTombstones();

    expect(horizon('h1')).toBe(8);
  });

  it('keeps an expired list while a recent item still references it', () => {
    addList('old-list', 'h1', 2, NOW - 40 * DAY);
    addItem('recent', 'old-list', 'h1', 3, NOW - 1 * DAY);

    const result = service.purgeTombstones();

    expect(result).toEqual({ lists: 0, items: 0 });
    expect(listIds()).toEqual(['old-list']);
    expect(horizon('h1')).toBeUndefined();
  });

  it('does nothing but record the run when there is nothing to purge', () => {
    expect(service.purgeTombstones()).toEqual({ lists: 0, items: 0 });
    expect(db.select().from(syncState).all()).toEqual([]);
    expect(db.select().from(maintenanceState).all()).toEqual([
      { id: 1, lastRunAt: NOW },
    ]);
  });

  it('updates the single last-run row on a repeat run', () => {
    service.purgeTombstones();
    clock = NOW + DAY;
    service.purgeTombstones();

    expect(db.select().from(maintenanceState).all()).toEqual([
      { id: 1, lastRunAt: NOW + DAY },
    ]);
  });
});

describe('MaintenanceService.isOverdue', () => {
  it('is overdue when it never ran', () => {
    expect(service.isOverdue()).toBe(true);
  });

  it('is not overdue within 24 hours of the last run', () => {
    service.purgeTombstones();
    clock = NOW + DAY;

    expect(service.isOverdue()).toBe(false);
  });

  it('is overdue after more than 24 hours', () => {
    service.purgeTombstones();
    clock = NOW + DAY + 1;

    expect(service.isOverdue()).toBe(true);
  });
});

describe('msUntilNextRun', () => {
  it('targets 03:30 UTC later the same day', () => {
    expect(msUntilNextRun(Date.parse('2026-11-13T01:00:00.000Z'))).toBe(
      2.5 * 60 * 60 * 1000,
    );
  });

  it('targets the next day once 03:30 UTC has passed', () => {
    expect(msUntilNextRun(Date.parse('2026-11-13T04:30:00.000Z'))).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('waits a full day at exactly 03:30 UTC', () => {
    expect(msUntilNextRun(Date.parse('2026-11-13T03:30:00.000Z'))).toBe(DAY);
  });
});

describe('startMaintenanceScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return () => vi.useRealTimers();
  });

  it('purges at startup when overdue', () => {
    addList('old', 'h1', 1, NOW - 40 * DAY);
    const stop = startMaintenanceScheduler(service, { now: () => NOW });

    expect(listIds()).toEqual([]);
    stop();
  });

  it('does not purge at startup when it ran recently', () => {
    service.purgeTombstones();
    addList('old', 'h1', 1, NOW - 40 * DAY);
    const stop = startMaintenanceScheduler(service, { now: () => NOW });

    expect(listIds()).toEqual(['old']);
    stop();
  });

  it('purges again at the next 03:30 UTC and reschedules', () => {
    service.purgeTombstones();
    const purge = vi.spyOn(service, 'purgeTombstones');
    const stop = startMaintenanceScheduler(service, { now: () => Date.now() });

    vi.advanceTimersByTime(msUntilNextRun(NOW) - 1);
    expect(purge).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(purge).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DAY);
    expect(purge).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops running once the stop function is called', () => {
    service.purgeTombstones();
    const purge = vi.spyOn(service, 'purgeTombstones');
    const stop = startMaintenanceScheduler(service, { now: () => Date.now() });

    stop();
    vi.advanceTimersByTime(3 * DAY);

    expect(purge).not.toHaveBeenCalled();
  });

  it('reports a failed startup purge and keeps scheduling', () => {
    const onError = vi.fn();
    const failure = new Error('boom');
    vi.spyOn(service, 'purgeTombstones').mockImplementation(() => {
      throw failure;
    });
    const stop = startMaintenanceScheduler(service, {
      now: () => Date.now(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(failure);
    vi.advanceTimersByTime(msUntilNextRun(NOW));
    expect(onError).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps scheduling when the error handler itself throws', () => {
    const onError = vi.fn(() => {
      throw new Error('handler down');
    });
    const purge = vi
      .spyOn(service, 'purgeTombstones')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    const stop = startMaintenanceScheduler(service, {
      now: () => Date.now(),
      onError,
    });

    vi.advanceTimersByTime(msUntilNextRun(NOW));
    vi.advanceTimersByTime(DAY);

    expect(purge).toHaveBeenCalledTimes(3);
    stop();
  });

  it('reports a failure to read the overdue state', () => {
    const onError = vi.fn();
    const failure = new Error('db down');
    vi.spyOn(service, 'isOverdue').mockImplementation(() => {
      throw failure;
    });
    const stop = startMaintenanceScheduler(service, { onError });

    expect(onError).toHaveBeenCalledWith(failure);
    stop();
  });
});

function addChange(itemId: string, itemRevision: number, createdAt: number) {
  db.insert(itemChange)
    .values({
      itemId,
      householdId: 'h1',
      itemRevision,
      mutationId: `m-${itemId}-${itemRevision}`,
      fields: '["name"]',
      createdAt,
    })
    .run();
}

const journalRevisions = (itemId: string) =>
  db
    .select({ revision: itemChange.itemRevision })
    .from(itemChange)
    .where(eq(itemChange.itemId, itemId))
    .orderBy(itemChange.itemRevision)
    .all()
    .map((r) => r.revision);
const watermark = (itemId: string) =>
  db.select().from(listItem).where(eq(listItem.id, itemId)).get()
    ?.prunedThroughItemRevision;

describe('MaintenanceService.pruneItemJournal', () => {
  beforeEach(() => {
    addList('l', 'h1', 1, null);
    addItem('a', 'l', 'h1', 2, null);
    addItem('b', 'l', 'h1', 3, null);
  });

  it('deletes entries at least 25 hours old and keeps younger ones', () => {
    addChange('a', 2, NOW - 26 * HOUR);
    addChange('a', 3, NOW - 25 * HOUR);
    addChange('a', 4, NOW - 25 * HOUR + 1);
    addChange('a', 5, NOW - 24 * HOUR);

    expect(service.pruneItemJournal()).toBe(2);
    expect(journalRevisions('a')).toEqual([4, 5]);
  });

  it('raises the watermark to the greatest deleted revision per item', () => {
    addChange('a', 2, NOW - 30 * HOUR);
    addChange('a', 3, NOW - 26 * HOUR);
    addChange('a', 4, NOW - 1 * HOUR);
    addChange('b', 2, NOW - 26 * HOUR);

    service.pruneItemJournal();

    expect(watermark('a')).toBe(3);
    expect(watermark('b')).toBe(2);
  });

  it('leaves the watermark alone for an item with nothing to prune', () => {
    addChange('a', 2, NOW - 1 * HOUR);

    expect(service.pruneItemJournal()).toBe(0);
    expect(watermark('a')).toBe(0);
  });

  it('never lowers an existing watermark', () => {
    db.$client.exec(
      "UPDATE list_item SET pruned_through_item_revision = 9 WHERE id = 'a'",
    );
    addChange('a', 2, NOW - 30 * HOUR);

    service.pruneItemJournal();

    expect(watermark('a')).toBe(9);
  });

  it('rolls back the deletes and watermarks when the watermark update fails', () => {
    addChange('a', 2, NOW - 30 * HOUR);
    db.$client.exec(
      "CREATE TRIGGER fail_watermark BEFORE UPDATE ON list_item BEGIN SELECT RAISE(ABORT, 'watermark failed'); END",
    );

    expect(() => service.pruneItemJournal()).toThrow('watermark failed');
    expect(journalRevisions('a')).toEqual([2]);
    expect(watermark('a')).toBe(0);
  });

  it('rolls back the watermarks when the delete fails', () => {
    addChange('a', 2, NOW - 30 * HOUR);
    db.$client.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON item_change BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
    );

    expect(() => service.pruneItemJournal()).toThrow('delete failed');
    expect(journalRevisions('a')).toEqual([2]);
    expect(watermark('a')).toBe(0);
  });
});

describe('startJournalPruneScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return () => vi.useRealTimers();
  });

  it('prunes at startup and then every hour', () => {
    const prune = vi.spyOn(service, 'pruneItemJournal');
    const stop = startJournalPruneScheduler(service);

    expect(prune).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(JOURNAL_PRUNE_INTERVAL_MS - 1);
    expect(prune).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(prune).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops pruning once the stop function is called', () => {
    const prune = vi.spyOn(service, 'pruneItemJournal');
    const stop = startJournalPruneScheduler(service);

    stop();
    vi.advanceTimersByTime(3 * HOUR);

    expect(prune).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run and keeps scheduling', () => {
    const onError = vi.fn();
    const failure = new Error('boom');
    vi.spyOn(service, 'pruneItemJournal').mockImplementation(() => {
      throw failure;
    });
    const stop = startJournalPruneScheduler(service, { onError });

    vi.advanceTimersByTime(HOUR);

    expect(onError).toHaveBeenCalledWith(failure);
    expect(onError).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps scheduling when the error handler itself throws', () => {
    const prune = vi
      .spyOn(service, 'pruneItemJournal')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    const stop = startJournalPruneScheduler(service, {
      onError: () => {
        throw new Error('handler down');
      },
    });

    vi.advanceTimersByTime(HOUR);

    expect(prune).toHaveBeenCalledTimes(2);
    stop();
  });
});
