import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { MeResponse } from '@pantry-pal/shared';
import type { Auth } from './auth.js';
import { ALLOWED_AUTH_ROUTES } from './auth.js';
import type { AppDatabase } from './db/database.js';
import { household } from './db/schema.js';
import { errorResponseForStatus, notFoundResponse } from './errors.js';
import { requireHousehold, requireSession } from './middleware.js';

const AUTH_PREFIX = '/api/auth';
const PASSTHROUGH_HEADERS = ['Retry-After', 'X-Retry-After'];

function isAllowedAuthRoute(method: string, pathname: string): boolean {
  const relative = pathname.slice(AUTH_PREFIX.length).replace(/\/+$/, '');
  return ALLOWED_AUTH_ROUTES.some(
    (route) => route.method === method && route.path === relative,
  );
}

/** Mounts Better Auth (allowlisted routes only) and `GET /api/me`. */
export function registerAuthRoutes(
  app: Hono,
  auth: Auth,
  db: AppDatabase,
): void {
  app.all(`${AUTH_PREFIX}/*`, async (c) => {
    if (!isAllowedAuthRoute(c.req.method, new URL(c.req.url).pathname)) {
      return notFoundResponse(c);
    }
    const response = await auth.handler(c.req.raw);
    if (response.status < 400) return response;
    // Replace Better Auth's error body with the project format; keep cookies and retry hints.
    const rewritten = errorResponseForStatus(c, response.status);
    for (const name of PASSTHROUGH_HEADERS) {
      const value = response.headers.get(name);
      if (value) rewritten.headers.set(name, value);
    }
    return rewritten;
  });

  app.get('/api/me', requireSession(auth), requireHousehold(db), (c) => {
    const row = db
      .select({ id: household.id, name: household.name })
      .from(household)
      .where(eq(household.id, c.get('householdId')))
      .get();
    if (!row) return errorResponseForStatus(c, 500);
    const body: MeResponse = { user: c.get('user'), household: row };
    return c.json(body);
  });
}
