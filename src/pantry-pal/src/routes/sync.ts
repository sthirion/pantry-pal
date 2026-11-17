import type { Hono } from 'hono';
import { sinceQuerySchema } from '@pantry-pal/shared';
import type { ApiErrorDetail } from '@pantry-pal/shared';
import type { Auth } from '../auth.js';
import type { AppDatabase } from '../db/database.js';
import { ValidationError } from '../errors.js';
import { requireHousehold, requireSession } from '../middleware.js';
import type { SuggestionService } from '../services/suggestion-service.js';
import type { SyncService } from '../services/sync-service.js';
import { collect, parseWith } from '../validation.js';

/** Mounts `GET /api/sync` and `GET /api/suggestions`, scoped to the session user's household. */
export function registerSyncRoutes(
  app: Hono,
  deps: {
    auth: Auth;
    db: AppDatabase;
    sync: SyncService;
    suggestions: SuggestionService;
  },
): void {
  const session = requireSession(deps.auth);
  const household = requireHousehold(deps.db);

  app.get('/api/sync', session, household, async (c) => {
    const details: ApiErrorDetail[] = [];
    const since = await collect(details, () =>
      parseWith(sinceQuerySchema, c.req.query('since')),
    );
    if (since === undefined) throw new ValidationError(details);
    return c.json(deps.sync.getChanges(c.get('householdId'), since));
  });

  app.get('/api/suggestions', session, household, (c) =>
    c.json({ suggestions: deps.suggestions.list(c.get('householdId')) }),
  );
}
