import { useSyncExternalStore } from 'react';

export interface SyncNotices {
  /** HTTP status of the last change the server rejected (and the app dropped). */
  droppedStatus: number | null;
  /** True after a `401`: sending is paused until the user signs in again. */
  authRequired: boolean;
}

const INITIAL: SyncNotices = { droppedStatus: null, authRequired: false };

let state: SyncNotices = INITIAL;
const listeners = new Set<() => void>();

function set(next: SyncNotices): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function reportDropped(status: number): void {
  set({ ...state, droppedStatus: status });
}

export function requireAuth(): void {
  if (!state.authRequired) set({ ...state, authRequired: true });
}

export function clearAuthRequired(): void {
  if (state.authRequired) set({ ...state, authRequired: false });
}

export function dismissDropped(): void {
  if (state.droppedStatus !== null) set({ ...state, droppedStatus: null });
}

export function resetNotices(): void {
  set(INITIAL);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncNotices(): SyncNotices {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}
