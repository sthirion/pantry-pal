import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { nameKey } from '@pantry-pal/shared';
import type {
  ItemField,
  ItemMutationBody,
  ListItem,
  PutItemBody,
} from '@pantry-pal/shared';
import { nextVersion } from '../db/change-counter.js';
import type { AppDatabase, AppTransaction } from '../db/database.js';
import { listItem } from '../db/schema.js';
import type { HouseholdEventHub } from '../realtime/household-event-hub.js';
import {
  findItem,
  findItemInScope,
  findLiveByKey,
  onOtherList,
  recordSuggestion,
  requireLiveList,
  requireOnList,
  toListItem,
} from './item-access.js';
import type { ItemRow, Outcome } from './item-access.js';
import { recordItemChange } from './item-journal.js';
import { applyItemMutation } from './item-mutation.js';
import type { ItemMutationResult } from './item-mutation.js';
import {
  changedFields,
  crossedOffAtFor,
  decideDelete,
  isBatchEligible,
  isMergeIgnored,
  isPutIgnored,
  renamesItem,
} from './item-rules.js';

export interface PutItemResult {
  created: boolean;
  item: ListItem;
  applied: boolean;
  mergedFromId?: string;
}

export type DeleteItemResult =
  | { status: 'deleted' }
  | { status: 'stale'; item: ListItem };

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
      requireLiveList(tx, householdId, listId);
      const existing = findItemInScope(tx, householdId, listId, itemId);
      if (existing) {
        return this.putExisting(tx, existing, body, key, changedAt);
      }
      this.reserveId(
        tx,
        householdId,
        listId,
        itemId,
        body.name,
        key,
        changedAt,
      );
      const sameName = findLiveByKey(tx, listId, key, itemId);
      if (sameName) {
        tx.delete(listItem)
          .where(
            and(
              eq(listItem.id, itemId),
              eq(listItem.householdId, householdId),
              eq(listItem.listId, listId),
            ),
          )
          .run();
        return this.merge(tx, sameName, itemId, body.crossedOff, changedAt);
      }
      return this.create(tx, itemId, body, key, changedAt);
    });
    this.publish(householdId, outcome);
    return outcome.result;
  }

  /** Merges a changed-field patch against the item's journal; the server wins overlapping fields. */
  mutate(
    householdId: string,
    listId: string,
    itemId: string,
    body: ItemMutationBody,
  ): ItemMutationResult {
    const outcome = this.db.transaction((tx) =>
      applyItemMutation(tx, this.now(), householdId, listId, itemId, body),
    );
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
      requireLiveList(tx, householdId, listId);
      const existing = findItem(tx, itemId);
      if (!existing) return { result: { status: 'deleted' } };
      requireOnList(existing, householdId, listId);
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
      requireLiveList(tx, householdId, listId);
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

  /** Journals a legacy write's changed fields under a server-generated mutation id. */
  private journal(tx: AppTransaction, row: ItemRow, fields: ItemField[]): void {
    if (fields.length === 0) return;
    recordItemChange(tx, {
      householdId: row.householdId,
      itemId: row.id,
      itemRevision: row.itemRevision,
      mutationId: randomUUID(),
      fields,
      createdAt: this.now(),
    });
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
    const changed = changedFields(existing, {
      name: body.name,
      crossedOff: body.crossedOff,
    });
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
        itemRevision: existing.itemRevision + (changed.length > 0 ? 1 : 0),
      })
      .where(eq(listItem.id, existing.id))
      .returning()
      .get();
    this.journal(tx, row, changed);
    if (renamesItem(existing, body.name)) {
      recordSuggestion(tx, existing.householdId, key, body.name, this.now());
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
    const changed = changedFields(target, { name: target.name, crossedOff });
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
        itemRevision: target.itemRevision + (changed.length > 0 ? 1 : 0),
      })
      .where(eq(listItem.id, target.id))
      .returning()
      .get();
    this.journal(tx, row, changed);
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

  /**
   * Claims an unused id with a tombstoned candidate row and no cursor advance. An id already taken outside this
   * household and list answers 404, like a missing item, without a lookup by id alone. The candidate is either
   * deleted (merge) or finalized (create) in the same transaction, so it never escapes.
   */
  private reserveId(
    tx: AppTransaction,
    householdId: string,
    listId: string,
    id: string,
    name: string,
    key: string,
    changedAt: number,
  ): void {
    const reserved = tx
      .insert(listItem)
      .values({
        id,
        householdId,
        listId,
        name,
        nameKey: key,
        crossedOffAt: null,
        version: 0,
        createdAt: this.now(),
        updatedAt: changedAt,
        deletedAt: changedAt,
      })
      .onConflictDoNothing({ target: listItem.id })
      .returning({ id: listItem.id })
      .get();
    if (!reserved) throw new HTTPException(404);
  }

  /** Finalizes the reserved candidate as a live item under exactly one new household version. */
  private create(
    tx: AppTransaction,
    id: string,
    body: PutItemBody,
    key: string,
    changedAt: number,
  ): Outcome<PutItemResult> {
    const version = nextVersion(tx);
    const row = tx
      .update(listItem)
      .set({
        crossedOffAt: crossedOffAtFor(null, body.crossedOff, changedAt),
        version,
        createdAt: this.now(),
        updatedAt: changedAt,
        deletedAt: null,
      })
      .where(eq(listItem.id, id))
      .returning()
      .get();
    recordSuggestion(tx, row.householdId, key, body.name, this.now());
    return {
      result: { created: true, item: toListItem(row), applied: true },
      version,
    };
  }
}
