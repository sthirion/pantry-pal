import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../services/db';
import { pendingCount as countPending } from '../services/outbox';

export interface SyncStatus {
  online: boolean;
  pendingCount: number;
  /** Edits the server did not accept plus conflicts, all waiting for the member to reconcile. */
  reviewCount: number;
}

async function countNeedingReview(): Promise<number> {
  const [blocked, conflicts] = await Promise.all([
    db.outbox.filter((entry) => entry.blocked !== undefined).count(),
    db.itemConflicts.count(),
  ]);
  return blocked + conflicts;
}

/** Online state, the changes still waiting in the outbox, and the ones needing review. */
export function useSyncStatus(): SyncStatus {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    const subscription = liveQuery(countPending).subscribe({
      next: setPendingCount,
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = liveQuery(countNeedingReview).subscribe({
      next: setReviewCount,
    });
    return () => subscription.unsubscribe();
  }, []);

  return { online, pendingCount, reviewCount };
}
