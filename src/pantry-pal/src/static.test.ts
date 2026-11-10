import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { isApiPath, resolveInside } from './static.js';

let root: string;
let staticDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-static-'));
  staticDir = path.join(root, 'web');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>app</html>');
  fs.writeFileSync(path.join(staticDir, 'sw.js'), 'sw');
  fs.writeFileSync(path.join(staticDir, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(staticDir, 'assets', 'index-a1b2c3.js'), 'js');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
  const config: Config = {
    port: 3100,
    host: '127.0.0.1',
    dbPath: ':memory:',
    staticDir,
    publicOrigin: 'http://localhost:3100',
    isProduction: false,
  };
  app = createApp({ config });
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('static serving', () => {
  it.each(['/', '/lists/abc'])('serves index.html for %s', async (p) => {
    const res = await app.request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe('<html>app</html>');
  });

  it.each([
    ['/sw.js', 'sw', 'javascript'],
    ['/manifest.webmanifest', '{}', 'application/manifest+json'],
  ])('serves %s with no-cache', async (p, body, mime) => {
    const res = await app.request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toContain(mime);
    expect(await res.text()).toBe(body);
  });

  it('serves hashed assets as immutable JavaScript', async () => {
    const res = await app.request('/assets/index-a1b2c3.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await res.text()).toBe('js');
  });

  it('returns 404 JSON for a missing asset, never immutable', async () => {
    const res = await app.request('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBeNull();
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('never falls back to index.html for /api paths', async () => {
    const res = await app.request('/api/x');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'Not found.' },
    });
  });

  it('returns 404 JSON for a same-origin POST to a non-API path', async () => {
    const res = await app.request('/lists/abc', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3100' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e/%2e%2e/secret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/%E0%A4%A',
  ])('never serves a file outside STATIC_DIR for %s', async (p) => {
    const res = await app.request(p);
    expect(await res.text()).not.toContain('secret');
  });

  it('sets security headers on static responses', async () => {
    const res = await app.request('/');
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns 404 JSON when index.html is missing', async () => {
    const empty = fs.mkdtempSync(path.join(root, 'empty-'));
    const bare = createApp({
      config: {
        port: 1,
        host: '127.0.0.1',
        dbPath: ':memory:',
        staticDir: empty,
        publicOrigin: 'http://localhost:3100',
        isProduction: false,
      },
    });
    expect((await bare.request('/')).status).toBe(404);
  });
});

describe('resolveInside', () => {
  it('resolves a path inside the root', () => {
    expect(resolveInside(staticDir, '/sw.js')).toBe(
      path.join(staticDir, 'sw.js'),
    );
  });

  it.each(['/../x', '/%2e%2e/x', '/a%00b', '/a\\..\\..\\x', '/%zz'])(
    'rejects %s',
    (p) => {
      expect(resolveInside(staticDir, p)).toBeUndefined();
    },
  );
});

describe('isApiPath', () => {
  it.each([
    ['/api', true],
    ['/api/x', true],
    ['/apixyz', false],
    ['/lists', false],
  ])('%s -> %s', (p, expected) => {
    expect(isApiPath(p)).toBe(expected);
  });
});
