import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const MARKET_ID = '0192f0c2-0000-7000-8000-000000000003';

const now = '2026-11-09T18:00:00.000Z';

interface MockItem {
  id: string;
  listId: string;
  name: string;
  crossedOffAt: string | null;
  version: number;
  itemRevision: number;
  updatedAt: string;
  deletedAt: string | null;
}

const mockLists = [
  {
    id: MARKET_ID,
    name: 'Market',
    version: 3,
    updatedAt: now,
    deletedAt: null,
  },
];

const mockItems = (): MockItem[] => [
  {
    id: '0192f0c3-0000-7000-8000-000000000001',
    listId: MARKET_ID,
    name: 'milk',
    crossedOffAt: null,
    version: 4,
    itemRevision: 2,
    updatedAt: now,
    deletedAt: null,
  },
  {
    id: '0192f0c3-0000-7000-8000-000000000003',
    listId: MARKET_ID,
    name: 'bread',
    crossedOffAt: now,
    version: 6,
    itemRevision: 3,
    updatedAt: now,
    deletedAt: null,
  },
];

interface ItemMutationRequest {
  mutationId: string;
  baseItemRevision: number;
  changes: { name?: string; crossedOff?: boolean };
}

function isItemMutationRequest(body: unknown): body is ItemMutationRequest {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Partial<ItemMutationRequest>;
  return (
    typeof candidate.mutationId === 'string' &&
    typeof candidate.baseItemRevision === 'number' &&
    typeof candidate.changes === 'object' &&
    candidate.changes !== null
  );
}

/** Controls how the mocked API behaves; change it inside a test. */
export interface MockApi {
  /**
   * Status for write requests (`PUT`/`DELETE`/`POST` under `/api/lists`). `204` accepts them (item
   * mutations get a complete `200` body); a `4xx` rejects them (item mutations with a structured error).
   */
  writeStatus: number;
  /** When true, every API request fails like a dropped connection. */
  networkDown: boolean;
  signedIn: boolean;
}

interface Fixtures {
  api: MockApi;
}

export const test = base.extend<Fixtures>({
  // The built app registers a service worker. WebKit does not route requests of a page that a
  // service worker controls through `page.route`, so the mocked API would be bypassed (the app
  // then reaches the real server and shows "session expired"). Specs that mock `/api` therefore
  // run without the service worker; the journey specs keep it and use the real API.
  serviceWorkers: 'block',
  api: async ({ page }, use) => {
    const api: MockApi = {
      writeStatus: 204,
      networkDown: false,
      signedIn: true,
    };
    const items = mockItems();
    const receipts = new Map<string, unknown>();
    let syncVersion = 6;

    /** Applies an item mutation like the server: changed fields bump the item revision once. */
    const applyItemMutation = (
      item: MockItem,
      { mutationId, changes }: ItemMutationRequest,
    ) => {
      const replay = receipts.get(mutationId);
      if (replay) return { ...(replay as object), replayed: true };
      const appliedFields: Array<'name' | 'crossedOff'> = [];
      if (changes.name !== undefined) {
        const name = changes.name.replace(/\s+/g, ' ').trim();
        if (name !== item.name) {
          item.name = name;
          appliedFields.push('name');
        }
      }
      if (changes.crossedOff !== undefined) {
        if (changes.crossedOff !== (item.crossedOffAt !== null)) {
          item.crossedOffAt = changes.crossedOff
            ? new Date().toISOString()
            : null;
          appliedFields.push('crossedOff');
        }
      }
      if (appliedFields.length > 0) {
        syncVersion += 1;
        item.version = syncVersion;
        item.itemRevision += 1;
        item.updatedAt = new Date().toISOString();
      }
      const response = {
        mutationId,
        item: { ...item },
        itemRevision: item.itemRevision,
        version: syncVersion,
        appliedFields,
        conflicts: [],
        replayed: false,
      };
      receipts.set(mutationId, response);
      return response;
    };

    await page.route('**/api/**', async (route) => {
      if (api.networkDown) return route.abort('internetdisconnected');
      const request = route.request();
      const { pathname } = new URL(request.url());
      const json = (status: number, body: unknown) =>
        route.fulfill({ status, json: body });

      if (pathname === '/api/me') {
        return api.signedIn
          ? json(200, {
              user: { id: 'user-1', name: 'Sam', email: 'sam@example.com' },
              household: { id: 'household-1', name: 'The Smiths' },
            })
          : json(401, { error: 'unauthorized' });
      }
      if (pathname === '/api/sync') {
        return json(200, {
          version: syncVersion,
          full: true,
          lists: mockLists,
          items,
        });
      }
      if (pathname === '/api/suggestions')
        return json(200, { suggestions: [] });
      // No event stream: a 404 makes the browser stop reconnecting.
      if (pathname === '/api/events') return route.fulfill({ status: 404 });
      if (pathname.startsWith('/api/lists')) {
        const target = pathname.match(
          /^\/api\/lists\/([^/]+)\/items\/([^/]+)$/,
        );
        const body: unknown =
          request.method() === 'PUT' ? request.postDataJSON() : null;
        if (target && isItemMutationRequest(body)) {
          const item = items.find(
            ({ id, listId }) => id === target[2] && listId === target[1],
          );
          if (api.writeStatus >= 400) {
            return json(api.writeStatus, {
              error: {
                code: 'validation_failed',
                message: 'The change was rejected.',
              },
            });
          }
          return item
            ? json(200, applyItemMutation(item, body))
            : json(404, {
                error: { code: 'not_found', message: 'Not found.' },
              });
        }
        // A created item joins the state, so later mutations and syncs know it.
        if (
          target &&
          api.writeStatus === 204 &&
          typeof body === 'object' &&
          body !== null &&
          'name' in body &&
          typeof body.name === 'string' &&
          !items.some(({ id }) => id === target[2])
        ) {
          syncVersion += 1;
          items.push({
            id: target[2]!,
            listId: target[1]!,
            name: body.name,
            crossedOffAt:
              'crossedOff' in body && body.crossedOff === true ? now : null,
            version: syncVersion,
            itemRevision: 1,
            updatedAt: now,
            deletedAt: null,
          });
        }
        return api.writeStatus === 204
          ? route.fulfill({ status: 204 })
          : json(api.writeStatus, { error: 'rejected' });
      }
      return route.fulfill({ status: 404 });
    });

    await use(api);
  },
});

export { expect };

/** Replaces the Screen Wake Lock API with a recorder, or removes it when unsupported. */
export async function installWakeLock(
  page: Page,
  supported: boolean,
): Promise<void> {
  await page.addInitScript((isSupported) => {
    const state = {
      requests: 0,
      releases: 0,
      sentinels: [] as Array<() => void>,
    };
    (window as unknown as { __wakeLock: typeof state }).__wakeLock = state;
    if (!isSupported) {
      delete (Navigator.prototype as unknown as Record<string, unknown>)
        .wakeLock;
      return;
    }
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    (window as unknown as Record<string, unknown>).__setVisibility = (
      next: DocumentVisibilityState,
    ) => {
      visibility = next;
      // Like a real browser, the lock is dropped when the page is hidden.
      if (next === 'hidden') state.sentinels.splice(0).forEach((r) => r());
      document.dispatchEvent(new Event('visibilitychange'));
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          state.requests += 1;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            state.releases += 1;
            state.sentinels = state.sentinels.filter((r) => r !== release);
          };
          state.sentinels.push(release);
          return {
            release: async () => release(),
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          };
        },
      },
    });
  }, supported);
}

export async function heldWakeLocks(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __wakeLock: { sentinels: unknown[] } }).__wakeLock
        .sentinels.length,
  );
}

export async function wakeLockRequests(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __wakeLock: { requests: number } }).__wakeLock
        .requests,
  );
}

export async function setVisibility(
  page: Page,
  state: 'visible' | 'hidden',
): Promise<void> {
  await page.evaluate(
    (next) =>
      (window as unknown as Record<string, (s: string) => void>)
        .__setVisibility!(next),
    state,
  );
}

export async function openMarketList(page: Page): Promise<void> {
  await page.goto(`/lists/${MARKET_ID}`);
  await expect(page.getByRole('heading', { name: 'Market' })).toBeVisible();
}
