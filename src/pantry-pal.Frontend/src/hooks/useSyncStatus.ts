import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../services/db';

export interface SyncStatus {
  online: boolean;
  pendingCount: number;
}

/** Online state and the number of changes still waiting in the outbox. */
export function useSyncStatus(): SyncStatus {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

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
    const subscription = liveQuery(() => db.outbox.count()).subscribe({
      next: setPendingCount,
    });
    return () => subscription.unsubscribe();
  }, []);

  return { online, pendingCount };
}
