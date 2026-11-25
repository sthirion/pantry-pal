import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const MARKET_ID = '0192f0c2-0000-7000-8000-000000000003';

const now = '2026-11-09T18:00:00.000Z';

const syncResponse = {
  version: 6,
  full: true,
  lists: [
    {
      id: MARKET_ID,
      name: 'Market',
      version: 3,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  items: [
    {
      id: '0192f0c3-0000-7000-8000-000000000001',
      listId: MARKET_ID,
      name: 'milk',
      crossedOffAt: null,
      version: 4,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: '0192f0c3-0000-7000-8000-000000000003',
      listId: MARKET_ID,
      name: 'bread',
      crossedOffAt: now,
      version: 6,
      updatedAt: now,
      deletedAt: null,
    },
  ],
};

/** Controls how the mocked API behaves; change it inside a test. */
export interface MockApi {
  /** Status for write requests (`PUT`/`DELETE`/`POST` under `/api/lists`). */
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
  serviceWorkers: ['block', { option: true }],
  api: async ({ page }, use) => {
    const api: MockApi = {
      writeStatus: 204,
      networkDown: false,
      signedIn: true,
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
      if (pathname === '/api/sync') return json(200, syncResponse);
      if (pathname === '/api/suggestions')
        return json(200, { suggestions: [] });
      // No event stream: a 404 makes the browser stop reconnecting.
      if (pathname === '/api/events') return route.fulfill({ status: 404 });
      if (pathname.startsWith('/api/lists')) {
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
