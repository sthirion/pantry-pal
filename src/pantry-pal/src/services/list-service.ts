import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { nameKey } from '@pantry-pal/shared';
import type { PutListBody, ShoppingList } from '@pantry-pal/shared';
import { nextVersion } from '../db/change-counter.js';
import type { AppDatabase, AppTransaction } from '../db/database.js';
import { listItem, shoppingList } from '../db/schema.js';
import type { HouseholdEventHub } from '../realtime/household-event-hub.js';

type ListRow = typeof shoppingList.$inferSelect;

export interface PutListResult {
  created: boolean;
  list: ShoppingList;
  applied: boolean;
  mergedFromId?: string;
}

export type DeleteListResult =
  | { status: 'deleted' }
  | { status: 'stale'; list: ShoppingList };

/** What a write transaction returns; `version` is set only when a new shared version was assigned. */
interface Outcome<T> {
  result: T;
  version?: number;
}

export function toShoppingList(row: ListRow): ShoppingList {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
    deletedAt:
      row.deletedAt === null ? null : new Date(row.deletedAt).toISOString(),
  };
}

function findList(tx: AppTransaction, id: string): ListRow | undefined {
  return tx.select().from(shoppingList).where(eq(shoppingList.id, id)).get();
}

function findLiveByKey(
  tx: AppTransaction,
  householdId: string,
  key: string,
  excludeId?: string,
): ListRow | undefined {
  return tx
    .select()
    .from(shoppingList)
    .where(
      and(
        eq(shoppingList.householdId, householdId),
        eq(shoppingList.nameKey, key),
        isNull(shoppingList.deletedAt),
        excludeId === undefined ? undefined : ne(shoppingList.id, excludeId),
      ),
    )
    .get();
}

export class ListService {
  constructor(
    private readonly db: AppDatabase,
    private readonly hub: HouseholdEventHub,
    private readonly now: () => number = Date.now,
  ) {}

  /** Upsert by client id with last-write-wins, same-name merge and rename conflict detection. */
  put(householdId: string, listId: string, body: PutListBody): PutListResult {
    const changedAt = this.clamp(body.changedAt);
    const key = nameKey(body.name);
    const outcome = this.db.transaction((tx): Outcome<PutListResult> => {
      const existing = findList(tx, listId);
      if (existing) {
        if (existing.householdId !== householdId) {
          throw new HTTPException(403);
        }
        return this.putExisting(tx, existing, body.name, key, changedAt);
      }
      const sameName = findLiveByKey(tx, householdId, key);
      if (sameName) return this.merge(tx, sameName, listId, changedAt);
      return this.create(tx, householdId, listId, body.name, key, changedAt);
    });
    this.publish(householdId, outcome);
    return outcome.result;
  }

  /** Soft-deletes a list and its live items; repeats and unknown ids are no-ops. */
  delete(
    householdId: string,
    listId: string,
    changedAtIso: string,
  ): DeleteListResult {
    const changedAt = this.clamp(changedAtIso);
    const outcome = this.db.transaction((tx): Outcome<DeleteListResult> => {
      const existing = findList(tx, listId);
      if (!existing) return { result: { status: 'deleted' } };
      if (existing.householdId !== householdId) throw new HTTPException(403);
      if (existing.deletedAt !== null) return { result: { status: 'deleted' } };
      if (changedAt < existing.updatedAt) {
        return {
          result: { status: 'stale', list: toShoppingList(existing) },
        };
      }
      const version = nextVersion(tx);
      tx.update(shoppingList)
        .set({ deletedAt: changedAt, updatedAt: changedAt, version })
        .where(eq(shoppingList.id, listId))
        .run();
      tx.update(listItem)
        .set({
          deletedAt: changedAt,
          updatedAt: sql`max(${listItem.updatedAt}, ${changedAt})`,
          version,
        })
        .where(and(eq(listItem.listId, listId), isNull(listItem.deletedAt)))
        .run();
      return { result: { status: 'deleted' }, version };
    });
    this.publish(householdId, outcome);
    return outcome.result;
  }

  private clamp(changedAtIso: string): number {
    return Math.min(Date.parse(changedAtIso), this.now());
  }

  private publish(householdId: string, outcome: Outcome<unknown>): void {
    if (outcome.version !== undefined) {
      this.hub.publish(householdId, outcome.version);
    }
  }

  private putExisting(
    tx: AppTransaction,
    existing: ListRow,
    name: string,
    key: string,
    changedAt: number,
  ): Outcome<PutListResult> {
    // An identical replay of a live list changes nothing, even with an equal or newer timestamp.
    const ignored =
      changedAt < existing.updatedAt ||
      (existing.deletedAt === null && existing.name === name);
    if (ignored) {
      return {
        result: {
          created: false,
          list: toShoppingList(existing),
          applied: false,
        },
      };
    }
    if (findLiveByKey(tx, existing.householdId, key, existing.id)) {
      throw new HTTPException(409);
    }
    const version = nextVersion(tx);
    const row = tx
      .update(shoppingList)
      .set({
        name,
        nameKey: key,
        updatedAt: changedAt,
        deletedAt: null,
        version,
      })
      .where(eq(shoppingList.id, existing.id))
      .returning()
      .get();
    return {
      result: { created: false, list: toShoppingList(row), applied: true },
      version,
    };
  }

  /** Applies the create to the live same-name list; its display name is kept as stored. */
  private merge(
    tx: AppTransaction,
    target: ListRow,
    requestedId: string,
    changedAt: number,
  ): Outcome<PutListResult> {
    if (changedAt < target.updatedAt) {
      return {
        result: {
          created: false,
          list: toShoppingList(target),
          applied: false,
          mergedFromId: requestedId,
        },
      };
    }
    const version = nextVersion(tx);
    const row = tx
      .update(shoppingList)
      .set({ updatedAt: changedAt, version })
      .where(eq(shoppingList.id, target.id))
      .returning()
      .get();
    return {
      result: {
        created: false,
        list: toShoppingList(row),
        applied: true,
        mergedFromId: requestedId,
      },
      version,
    };
  }

  private create(
    tx: AppTransaction,
    householdId: string,
    id: string,
    name: string,
    key: string,
    changedAt: number,
  ): Outcome<PutListResult> {
    const version = nextVersion(tx);
    const row = tx
      .insert(shoppingList)
      .values({
        id,
        householdId,
        name,
        nameKey: key,
        version,
        createdAt: this.now(),
        updatedAt: changedAt,
        deletedAt: null,
      })
      .returning()
      .get();
    return {
      result: { created: true, list: toShoppingList(row), applied: true },
      version,
    };
  }
}
