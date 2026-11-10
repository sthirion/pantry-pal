import { createMiddleware } from 'hono/factory';
import { forbiddenResponse } from './errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence: every unsafe request must come from `publicOrigin`, whatever its content type.
 * Without an Origin header only browser cross-site requests are rejected (non-browser clients pass).
 */
export function originCheck(publicOrigin: string) {
  return createMiddleware(async (c, next) => {
    if (UNSAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      const allowed =
        origin !== undefined
          ? origin === publicOrigin
          : c.req.header('sec-fetch-site') !== 'cross-site';
      if (!allowed) return forbiddenResponse(c);
    }
    await next();
  });
}
