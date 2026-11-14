import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { nameKey } from '@pantry-pal/shared';
import type { ListItem, PutItemBody } from '@pantry-pal/shared';
import { nextVersion } from '../db/change-counter.js';
import type { AppDatabase, AppTransaction } from '../db/database.js';
import { itemSuggestion, listItem, shoppingList } from '../db/schema.js';
import { CodedHttpException } from '../errors.js';
import type { HouseholdEventHub } from '../realtime/household-event-hub.js';
import {
  crossedOffAtFor,
  decideDelete,
  isBatchEligible,
  isMergeIgnored,
  isPutIgnored,
  renamesItem,
} from './item-rules.js';

type ItemRow = typeof listItem.$inferSelect;

export interface PutItemResult {
  created: boolean;
  item: ListItem;
  applied: boolean;
  mergedFromId?: string;
}

export type DeleteItemResult =
  | { status: 'deleted' }
  | { status: 'stale'; item: ListItem };

/** What a write transaction returns; `version` is set only when a new shared version was assigned. */
interface Outcome<T> {
  result: T;
  version?: number;
}

export function toListItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    crossedOffAt:
      row.crossedOffAt === null
        ? null
        : new Date(row.crossedOffAt).toISOString(),
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
    deletedAt:
      row.deletedAt === null ? null : new Date(row.deletedAt).toISOString(),
  };
}

function onOtherList(): CodedHttpException {
  return new CodedHttpException(409, 'item_on_other_list');
}

function findLiveByKey(
  tx: AppTransaction,
  listId: string,
  key: string,
  excludeId?: string,
): ItemRow | undefined {
  return tx
    .select()
    .from(listItem)
    .where(
      and(
        eq(listItem.listId, listId),
        eq(listItem.nameKey, key),
        isNull(listItem.deletedAt),
        excludeId === undefined ? undefined : ne(listItem.id, excludeId),
      ),
    )
    .get();
}

export class ItemService {
  constructor(
    private readonly db: AppDatabase,
    private readonly hub: HouseholdEventHub,
    private readonly now: () => number = Date.now,
  ) {}

  /** Upsert by client id with last-write-wins, same-name merge, undelete and rename conflict detection. */
  put(
    householdId: string,
    listId: string,
    itemId: string,
    body: PutItemBody,
  ): PutItemResult {
    const changedAt = this.clamp(body.changedAt);
    const key = nameKey(body.name);
    const outcome = this.db.transaction((tx): Outcome<PutItemResult> => {
      this.requireLiveList(tx, householdId, listId);
      const existing = this.findItem(tx, itemId);
      if (existing) {
        this.requireOnList(existing, householdId, listId);
        return this.putExisting(tx, existing, body, key, changedAt);
      }
      const sameName = findLiveByKey(tx, listId, key);
      if (sameName) {
        return this.merge(tx, sameName, itemId, body.crossedOff, changedAt);
      }
      return this.create(tx, householdId, listId, itemId, body, key, changedAt);
    });
    this.publish(householdId, outcome);
    return outcome.result;
  }

  /** Soft-deletes one item; unknown and already deleted ids are no-ops. */
  delete(
    householdId: string,
    listId: string,
    itemId: string,
    changedAtIso: string,
  ): DeleteItemResult {
    const changedAt = this.clamp(changedAtIso);
    const outcome = this.db.transaction((tx): Outcome<DeleteItemResult> => {
      this.requireLiveList(tx, householdId, listId);
      const existing = this.findItem(tx, itemId);
      if (!existing) return { result: { status: 'deleted' } };
      this.requireOnList(existing, householdId, listId);
      const decision = decideDelete(existing, changedAt);
      if (decision === 'missing') return { result: { status: 'deleted' } };
      if (decision === 'stale') {
        return { result: { status: 'stale', item: toListItem(existing) } };
      }
      const version = nextVersion(tx);
      tx.update(listItem)
        .set({ deletedAt: changedAt, updatedAt: changedAt, version })
        .where(eq(listItem.id, itemId))
        .run();
      return { result: { status: 'deleted' }, version };
    });
    this.publish(householdId, outcome);
    return outcome.result;
  }

  /** Soft-deletes the eligible listed items in one transaction; any foreign or other-list id aborts it. */
  deleteBatch(
    householdId: string,
    listId: string,
    itemIds: string[],
    changedAtIso: string,
  ): void {
    const changedAt = this.clamp(changedAtIso);
    const ids = [...new Set(itemIds)];
    const outcome = this.db.transaction((tx): Outcome<undefined> => {
      this.requireLiveList(tx, householdId, listId);
      const rows = tx
        .select()
        .from(listItem)
        .where(inArray(listItem.id, ids))
        .all();
      if (rows.some((row) => row.householdId !== householdId)) {
        throw new HTTPException(403);
      }
      if (rows.some((row) => row.listId !== listId)) throw onOtherList();
      const eligible = rows
        .filter((row) => isBatchEligible(row, changedAt))
        .map((row) => row.id);
      if (eligible.length === 0) return { result: undefined };
      const version = nextVersion(tx);
      tx.update(listItem)
        .set({ deletedAt: changedAt, updatedAt: changedAt, version })
        .where(inArray(listItem.id, eligible))
        .run();
      return { result: undefined, version };
    });
    this.publish(householdId, outcome);
  }

  private clamp(changedAtIso: string): number {
    return Math.min(Date.parse(changedAtIso), this.now());
  }

  private publish(householdId: string, outcome: Outcome<unknown>): void {
    if (outcome.version !== undefined) {
      this.hub.publish(householdId, outcome.version);
    }
  }

  /** A list of another household is `403`; a missing or soft-deleted list of this household is `404`. */
  private requireLiveList(
    tx: AppTransaction,
    householdId: string,
    listId: string,
  ): void {
    const list = tx
      .select()
      .from(shoppingList)
      .where(eq(shoppingList.id, listId))
      .get();
    if (list && list.householdId !== householdId) {
      throw new HTTPException(403);
    }
    if (!list || list.deletedAt !== null) throw new HTTPException(404);
  }

  private findItem(tx: AppTransaction, id: string): ItemRow | undefined {
    return tx.select().from(listItem).where(eq(listItem.id, id)).get();
  }

  private requireOnList(
    row: ItemRow,
    householdId: string,
    listId: string,
  ): void {
    if (row.householdId !== householdId) throw new HTTPException(403);
    if (row.listId !== listId) throw onOtherList();
  }

  private putExisting(
    tx: AppTransaction,
    existing: ItemRow,
    body: PutItemBody,
    key: string,
    changedAt: number,
  ): Outcome<PutItemResult> {
    if (isPutIgnored(existing, body.name, body.crossedOff, changedAt)) {
      return {
        result: {
          created: false,
          item: toListItem(existing),
          applied: false,
        },
      };
    }
    if (findLiveByKey(tx, existing.listId, key, existing.id)) {
      throw new HTTPException(409);
    }
    const version = nextVersion(tx);
    const row = tx
      .update(listItem)
      .set({
        name: body.name,
        nameKey: key,
        crossedOffAt: crossedOffAtFor(
          existing.crossedOffAt,
          body.crossedOff,
          changedAt,
        ),
        updatedAt: changedAt,
        deletedAt: null,
        version,
      })
      .where(eq(listItem.id, existing.id))
      .returning()
      .get();
    if (renamesItem(existing, body.name)) {
      this.recordSuggestion(tx, existing.householdId, key, body.name);
    }
    return {
      result: { created: false, item: toListItem(row), applied: true },
      version,
    };
  }

  /** Applies the create to the live same-name item; its display name is kept as stored. */
  private merge(
    tx: AppTransaction,
    target: ItemRow,
    requestedId: string,
    crossedOff: boolean,
    changedAt: number,
  ): Outcome<PutItemResult> {
    if (isMergeIgnored(target, crossedOff, changedAt)) {
      return {
        result: {
          created: false,
          item: toListItem(target),
          applied: false,
          mergedFromId: requestedId,
        },
      };
    }
    const version = nextVersion(tx);
    const row = tx
      .update(listItem)
      .set({
        crossedOffAt: crossedOffAtFor(
          target.crossedOffAt,
          crossedOff,
          changedAt,
        ),
        updatedAt: changedAt,
        version,
      })
      .where(eq(listItem.id, target.id))
      .returning()
      .get();
    return {
      result: {
        created: false,
        item: toListItem(row),
        applied: true,
        mergedFromId: requestedId,
      },
      version,
    };
  }

  private create(
    tx: AppTransaction,
    householdId: string,
    listId: string,
    id: string,
    body: PutItemBody,
    key: string,
    changedAt: number,
  ): Outcome<PutItemResult> {
    const version = nextVersion(tx);
    const row = tx
      .insert(listItem)
      .values({
        id,
        householdId,
        listId,
        name: body.name,
        nameKey: key,
        crossedOffAt: crossedOffAtFor(null, body.crossedOff, changedAt),
        version,
        createdAt: this.now(),
        updatedAt: changedAt,
        deletedAt: null,
      })
      .returning()
      .get();
    this.recordSuggestion(tx, householdId, key, body.name);
    return {
      result: { created: true, item: toListItem(row), applied: true },
      version,
    };
  }

  /** Counts a use of the name; an existing suggestion keeps its stored display name. */
  private recordSuggestion(
    tx: AppTransaction,
    householdId: string,
    key: string,
    name: string,
  ): void {
    const lastUsedAt = this.now();
    tx.insert(itemSuggestion)
      .values({ householdId, nameKey: key, name, useCount: 1, lastUsedAt })
      .onConflictDoUpdate({
        target: [itemSuggestion.householdId, itemSuggestion.nameKey],
        set: { useCount: sql`${itemSuggestion.useCount} + 1`, lastUsedAt },
      })
      .run();
  }
}
