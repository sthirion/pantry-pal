import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/database.js';
import {
  listItem,
  maintenanceState,
  shoppingList,
  syncState,
} from '../db/schema.js';

export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;
const STATE_ID = 1;

export interface PurgeResult {
  lists: number;
  items: number;
}

export class MaintenanceService {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Hard-deletes lists and items soft-deleted more than 30 days ago, records the highest purged version
   * per household as its purge horizon, and stores the run time.
   */
  purgeTombstones(): PurgeResult {
    const runAt = this.now();
    const cutoff = runAt - TOMBSTONE_RETENTION_MS;
    return this.db.transaction((tx) => {
      const itemCondition = and(
        isNotNull(listItem.deletedAt),
        lt(listItem.deletedAt, cutoff),
      );
      const expiredItems = tx
        .select({
          householdId: listItem.householdId,
          version: listItem.version,
        })
        .from(listItem)
        .where(itemCondition)
        .all();
      tx.delete(listItem).where(itemCondition).run();

      // A list is kept while any item still references it (foreign key).
      const listCondition = and(
        isNotNull(shoppingList.deletedAt),
        lt(shoppingList.deletedAt, cutoff),
        sql`not exists (select 1 from ${listItem} where ${listItem.listId} = ${shoppingList.id})`,
      );
      const expiredLists = tx
        .select({
          householdId: shoppingList.householdId,
          version: shoppingList.version,
        })
        .from(shoppingList)
        .where(listCondition)
        .all();
      tx.delete(shoppingList).where(listCondition).run();

      const horizons = new Map<string, number>();
      for (const row of [...expiredItems, ...expiredLists]) {
        horizons.set(
          row.householdId,
          Math.max(horizons.get(row.householdId) ?? 0, row.version),
        );
      }
      for (const [householdId, purgedThroughVersion] of horizons) {
        tx.insert(syncState)
          .values({ householdId, purgedThroughVersion })
          .onConflictDoUpdate({
            target: syncState.householdId,
            set: {
              purgedThroughVersion: sql`max(${syncState.purgedThroughVersion}, ${purgedThroughVersion})`,
            },
          })
          .run();
      }

      tx.insert(maintenanceState)
        .values({ id: STATE_ID, lastRunAt: runAt })
        .onConflictDoUpdate({
          target: maintenanceState.id,
          set: { lastRunAt: runAt },
        })
        .run();

      return { lists: expiredLists.length, items: expiredItems.length };
    });
  }

  /** True when the purge never ran or last ran more than 24 hours ago. */
  isOverdue(): boolean {
    const row = this.db
      .select({ lastRunAt: maintenanceState.lastRunAt })
      .from(maintenanceState)
      .where(eq(maintenanceState.id, STATE_ID))
      .get();
    return !row || this.now() - row.lastRunAt > OVERDUE_AFTER_MS;
  }
}

/** Milliseconds from `nowMs` until the next 03:30 UTC (always positive). */
export function msUntilNextRun(nowMs: number): number {
  const d = new Date(nowMs);
  let next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    3,
    30,
  );
  if (next <= nowMs) next += 24 * 60 * 60 * 1000;
  return next - nowMs;
}

export interface SchedulerOptions {
  now?: () => number;
  onError?: (error: unknown) => void;
}

/**
 * Runs the purge at startup when overdue and then daily at 03:30 UTC. Returns a function that stops it.
 */
export function startMaintenanceScheduler(
  service: MaintenanceService,
  { now = Date.now, onError = console.error }: SchedulerOptions = {},
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const report = (error: unknown) => {
    try {
      onError(error);
    } catch {
      // A failing error handler must never break the scheduler.
    }
  };
  const run = () => {
    try {
      service.purgeTombstones();
    } catch (error) {
      report(error);
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      try {
        run();
      } finally {
        schedule();
      }
    }, msUntilNextRun(now()));
    timer.unref();
  };

  try {
    if (service.isOverdue()) run();
  } catch (error) {
    report(error);
  }
  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
