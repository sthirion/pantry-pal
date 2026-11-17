import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData } from './localData';

beforeEach(() => {
  localStorage.setItem('a', '1');
  sessionStorage.setItem('b', '2');
});
afterEach(() => vi.unstubAllGlobals());

describe('clearLocalData', () => {
  it('clears local and session storage', async () => {
    vi.stubGlobal('indexedDB', {});
    await clearLocalData();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('deletes every IndexedDB database', async () => {
    const deleteDatabase = vi.fn(() => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => (request.onsuccess as () => void)());
      return request;
    });
    vi.stubGlobal('indexedDB', {
      databases: () =>
        Promise.resolve([{ name: 'lists' }, { name: 'outbox' }, {}]),
      deleteDatabase,
    });
    await clearLocalData();
    expect(deleteDatabase.mock.calls).toEqual([['lists'], ['outbox']]);
  });

  it('rejects when a database deletion fails', async () => {
    vi.stubGlobal('indexedDB', {
      databases: () => Promise.resolve([{ name: 'lists' }]),
      deleteDatabase: () => {
        const request: Record<string, unknown> = { error: new Error('boom') };
        queueMicrotask(() => (request.onerror as () => void)());
        return request;
      },
    });
    await expect(clearLocalData()).rejects.toThrow('boom');
  });

  it('rejects when a database is blocked by an open connection', async () => {
    vi.stubGlobal('indexedDB', {
      databases: () => Promise.resolve([{ name: 'lists' }]),
      deleteDatabase: () => {
        const request: Record<string, unknown> = {};
        queueMicrotask(() => (request.onblocked as () => void)());
        return request;
      },
    });
    await expect(clearLocalData()).rejects.toThrow('lists is in use');
  });
});
