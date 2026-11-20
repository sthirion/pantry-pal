import { APIError } from 'better-auth/api';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  changePasswordBodySchema,
  updateProfileBodySchema,
} from '@pantry-pal/shared';
import type { UpdateProfileResponse } from '@pantry-pal/shared';
import type { Auth } from '../auth.js';
import { ValidationError } from '../errors.js';
import { requireSession } from '../middleware.js';
import { parseJsonBody } from '../validation.js';

const INVALID_PASSWORD_CODE = 'INVALID_PASSWORD';
const MAX_WRONG_PASSWORDS = 5;
const WRONG_PASSWORD_WINDOW_MS = 60_000;

/** Counts wrong current-password attempts per user in a fixed window; Better Auth's own limiter does not cover server-side calls. */
class WrongPasswordLimiter {
  private readonly attempts = new Map<
    string,
    { count: number; windowStart: number }
  >();

  constructor(private readonly now: () => number) {}

  /** Counts the attempt before it is verified, so concurrent requests cannot all pass the check. Returns false when blocked. */
  tryAttempt(userId: string): boolean {
    let entry = this.attempts.get(userId);
    if (entry && this.now() - entry.windowStart >= WRONG_PASSWORD_WINDOW_MS) {
      this.attempts.delete(userId);
      entry = undefined;
    }
    if (!entry) {
      this.attempts.set(userId, { count: 1, windowStart: this.now() });
      return true;
    }
    if (entry.count >= MAX_WRONG_PASSWORDS) return false;
    entry.count += 1;
    return true;
  }

  /** Gives back an attempt that did not fail on the password itself. */
  release(userId: string): void {
    const entry = this.attempts.get(userId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) this.attempts.delete(userId);
  }

  reset(userId: string): void {
    this.attempts.delete(userId);
  }
}

function forwardCookies(c: Context, headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    c.header('Set-Cookie', cookie, { append: true });
  }
}

/**
 * Mounts `PATCH /api/me` (display name) and `PUT /api/me/password` for the signed-in user.
 * Both act only on the session user's own record, so no household lookup is needed.
 * They call Better Auth server-side; its HTTP routes for these stay closed.
 */
export function registerProfileRoutes(
  app: Hono,
  deps: { auth: Auth; now?: () => number },
): void {
  const session = requireSession(deps.auth);
  const limiter = new WrongPasswordLimiter(deps.now ?? Date.now);

  app.patch('/api/me', session, async (c) => {
    const body = await parseJsonBody(c, updateProfileBodySchema);
    const result = await deps.auth.api.updateUser({
      headers: c.req.raw.headers,
      body: { name: body.name },
      returnHeaders: true,
    });
    forwardCookies(c, result.headers);
    const { id, email } = c.get('user');
    const response: UpdateProfileResponse = {
      user: { id, name: body.name, email },
    };
    return c.json(response);
  });

  app.put('/api/me/password', session, async (c) => {
    const body = await parseJsonBody(c, changePasswordBodySchema);
    const userId = c.get('user').id;
    if (!limiter.tryAttempt(userId)) throw new HTTPException(429);

    try {
      const result = await deps.auth.api.changePassword({
        headers: c.req.raw.headers,
        body: { ...body, revokeOtherSessions: true },
        returnHeaders: true,
      });
      limiter.reset(userId);
      // Revoking other sessions issues a new session for this one.
      forwardCookies(c, result.headers);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof APIError && err.body?.code === INVALID_PASSWORD_CODE) {
        throw new ValidationError([
          {
            path: 'currentPassword',
            message: 'Current password is incorrect.',
          },
        ]);
      }
      limiter.release(userId);
      throw err;
    }
  });
}
