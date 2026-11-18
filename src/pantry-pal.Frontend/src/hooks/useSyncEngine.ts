import { useEffect } from 'react';
import { useSession } from './useSession';
import { syncEngine } from '../services/sync-engine';

/** Runs the sync engine while a user is signed in: resumes the queue, then listens for triggers. */
export function useSyncEngine(): void {
  const session = useSession();
  const user = session.status === 'signedIn' ? session.me : null;
  const userId = user?.user.id;
  const householdId = user?.household.id;

  useEffect(() => {
    if (!userId || !householdId) return;
    syncEngine.start();
    void syncEngine.resume({ userId, householdId });
    return () => syncEngine.stop();
  }, [userId, householdId]);
}
