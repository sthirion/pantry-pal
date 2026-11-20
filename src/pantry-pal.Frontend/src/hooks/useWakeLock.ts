import { useEffect } from 'react';

/**
 * Keeps the screen on while the calling screen is mounted. Releases the lock on unmount and
 * requests it again when the page becomes visible (browsers drop it when the page is hidden).
 * Does nothing in browsers without the Screen Wake Lock API.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let active = true;

    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (!active) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // Denied (e.g. low battery) or unavailable: the screen simply may turn off.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, []);
}
