import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  join(import.meta.dirname, '..', 'public', 'sw.js'),
  'utf8',
);

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: { method: string; url: string; mode?: string };
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (response: Promise<unknown>) => void;
}

class FakeCache {
  readonly entries = new Map<string, unknown>();
  addAll = vi.fn((urls: string[]) => {
    for (const url of urls) this.entries.set(url, `cached:${url}`);
    return Promise.resolve();
  });
  match = vi.fn((request: string | { url: string }) =>
    Promise.resolve(
      this.entries.get(typeof request === 'string' ? request : request.url),
    ),
  );
  put = vi.fn((request: { url: string }, response: unknown) => {
    this.entries.set(request.url, response);
    return Promise.resolve();
  });
}

interface Harness {
  listeners: Record<string, Listener>;
  caches: {
    stores: Map<string, FakeCache>;
    open: (name: string) => Promise<FakeCache>;
    keys: () => Promise<string[]>;
    delete: (name: string) => Promise<boolean>;
    match: (request: string) => Promise<unknown>;
  };
  fetch: ReturnType<typeof vi.fn>;
  self: {
    location: { origin: string };
    skipWaiting: ReturnType<typeof vi.fn>;
    clients: { claim: ReturnType<typeof vi.fn> };
    addEventListener: (type: string, listener: Listener) => void;
  };
}

function loadServiceWorker(): Harness {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, FakeCache>();
  const caches = {
    stores,
    open: (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return Promise.resolve(stores.get(name)!);
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    match: (request: string) => {
      for (const store of stores.values()) {
        if (store.entries.has(request)) {
          return Promise.resolve(store.entries.get(request));
        }
      }
      return Promise.resolve(undefined);
    },
  };
  const fetchMock = vi.fn();
  const self = {
    location: { origin: 'https://pantry.example' },
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
  };
  new Function('self', 'caches', 'fetch', 'URL', 'Response', source)(
    self,
    caches,
    fetchMock,
    URL,
    Response,
  );
  return { listeners, caches, fetch: fetchMock, self };
}

/** Dispatches an install/activate event and resolves what the worker passed to waitUntil. */
async function lifecycle(harness: Harness, type: 'install' | 'activate') {
  let pending: Promise<unknown> = Promise.resolve();
  harness.listeners[type]!({ waitUntil: (p) => (pending = p) });
  await pending;
}

/** Dispatches a fetch event; returns undefined when the worker did not intercept it. */
async function dispatchFetch(
  harness: Harness,
  request: { method?: string; url: string; mode?: string },
) {
  let response: Promise<unknown> | undefined;
  harness.listeners['fetch']!({
    request: { method: 'GET', ...request },
    respondWith: (p) => (response = p),
  });
  return response === undefined ? undefined : { value: await response };
}

let harness: Harness;
beforeEach(() => {
  harness = loadServiceWorker();
});

describe('service worker lifecycle', () => {
  it('precaches the app shell on install and activates immediately', async () => {
    await lifecycle(harness, 'install');

    const cache = harness.caches.stores.get('pantry-pal-shell-v1')!;
    expect(cache.addAll).toHaveBeenCalledWith([
      '/',
      '/manifest.webmanifest',
      '/icons/icon.svg',
    ]);
    expect(harness.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('deletes outdated caches on activate and claims open clients', async () => {
    await harness.caches.open('pantry-pal-shell-v0');
    await harness.caches.open('pantry-pal-shell-v1');

    await lifecycle(harness, 'activate');

    expect([...harness.caches.stores.keys()]).toEqual(['pantry-pal-shell-v1']);
    expect(harness.self.clients.claim).toHaveBeenCalledOnce();
  });
});

describe('service worker fetch handling', () => {
  it.each([
    ['an API request', { url: 'https://pantry.example/api/me' }],
    ['an SSE stream', { url: 'https://pantry.example/api/events' }],
    ['a non-GET request', { method: 'POST', url: 'https://pantry.example/x' }],
    ['a cross-origin request', { url: 'https://cdn.example/lib.js' }],
  ])('does not intercept %s', async (_label, request) => {
    const result = await dispatchFetch(harness, request);

    expect(result).toBeUndefined();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('serves navigations from the network when online', async () => {
    const online = new Response('fresh');
    harness.fetch.mockResolvedValue(online);

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/lists',
      mode: 'navigate',
    });

    expect(result?.value).toBe(online);
  });

  it('falls back to the cached shell for navigations when offline', async () => {
    await lifecycle(harness, 'install');
    harness.fetch.mockRejectedValue(new TypeError('offline'));

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/lists',
      mode: 'navigate',
    });

    expect(result?.value).toBe('cached:/');
  });

  it('returns a network error for navigations when offline and nothing is cached', async () => {
    harness.fetch.mockRejectedValue(new TypeError('offline'));

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/lists',
      mode: 'navigate',
    });

    expect((result?.value as Response).type).toBe('error');
  });

  it('serves a cached static asset and refreshes it in the background', async () => {
    const cache = await harness.caches.open('pantry-pal-shell-v1');
    cache.entries.set('https://pantry.example/assets/app.js', 'old');
    const fresh = new Response('new');
    harness.fetch.mockResolvedValue(fresh);

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/assets/app.js',
    });
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());

    expect(result?.value).toBe('old');
    const [putRequest, putResponse] = cache.put.mock.calls[0]!;
    expect(putRequest.url).toBe('https://pantry.example/assets/app.js');
    expect(await (putResponse as Response).text()).toBe('new');
  });

  it('fetches and caches an uncached static asset', async () => {
    const cache = await harness.caches.open('pantry-pal-shell-v1');
    const fresh = new Response('body');
    harness.fetch.mockResolvedValue(fresh);

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/assets/new.js',
    });

    expect(result?.value).toBe(fresh);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('does not cache a failed static asset response', async () => {
    const cache = await harness.caches.open('pantry-pal-shell-v1');
    harness.fetch.mockResolvedValue(new Response('nope', { status: 404 }));

    await dispatchFetch(harness, {
      url: 'https://pantry.example/assets/missing.js',
    });

    expect(cache.put).not.toHaveBeenCalled();
  });

  it('returns a network error for an uncached static asset when offline', async () => {
    harness.fetch.mockRejectedValue(new TypeError('offline'));

    const result = await dispatchFetch(harness, {
      url: 'https://pantry.example/assets/app.js',
    });

    expect((result?.value as Response).type).toBe('error');
  });
});
