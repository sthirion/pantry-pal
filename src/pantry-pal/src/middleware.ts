import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { Auth } from './auth.js';
import type { AppDatabase } from './db/database.js';
import { householdMember } from './db/schema.js';
import { forbiddenResponse, unauthenticatedResponse } from './errors.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser;
    householdId: string;
  }
}

/** 401 unless the request carries a valid session; sets `user` and forwards any refreshed cookie. */
export function requireSession(auth: Auth): MiddlewareHandler {
  return async (c, next) => {
    const result = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    const session = result.response;
    if (!session) return unauthenticatedResponse(c);
    const { id, name, email } = session.user;
    c.set('user', { id, name, email });
    for (const cookie of result.headers.getSetCookie()) {
      c.header('Set-Cookie', cookie, { append: true });
    }
    await next();
  };
}

/** 403 unless the session user belongs to a household; sets `householdId` from the database. Run after `requireSession`. */
export function requireHousehold(db: AppDatabase): MiddlewareHandler {
  return async (c, next) => {
    const membership = db
      .select({ householdId: householdMember.householdId })
      .from(householdMember)
      .where(eq(householdMember.userId, c.get('user').id))
      .get();
    if (!membership) return forbiddenResponse(c);
    c.set('householdId', membership.householdId);
    await next();
  };
}
