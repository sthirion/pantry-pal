import type { Hono } from 'hono';
import { z } from 'zod';
import {
  changedAtSchema,
  putListBodySchema,
  uuidSchema,
} from '@pantry-pal/shared';
import type { ApiErrorDetail } from '@pantry-pal/shared';
import type { Auth } from '../auth.js';
import type { AppDatabase } from '../db/database.js';
import { ValidationError } from '../errors.js';
import { requireHousehold, requireSession } from '../middleware.js';
import type { ListService } from '../services/list-service.js';
import { parseJsonBody, parseWith } from '../validation.js';

const listIdParamSchema = z.object({ listId: uuidSchema });
const deleteQuerySchema = z.object({ changedAt: changedAtSchema });

/** Runs a parser and appends its validation details instead of throwing, so every bad input is reported. */
async function collect<T>(
  details: ApiErrorDetail[],
  parse: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await parse();
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    details.push(...err.details);
    return undefined;
  }
}

/** Mounts `PUT` and `DELETE /api/lists/:listId`, scoped to the session user's household. */
export function registerListRoutes(
  app: Hono,
  deps: { auth: Auth; db: AppDatabase; lists: ListService },
): void {
  const session = requireSession(deps.auth);
  const household = requireHousehold(deps.db);

  app.put('/api/lists/:listId', session, household, async (c) => {
    const details: ApiErrorDetail[] = [];
    const params = await collect(details, () =>
      parseWith(listIdParamSchema, c.req.param()),
    );
    const body = await collect(details, () =>
      parseJsonBody(c, putListBodySchema),
    );
    if (!params || !body) throw new ValidationError(details);

    const result = deps.lists.put(c.get('householdId'), params.listId, body);
    return c.json(
      {
        list: result.list,
        applied: result.applied,
        ...(result.mergedFromId !== undefined && {
          mergedFromId: result.mergedFromId,
        }),
      },
      result.created ? 201 : 200,
    );
  });

  app.delete('/api/lists/:listId', session, household, async (c) => {
    const details: ApiErrorDetail[] = [];
    const params = await collect(details, () =>
      parseWith(listIdParamSchema, c.req.param()),
    );
    const query = await collect(details, () =>
      parseWith(deleteQuerySchema, { changedAt: c.req.query('changedAt') }),
    );
    if (!params || !query) throw new ValidationError(details);

    const result = deps.lists.delete(
      c.get('householdId'),
      params.listId,
      query.changedAt,
    );
    if (result.status === 'stale') {
      return c.json({ list: result.list, applied: false }, 200);
    }
    return c.body(null, 204);
  });
}
