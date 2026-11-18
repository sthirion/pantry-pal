import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncEngine } from './useSyncEngine';
import { syncEngine } from '../services/sync-engine';

const ME = {
  user: { id: 'u1', name: 'Sam', email: 'sam@example.com' },
  household: { id: 'h1', name: 'The Smiths' },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let status: number;

beforeEach(() => {
  status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 200
        ? new Response(JSON.stringify(ME), { status })
        : new Response('{}', { status }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSyncEngine', () => {
  it('starts the engine and resumes with the signed-in user, then stops on unmount', async () => {
    const start = vi.spyOn(syncEngine, 'start').mockImplementation(() => {});
    const stop = vi.spyOn(syncEngine, 'stop').mockImplementation(() => {});
    const resume = vi.spyOn(syncEngine, 'resume').mockResolvedValue();

    const { unmount } = renderHook(() => useSyncEngine(), { wrapper });

    await waitFor(() =>
      expect(resume).toHaveBeenCalledWith({ userId: 'u1', householdId: 'h1' }),
    );
    expect(start).toHaveBeenCalledOnce();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not start the engine when nobody is signed in', async () => {
    status = 401;
    const start = vi.spyOn(syncEngine, 'start').mockImplementation(() => {});
    const resume = vi.spyOn(syncEngine, 'resume').mockResolvedValue();

    renderHook(() => useSyncEngine(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(start).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
