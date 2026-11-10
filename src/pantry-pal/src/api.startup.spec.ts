import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freePort, isListening, ORIGIN } from './api.harness.js';
import { startServer } from './server.js';

let tmp: string;
let dbPath: string;
let started: Server | undefined;

beforeEach(() => {
  started = undefined;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-pal-start-'));
  dbPath = path.join(tmp, 'data', 'pantry.db');
});

afterEach(async () => {
  try {
    const server = started;
    started = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  } finally {
    // startServer keeps its SQLite handle open; on Windows the file may stay locked.
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // best effort: the OS temp dir is cleaned up later
    }
  }
});

describe('AC-3 real startup refuses to listen on invalid configuration', () => {
  it.each(['0.0.0.0', 'localhost', '::', ''])(
    'StartServer_InProductionWithHost"%s"_ThrowsBeforeListeningOrCreatingDb',
    async (host) => {
      // Given production mode with a non-loopback HOST and a free PORT
      const port = await freePort();
      const env = {
        NODE_ENV: 'production',
        HOST: host,
        PORT: String(port),
        DB_PATH: dbPath,
        PUBLIC_ORIGIN: ORIGIN,
      };

      // When the real server startup runs
      const start = () => startServer(env);

      // Then it fails naming HOST and 127.0.0.1, nothing listens and no DB is created
      expect(start).toThrow(/HOST.*127\.0\.0\.1/);
      expect(await isListening(port)).toBe(false);
      expect(fs.existsSync(dbPath)).toBe(false);
    },
  );

  it.each([
    ['PORT', { PORT: 'abc' }],
    ['PORT', { PORT: '0' }],
    ['PORT', { PORT: '70000' }],
    ['PUBLIC_ORIGIN', { PUBLIC_ORIGIN: 'not a url' }],
    ['PUBLIC_ORIGIN', { PUBLIC_ORIGIN: 'ftp://pantry.thirion.org' }],
    ['PUBLIC_ORIGIN', { PUBLIC_ORIGIN: 'https://pantry.thirion.org/app' }],
  ])(
    'StartServer_WithInvalid%s_ThrowsBeforeCreatingDb %j',
    (name, override) => {
      // Given an invalid environment value
      const env = { DB_PATH: dbPath, ...override };

      // When the real server startup runs
      const start = () => startServer(env);

      // Then it fails naming the variable and creates no database
      expect(start).toThrow(new RegExp(name));
      expect(fs.existsSync(dbPath)).toBe(false);
    },
  );

  it('StartServer_WithDbPathUnderARegularFile_ThrowsWithoutListening', async () => {
    // Given DB_PATH located under an existing regular file
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const port = await freePort();

    // When the real server startup runs
    const start = () =>
      startServer({
        PORT: String(port),
        DB_PATH: path.join(blocker, 'sub', 'pantry.db'),
        PUBLIC_ORIGIN: ORIGIN,
      });

    // Then it fails and nothing listens on PORT
    expect(start).toThrow();
    expect(await isListening(port)).toBe(false);
  });
});

describe('AC-3 real startup in production', () => {
  it('StartServer_InProductionWithoutHost_ListensOnLoopbackOnlyAndServesHealth', async () => {
    // Given production mode with HOST unset
    const port = await freePort();

    // When the real server starts
    started = startServer({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      PORT: String(port),
      DB_PATH: dbPath,
      PUBLIC_ORIGIN: ORIGIN,
    }) as Server;
    await new Promise<void>((resolve) => {
      if (started?.listening) resolve();
      else started?.once('listening', () => resolve());
    });
    const address = started.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);

    // Then it is bound to 127.0.0.1 and health returns ok
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBe(port);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
