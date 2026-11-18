import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllStores } from '../services/db';
import { saveList } from '../services/mutations';
import { useSyncStatus } from './useSyncStatus';

beforeEach(clearAllStores);

describe('useSyncStatus', () => {
  it('reports the pending count as changes are queued', async () => {
    const { result } = renderHook(() => useSyncStatus());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    await act(async () => {
      await saveList('A');
    });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it('tracks the online and offline events', async () => {
    const { result } = renderHook(() => useSyncStatus());
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.online).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current.online).toBe(true);
  });
});
