import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clearAuthRequired,
  dismissDropped,
  reportDropped,
  requireAuth,
  resetNotices,
  useSyncNotices,
} from './syncNotices';

beforeEach(resetNotices);

describe('syncNotices', () => {
  it('starts with no notices', () => {
    const { result } = renderHook(() => useSyncNotices());

    expect(result.current).toEqual({
      droppedStatus: null,
      authRequired: false,
    });
  });

  it('records a dropped change status and clears it on dismiss', () => {
    const { result } = renderHook(() => useSyncNotices());

    act(() => reportDropped(422));
    expect(result.current.droppedStatus).toBe(422);

    act(() => dismissDropped());
    expect(result.current.droppedStatus).toBeNull();
  });

  it('flags and clears the sign-in requirement without touching the dropped status', () => {
    const { result } = renderHook(() => useSyncNotices());

    act(() => {
      reportDropped(400);
      requireAuth();
    });
    expect(result.current).toEqual({ droppedStatus: 400, authRequired: true });

    act(() => clearAuthRequired());
    expect(result.current).toEqual({ droppedStatus: 400, authRequired: false });
  });
});
