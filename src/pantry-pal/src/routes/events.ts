import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Auth } from '../auth.js';
import type { AppDatabase } from '../db/database.js';
import { requireHousehold, requireSession } from '../middleware.js';
import type { HouseholdEventHub } from '../realtime/household-event-hub.js';

export const KEEP_ALIVE_INTERVAL_MS = 25_000;

/** Mounts `GET /api/events`: a Server-Sent Events stream of the session user's household write versions. */
export function registerEventRoutes(
  app: Hono,
  deps: {
    auth: Auth;
    db: AppDatabase;
    hub: HouseholdEventHub;
    keepAliveMs?: number;
  },
): void {
  const session = requireSession(deps.auth);
  const household = requireHousehold(deps.db);
  const keepAliveMs = deps.keepAliveMs ?? KEEP_ALIVE_INTERVAL_MS;

  app.get('/api/events', session, household, (c) => {
    const householdId = c.get('householdId');
    c.header('Cache-Control', 'no-cache');
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      let closed = false;
      let wake: () => void = () => undefined;
      const closedSignal = new Promise<void>((resolve) => {
        wake = resolve;
      });
      const close = (): void => {
        closed = true;
        unsubscribe();
        wake();
      };

      const unsubscribe = deps.hub.subscribe(householdId, (version) => {
        if (closed) return;
        stream
          .writeSSE({ event: 'changed', data: String(version) })
          .catch(close);
      });
      stream.onAbort(close);

      try {
        while (!closed) {
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, keepAliveMs);
            }),
            closedSignal,
          ]);
          clearTimeout(timer);
          if (closed) break;
          await stream.write(': keep-alive\n\n');
        }
      } catch {
        // A failed write means the client is gone.
      } finally {
        close();
      }
    });
  });
}
