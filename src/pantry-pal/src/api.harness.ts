import fs from 'node:fs';
import type { Server } from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach } from 'vitest';
import { deleteItemsBodySchema, putListBodySchema } from '@pantry-pal/shared';
import { createApp } from './app.js';
import type { Auth } from './auth.js';
import { loadConfig } from './config.js';
import {
  createDatabase,
  openSqlite,
  runMigrations,
  type AppDatabase,
} from './db/database.js';
import { requireHousehold, requireSession } from './middleware.js';
import { parseJsonBody } from './validation.js';

export const ORIGIN = 'https://pantry.thirion.org';
export const SECRET = 'top-secret-outside-static-dir';
export const SHELL = '<html>SPA-SHELL</html>';
export const SW_BODY = 'console.log("sw");';
export const MANIFEST_BODY = '{"name":"x"}';
export const ASSET_BODY = 'console.log(1);';
export const sameOrigin = { Origin: ORIGIN };

export interface HarnessOptions {
  /** Serve the PWA fixture (default true). `false` leaves STATIC_DIR unset. */
  withStatic?: boolean;
  /** Run with NODE_ENV=production (default false). */
  production?: boolean;
}

export interface Harness {
  baseUrl: string;
  dbPath: string;
  staticDir: string;
  tmp: string;
  /** The connection the app itself uses (opened by `openSqlite`). */
  sqlite: Database.Database;
  /** Drizzle handle on the same connection. */
  db: AppDatabase;
  /** Number of times a test-only echo handler actually ran. */
  calls: { echo: number };
  stop: () => Promise<void>;
}

function registerTestRoutes(
  app: Hono,
  calls: { echo: number },
  deps: { auth?: Auth; db?: AppDatabase },
): void {
  if (deps.auth && deps.db) {
    app.get(
      '/api/test/guarded',
      requireSession(deps.auth),
      requireHousehold(deps.db),
      (c) =>
        c.json({ userId: c.get('user').id, householdId: c.get('householdId') }),
    );
    app.get('/api/test/session-only', requireSession(deps.auth), (c) =>
      c.json({ userId: c.get('user').id }),
    );
  }
  app.get('/api/test/throw', () => {
    throw new Error('token=XYZ987');
  });
  app.get('/api/test/throw-string', () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw 'boom';
  });
  app.get('/api/test/throw-object', () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw { message: 'boom', stack: 'at secret.ts:1' };
  });
  app.get('/api/test/http/:status', (c) => {
    throw new HTTPException(Number(c.req.param('status')) as 400, {
      message: 'internal detail',
    });
  });
  app.put('/api/test/list', async (c) =>
    c.json(await parseJsonBody(c, putListBodySchema)),
  );
  app.delete('/api/test/items', async (c) =>
    c.json(await parseJsonBody(c, deleteItemsBodySchema)),
  );
  app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/api/test/echo', (c) => {
    calls.echo += 1;
    return c.json({ ok: true });
  });
}

/** Boots the real stack (config, SQLite file, migrations, app, HTTP listener) on a free port. */
export async function boot(
  tmp: string,
  options: HarnessOptions = {},
): Promise<Harness> {
  const { withStatic = true, production = false } = options;
  const dbPath = path.join(tmp, 'data', 'pantry.db');
  const staticDir = path.join(tmp, 'public');
  const config = loadConfig({
    DB_PATH: dbPath,
    PUBLIC_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: 'harness-secret-harness-secret-harness-secret',
    ...(withStatic && { STATIC_DIR: staticDir }),
    ...(production && { NODE_ENV: 'production' }),
  });
  const calls = { echo: 0 };
  const sqlite = openSqlite(config.dbPath);
  let server: Server | undefined;
  let db: AppDatabase;
  try {
    db = createDatabase(sqlite);
    runMigrations(db);
    const app = createApp({
      config,
      db,
      registerRoutes: (a, deps) => registerTestRoutes(a, calls, deps),
    });
    server = serve({
      fetch: app.fetch,
      port: 0,
      hostname: '127.0.0.1',
    }) as Server;
    const listening = server;
    await new Promise<void>((resolve, reject) => {
      listening.once('error', reject);
      if (listening.listening) resolve();
      else listening.once('listening', () => resolve());
    });
    const { port } = listening.address() as AddressInfo;
    let stopped = false;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      dbPath,
      staticDir,
      tmp,
      sqlite,
      db,
      calls,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        try {
          await new Promise<void>((resolve) => {
            listening.close(() => resolve());
            listening.closeAllConnections();
          });
        } finally {
          sqlite.close();
        }
      },
    };
  } catch (err) {
    server?.close();
    sqlite.close();
    throw err;
  }
}

function writeFixture(tmp: string): void {
  const staticDir = path.join(tmp, 'public');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), SHELL);
  fs.writeFileSync(path.join(staticDir, 'sw.js'), SW_BODY);
  fs.writeFileSync(path.join(staticDir, 'manifest.webmanifest'), MANIFEST_BODY);
  fs.writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), ASSET_BODY);
  fs.writeFileSync(path.join(tmp, 'secret.txt'), SECRET);
}

export interface HarnessContext {
  readonly h: Harness;
  get: (p: string, init?: RequestInit) => Promise<Response>;
  /** Stops the running app and boots a new one on the same DB_PATH. */
  restart: () => Promise<void>;
}

/**
 * Registers beforeEach/afterEach that boot a fresh app per test. Setup is failure-safe:
 * a failing boot removes the temp dir, and cleanup never depends on a stale harness.
 */
export function useHarness(options: HarnessOptions = {}): HarnessContext {
  let tmp: string | undefined;
  let current: Harness | undefined;

  beforeEach(async () => {
    current = undefined;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-pal-it-'));
    try {
      writeFixture(tmp);
      current = await boot(tmp, options);
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
      throw err;
    }
  });

  afterEach(async () => {
    const harness = current;
    const dir = tmp;
    current = undefined;
    tmp = undefined;
    try {
      await harness?.stop();
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const ctx: HarnessContext = {
    get h() {
      if (!current) throw new Error('Harness is not running.');
      return current;
    },
    get: (p, init) => fetch(ctx.h.baseUrl + p, init),
    restart: async () => {
      const dir = ctx.h.tmp;
      await ctx.h.stop();
      current = await boot(dir, options);
    },
  };
  return ctx;
}

/** Finds a currently free TCP port on 127.0.0.1. */
export async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) =>
    probe.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** True when something accepts TCP connections on 127.0.0.1:`port`. */
export function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}
