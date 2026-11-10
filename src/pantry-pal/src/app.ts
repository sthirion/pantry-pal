import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from './config.js';
import { handleError, notFoundResponse } from './errors.js';
import { originCheck } from './origin-check.js';
import { isApiPath, serveStatic } from './static.js';

export interface AppOptions {
  config: Config;
  /** Lets tests (and later stories) mount routes before the 404/static fallback. */
  registerRoutes?: (app: Hono) => void;
}

export function createApp({ config, registerRoutes }: AppOptions): Hono {
  const app = new Hono();

  app.use(
    secureHeaders({
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      contentSecurityPolicy: { defaultSrc: ["'self'"] },
    }),
  );
  app.use(originCheck(config.publicOrigin));
  // Hono's own onError only receives `Error` instances; map any other thrown value here.
  app.use(async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof Error) throw err;
      return handleError(err, c);
    }
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  registerRoutes?.(app);

  app.notFound((c) => {
    const isRead = c.req.method === 'GET' || c.req.method === 'HEAD';
    if (isRead && config.staticDir && !isApiPath(c.req.path)) {
      return serveStatic(c, config.staticDir);
    }
    return notFoundResponse(c);
  });
  app.onError(handleError);

  return app;
}
