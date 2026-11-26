import type { Hono } from 'hono';
import { z } from 'zod';
import {
  changedAtSchema,
  deleteItemsBodySchema,
  itemMutationBodySchema,
  putItemBodySchema,
  uuidSchema,
} from '@pantry-pal/shared';
import type { ApiErrorDetail } from '@pantry-pal/shared';
import type { Auth } from '../auth.js';
import type { AppDatabase } from '../db/database.js';
import { mutationRejectionResponse, ValidationError } from '../errors.js';
import { requireHousehold, requireSession } from '../middleware.js';
import type { ItemService } from '../services/item-service.js';
import { collect, parseJsonBody, parseWith } from '../validation.js';

const listParamSchema = z.object({ listId: uuidSchema });
const itemParamSchema = z.object({ listId: uuidSchema, itemId: uuidSchema });
const deleteQuerySchema = z.object({ changedAt: changedAtSchema });
const jsonObjectSchema = z.record(z.string(), z.unknown());
const MUTATION_KEYS = ['mutationId', 'baseItemRevision', 'changes'];

/** A body naming any mutation field is a changed-field mutation; anything else is the legacy upsert. */
function isItemMutationRequest(body: Record<string, unknown>): boolean {
  return MUTATION_KEYS.some((key) => key in body);
}

/** Mounts the item routes under `/api/lists/:listId/items`, scoped to the session user's household. */
export function registerItemRoutes(
  app: Hono,
  deps: { auth: Auth; db: AppDatabase; items: ItemService },
): void {
  const session = requireSession(deps.auth);
  const household = requireHousehold(deps.db);

  app.put('/api/lists/:listId/items/:itemId', session, household, async (c) => {
    const details: ApiErrorDetail[] = [];
    const params = await collect(details, () =>
      parseWith(itemParamSchema, c.req.param()),
    );
    const raw = await collect(details, () =>
      parseJsonBody(c, jsonObjectSchema),
    );

    if (raw && isItemMutationRequest(raw)) {
      const mutation = await collect(details, () =>
        parseWith(itemMutationBodySchema, raw),
      );
      if (!params || !mutation) throw new ValidationError(details);
      const outcome = deps.items.mutate(
        c.get('householdId'),
        params.listId,
        params.itemId,
        mutation,
      );
      return outcome.status === 'accepted'
        ? c.json(outcome.response, 200)
        : mutationRejectionResponse(c, outcome);
    }

    const body =
      raw && (await collect(details, () => parseWith(putItemBodySchema, raw)));
    if (!params || !body) throw new ValidationError(details);

    const result = deps.items.put(
      c.get('householdId'),
      params.listId,
      params.itemId,
      body,
    );
    return c.json(
      {
        item: result.item,
        applied: result.applied,
        ...(result.mergedFromId !== undefined && {
          mergedFromId: result.mergedFromId,
        }),
      },
      result.created ? 201 : 200,
    );
  });

  app.delete(
    '/api/lists/:listId/items/:itemId',
    session,
    household,
    async (c) => {
      const details: ApiErrorDetail[] = [];
      const params = await collect(details, () =>
        parseWith(itemParamSchema, c.req.param()),
      );
      const query = await collect(details, () =>
        parseWith(deleteQuerySchema, { changedAt: c.req.query('changedAt') }),
      );
      if (!params || !query) throw new ValidationError(details);

      const result = deps.items.delete(
        c.get('householdId'),
        params.listId,
        params.itemId,
        query.changedAt,
      );
      if (result.status === 'stale') {
        return c.json({ item: result.item, applied: false }, 200);
      }
      return c.body(null, 204);
    },
  );

  app.post(
    '/api/lists/:listId/items/delete-batch',
    session,
    household,
    async (c) => {
      const details: ApiErrorDetail[] = [];
      const params = await collect(details, () =>
        parseWith(listParamSchema, c.req.param()),
      );
      const body = await collect(details, () =>
        parseJsonBody(c, deleteItemsBodySchema),
      );
      if (!params || !body) throw new ValidationError(details);

      deps.items.deleteBatch(
        c.get('householdId'),
        params.listId,
        body.itemIds,
        body.changedAt,
      );
      return c.body(null, 204);
    },
  );
}
