import type {
  ItemMutationResponse,
  ListItem,
  ShoppingList,
  SyncResponse,
} from '@pantry-pal/shared';
import { ApiError, apiRequest } from './apiClient';
import {
  clearAllStores,
  db,
  getMeta,
  requestPersistentStorage,
  setMeta,
} from './db';
import { isItemMutationResponse, parseRejection } from './itemRecovery';
import {
  backoffDelayMs,
  classifyStatus,
  type FailureAction,
  nextSendable,
  pendingTargets,
  rebaseNextUnsentEdit,
  remapPendingIds,
  removeEntry,
} from './outbox';
import type {
  OutboxEntry,
  QueuedMutation,
  UpdateItemMutation,
} from './outbox.types';
import { clearAuthRequired, reportDropped, requireAuth } from './syncNotices';

interface WriteResponse {
  list?: ShoppingList;
  item?: ListItem;
  applied?: boolean;
  mergedFromId?: string;
}

type SendOutcome = 'sent' | 'blocked' | FailureAction;

interface SendResult {
  outcome: SendOutcome;
  response?: WriteResponse | ItemMutationResponse;
  rejection?: ReturnType<typeof parseRejection>;
}

export interface SyncEngineDeps {
  request: <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  /** Non-blocking error report (a dropped change, with the HTTP status). */
  onError: (status: number) => void;
  /** Called on `401`: sending is paused and the user must sign in. */
  onAuthRequired: () => void;
  /** Returns `null` when server-sent events are unavailable. */
  createEventSource: (url: string) => EventSource | null;
}

const defaultDeps: SyncEngineDeps = {
  request: apiRequest,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError: () => undefined,
  onAuthRequired: () => undefined,
  createEventSource: (url) =>
    typeof EventSource === 'undefined' ? null : new EventSource(url),
};

const enc = encodeURIComponent;

function toRequest(m: QueuedMutation): {
  path: string;
  init: { method: string; body?: unknown };
} {
  switch (m.kind) {
    case 'putList':
      return {
        path: `/api/lists/${enc(m.listId)}`,
        init: { method: 'PUT', body: m.body },
      };
    case 'deleteList':
      return {
        path: `/api/lists/${enc(m.listId)}?changedAt=${enc(m.changedAt)}`,
        init: { method: 'DELETE' },
      };
    case 'putItem':
      return {
        path: `/api/lists/${enc(m.listId)}/items/${enc(m.itemId)}`,
        init: { method: 'PUT', body: m.body },
      };
    case 'updateItem':
      return {
        path: `/api/lists/${enc(m.listId)}/items/${enc(m.itemId)}`,
        init: {
          method: 'PUT',
          body: {
            mutationId: m.id,
            baseItemRevision: m.baseItemRevision,
            changes: m.changes,
          },
        },
      };
    case 'deleteItem':
      return {
        path: `/api/lists/${enc(m.listId)}/items/${enc(m.itemId)}?changedAt=${enc(m.changedAt)}`,
        init: { method: 'DELETE' },
      };
    case 'deleteItems':
      return {
        path: `/api/lists/${enc(m.listId)}/items/delete-batch`,
        init: { method: 'POST', body: m.body },
      };
  }
}

/** Replaces a merged-away local id with the server's id in rows and pending changes. */
async function remapLocalId(
  kind: 'list' | 'item',
  oldId: string,
  newId: string,
): Promise<void> {
  await db.transaction('rw', [db.lists, db.items, db.outbox], async () => {
    // Re-key the local row (keeping any optimistic state) rather than dropping it.
    if (kind === 'list') {
      const row = await db.lists.get(oldId);
      await db.lists.delete(oldId);
      if (row) await db.lists.put({ ...row, id: newId });
      await db.items.where('listId').equals(oldId).modify({ listId: newId });
    } else {
      const row = await db.items.get(oldId);
      await db.items.delete(oldId);
      if (row) await db.items.put({ ...row, id: newId });
    }
    await remapPendingIds(oldId, newId);
  });
}

export class SyncEngine {
  private flushing = false;
  private pulling = false;
  private pullAgain = false;
  private paused = false;
  private started = false;
  private stopRequested = false;
  private cleanups: Array<() => void> = [];
  private readonly deps: SyncEngineDeps;

  constructor(deps: Partial<SyncEngineDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Starts listening for start-up, online, focus, and SSE triggers. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopRequested = false;

    const onTrigger = () => void this.sync();
    window.addEventListener('online', onTrigger);
    window.addEventListener('focus', onTrigger);
    this.cleanups.push(
      () => window.removeEventListener('online', onTrigger),
      () => window.removeEventListener('focus', onTrigger),
    );

    const source = this.deps.createEventSource('/api/events');
    // EventSource reconnects on its own; every (re)open pulls to catch up.
    if (source) {
      source.onopen = onTrigger;
      source.addEventListener('changed', (event) => {
        void this.onChanged((event as MessageEvent<string>).data);
      });
      this.cleanups.push(() => source.close());
    }

    void this.sync();
  }

  stop(): void {
    this.started = false;
    this.stopRequested = true;
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
  }

  /** Flushes the outbox first (so local changes land), then pulls. */
  async sync(): Promise<void> {
    await this.flush();
    await this.pull();
  }

  private async onChanged(data: string): Promise<void> {
    // The server sends the bare write version as the event data (e.g. `42`).
    if (!/^\d+$/.test(data)) return;
    const version = Number(data);
    const cursor = (await getMeta<number>('cursor')) ?? 0;
    if (version > cursor) await this.pull();
  }

  /**
   * Called after sign-in. The same user resumes the queue; a different user
   * has all local data (including the outbox) cleared first.
   */
  async resume(user: { userId: string; householdId: string }): Promise<void> {
    const storedUser = await getMeta<string>('userId');
    if (storedUser !== undefined && storedUser !== user.userId) {
      await clearAllStores();
    }
    await setMeta('userId', user.userId);
    await setMeta('householdId', user.householdId);
    await requestPersistentStorage();
    this.paused = false;
    clearAuthRequired();
    await this.sync();
  }

  /** Sends queued changes one at a time, oldest first. Only one flush runs at once. */
  async flush(): Promise<void> {
    if (this.flushing || this.paused) return;
    this.flushing = true;
    let attempt = 0;
    try {
      while (!this.paused) {
        const entry = await nextSendable();
        if (!entry) return;
        const { outcome, response, rejection } = await this.send(
          entry.mutation,
        );
        if (outcome === 'sent') {
          attempt = 0;
          if (entry.mutation.kind === 'updateItem') {
            await this.settleUpdate(
              entry,
              entry.mutation,
              response as ItemMutationResponse,
            );
          } else {
            await removeEntry(entry.seq);
            await this.applyWriteResult(
              entry.mutation,
              response as WriteResponse | undefined,
            );
          }
        } else if (outcome === 'retry') {
          await this.deps.sleep(backoffDelayMs(attempt));
          if (this.stopRequested) return;
          attempt += 1;
        } else if (outcome === 'blocked' && rejection) {
          attempt = 0;
          await this.blockUpdate(entry, rejection);
        } else if (outcome === 'drop') {
          attempt = 0;
          await removeEntry(entry.seq);
          await this.pull({ replace: true });
        } else {
          return; // auth: paused
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(mutation: QueuedMutation): Promise<SendResult> {
    const { path, init } = toRequest(mutation);
    try {
      const response = await this.deps.request<
        WriteResponse | ItemMutationResponse | undefined
      >(path, init);
      // An empty or malformed 2xx cannot confirm the edit; retry the same mutation id and payload.
      if (
        mutation.kind === 'updateItem' &&
        !isItemMutationResponse(response, mutation)
      ) {
        return { outcome: 'retry' };
      }
      return { outcome: 'sent', response };
    } catch (error) {
      if (!(error instanceof ApiError)) return { outcome: 'retry' }; // network error
      const action = classifyStatus(error.status);
      if (action === 'auth') {
        this.paused = true;
        this.deps.onAuthRequired();
      } else if (action === 'drop') {
        if (mutation.kind === 'updateItem') {
          // The patch stays queued for reconciliation instead of being dropped.
          return {
            outcome: 'blocked',
            rejection: parseRejection(error.status, error.body),
          };
        }
        this.deps.onError(error.status);
      }
      return { outcome: action };
    }
  }

  /**
   * An accepted edit leaves the queue; its response rebases the item's next unsent edit and, when
   * overlapping fields kept the server's value, records the attempted values for review.
   * The household sync cursor is not moved: other members' changes may lie between it and `version`.
   */
  private async settleUpdate(
    entry: OutboxEntry,
    mutation: UpdateItemMutation,
    response: ItemMutationResponse,
  ): Promise<void> {
    await db.transaction(
      'rw',
      [db.items, db.outbox, db.itemConflicts],
      async () => {
        await db.outbox.delete(entry.seq);
        await rebaseNextUnsentEdit(mutation.itemId, response.itemRevision);
        if (response.conflicts.length > 0) {
          await db.itemConflicts.put({
            mutationId: mutation.id,
            listId: mutation.listId,
            itemId: mutation.itemId,
            conflicts: response.conflicts,
            recordedAt: new Date().toISOString(),
          });
        }
        const pending = await pendingTargets();
        if (!pending.has(response.item.id)) await db.items.put(response.item);
      },
    );
  }

  /** Keeps a rejected edit queued, marked blocked, and refreshes the item from the server. */
  private async blockUpdate(
    entry: OutboxEntry,
    { blocked, item }: ReturnType<typeof parseRejection>,
  ): Promise<void> {
    await db.transaction('rw', [db.items, db.outbox], async () => {
      await db.outbox.update(entry.seq, { blocked });
      if (item) await db.items.put(item);
    });
    if (!item) await this.pull({ replace: true });
  }

  /** Takes the server's authoritative row from a write response, unless newer changes are queued. */
  private async applyWriteResult(
    mutation: Exclude<QueuedMutation, UpdateItemMutation>,
    response: WriteResponse | undefined,
  ): Promise<void> {
    if (!response) return;
    const isList =
      mutation.kind === 'putList' || mutation.kind === 'deleteList';
    const row = isList ? response.list : response.item;
    if (!row) return;
    const requestedId =
      mutation.kind === 'putList' || mutation.kind === 'deleteList'
        ? mutation.listId
        : mutation.kind === 'putItem' || mutation.kind === 'deleteItem'
          ? mutation.itemId
          : undefined;
    if (response.mergedFromId && requestedId) {
      await remapLocalId(isList ? 'list' : 'item', requestedId, row.id);
    }
    const pending = await pendingTargets();
    if (pending.has(row.id)) return;
    if (isList) await db.lists.put(row as ShoppingList);
    else await db.items.put(row as ListItem);
  }

  /**
   * Pulls changes since the cursor. With `replace` (used after a dropped change)
   * it fetches a full snapshot and replaces local lists and items.
   */
  async pull(options: { replace?: boolean } = {}): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      this.replaceNext ||= options.replace === true;
      return;
    }
    this.pulling = true;
    try {
      let replace = options.replace === true;
      do {
        this.pullAgain = false;
        const since = replace ? 0 : ((await getMeta<number>('cursor')) ?? 0);
        const response = await this.deps.request<SyncResponse>(
          `/api/sync?since=${since}`,
        );
        await this.applyPull(response, replace || response.full);
        replace = this.replaceNext;
        this.replaceNext = false;
      } while (this.pullAgain);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.paused = true;
        this.deps.onAuthRequired();
      }
      // Other failures (offline, 5xx): the next trigger pulls again.
    } finally {
      this.pulling = false;
    }
  }

  private replaceNext = false;

  /** Writes pulled rows; rows with queued local changes are left for the outbox to settle. */
  private async applyPull(
    response: SyncResponse,
    replace: boolean,
  ): Promise<void> {
    await db.transaction(
      'rw',
      [db.lists, db.items, db.outbox, db.meta],
      async () => {
        const pending = await pendingTargets();
        if (replace) {
          await db.lists.filter((list) => !pending.has(list.id)).delete();
          await db.items.filter((item) => !pending.has(item.id)).delete();
        }
        await db.lists.bulkPut(
          response.lists.filter((list) => !pending.has(list.id)),
        );
        await db.items.bulkPut(
          response.items.filter((item) => !pending.has(item.id)),
        );
        const cursor = (await getMeta<number>('cursor')) ?? 0;
        // A replace is a fresh snapshot, so its version is the cursor even if lower.
        await setMeta(
          'cursor',
          replace ? response.version : Math.max(cursor, response.version),
        );
      },
    );
  }
}

export const syncEngine = new SyncEngine({
  onError: reportDropped,
  onAuthRequired: requireAuth,
});
