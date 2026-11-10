import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { putListBodySchema } from '@pantry-pal/shared';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { parseJsonBody, parseWith } from './validation.js';

const ORIGIN = 'https://pantry.thirion.org';
const config: Config = {
  port: 3100,
  host: '127.0.0.1',
  dbPath: ':memory:',
  staticDir: undefined,
  publicOrigin: ORIGIN,
  authSecret: 'test-secret',
  authUrl: ORIGIN,
  isProduction: false,
};

function buildApp(overrides: Partial<Config> = {}) {
  return createApp({
    config: { ...config, ...overrides },
    registerRoutes: (app: Hono) => {
      app.get('/api/test/throw', () => {
        throw new Error('token=XYZ987');
      });
      app.get('/api/test/throw-string', () => {
        throw 'boom';
      });
      app.get('/api/test/http/:status', (c) => {
        throw new HTTPException(Number(c.req.param('status')) as 400, {
          message: 'internal detail',
        });
      });
      app.put('/api/test/list', async (c) =>
        c.json(await parseJsonBody(c, putListBodySchema)),
      );
      app.post('/api/test/echo', (c) => c.json({ ok: true }));
      app.get('/api/test/query', (c) =>
        c.json(
          parseWith(
            z.object({ n: z.coerce.number().int().min(1) }),
            c.req.query(),
          ),
        ),
      );
    },
  });
}

const sameOrigin = { Origin: ORIGIN };
const body = JSON.stringify({
  name: '  Rural   King ',
  changedAt: '2026-11-09T18:00:00Z',
});
const json = { ...sameOrigin, 'Content-Type': 'application/json' };

describe('health and 404', () => {
  it('returns ok', async () => {
    const res = await buildApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it.each(['/api/x', '/api/lists/abc/unknown', '/lists/abc'])(
    'returns the not_found JSON error for %s',
    async (p) => {
      const res = await buildApp().request(p);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        error: { code: 'not_found', message: 'Not found.' },
      });
    },
  );

  it('returns 404 JSON for a same-origin POST to a non-API path', async () => {
    const res = await buildApp().request('/lists/abc', {
      method: 'POST',
      headers: sameOrigin,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'not_found',
    );
  });
});

describe('error handling', () => {
  it('maps an unexpected Error to a detail-free 500', async () => {
    const res = await buildApp({ isProduction: true }).request(
      '/api/test/throw',
    );
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toBe(
      '{"error":{"code":"internal_error","message":"An unexpected error occurred."}}',
    );
  });

  it('maps a thrown string to the same 500', async () => {
    const res = await buildApp().request('/api/test/throw-string');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('boom');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });

  it.each([
    [400, 'validation_failed', 'Request is invalid.'],
    [401, 'unauthenticated', 'Authentication required.'],
    [403, 'forbidden', 'Forbidden.'],
    [404, 'not_found', 'Not found.'],
    [409, 'name_taken', 'Name is already in use.'],
    [429, 'rate_limited', 'Too many requests.'],
    [500, 'internal_error', 'An unexpected error occurred.'],
    [418, 'internal_error', 'An unexpected error occurred.'],
    [503, 'internal_error', 'An unexpected error occurred.'],
  ])('maps HTTPException %i to %s', async (status, code, message) => {
    const res = await buildApp().request(`/api/test/http/${status}`);
    const text = await res.text();
    expect(res.status).toBe(code === 'internal_error' ? 500 : status);
    expect(text).not.toContain('internal detail');
    const parsed = JSON.parse(text);
    expect(parsed.error.code).toBe(code);
    expect(parsed.error.message).toBe(message);
    expect(parsed.error.details).toEqual(
      status === 400 ? [{ path: '', message }] : undefined,
    );
  });
});

describe('validation', () => {
  it('passes the parsed value to the handler', async () => {
    const res = await buildApp().request('/api/test/list', {
      method: 'PUT',
      headers: json,
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: 'Rural King',
      changedAt: '2026-11-09T18:00:00Z',
    });
  });

  it('lists each failing field path', async () => {
    const res = await buildApp().request('/api/test/list', {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed.error.code).toBe('validation_failed');
    expect(parsed.error.details.map((d: { path: string }) => d.path)).toEqual([
      'name',
      'changedAt',
    ]);
    expect(parsed.error.details[0].message).toBe(
      'Must be 1 to 100 characters.',
    );
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await buildApp().request('/api/test/list', {
      method: 'PUT',
      headers: json,
      body: '{nope',
    });
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed.error.details).toHaveLength(1);
    expect(parsed.error.details[0].path).toBe('');
  });

  it('returns 400 for a non-JSON content type', async () => {
    const res = await buildApp().request('/api/test/list', {
      method: 'PUT',
      headers: { ...sameOrigin, 'Content-Type': 'text/plain' },
      body,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('');
  });

  it('reports query failures with the field name', async () => {
    const res = await buildApp().request('/api/test/query?n=0');
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('n');
  });
});

describe('CSRF origin check', () => {
  const send = (method: string, headers: Record<string, string>) =>
    buildApp().request('/api/test/echo', { method, headers });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s passes with the exact origin',
    async (method) => {
      const res = await buildApp().request('/api/test/echo', {
        method,
        headers: sameOrigin,
      });
      // echo is registered for POST only; others reach routing and 404.
      expect(res.status).toBe(method === 'POST' ? 200 : 404);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects a mismatched Origin on %s',
    async (method) => {
      const res = await send(method, { Origin: 'https://evil.example' });
      expect(res.status).toBe(403);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects an absent Origin with cross-site on %s',
    async (method) => {
      const res = await send(method, { 'Sec-Fetch-Site': 'cross-site' });
      expect(res.status).toBe(403);
    },
  );

  it.each([
    'https://evil.example',
    'null',
    'http://pantry.thirion.org',
    'https://pantry.thirion.org:8443',
    'https://sub.pantry.thirion.org',
    '',
  ])('rejects Origin %j', async (origin) => {
    const res = await send('POST', {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Forbidden.' },
    });
  });

  it.each([
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain',
  ])(
    'rejects a cross-origin %s request before parsing the body',
    async (type) => {
      const res = await buildApp().request('/api/test/list', {
        method: 'PUT',
        headers: { Origin: 'https://evil.example', 'Content-Type': type },
        body: 'garbage',
      });
      expect(res.status).toBe(403);
    },
  );

  it('rejects an absent Origin with Sec-Fetch-Site cross-site', async () => {
    expect(
      (await send('POST', { 'Sec-Fetch-Site': 'cross-site' })).status,
    ).toBe(403);
  });

  it.each(['same-origin', 'same-site', 'none', undefined])(
    'allows an absent Origin with Sec-Fetch-Site %s',
    async (site) => {
      const res = await send('POST', site ? { 'Sec-Fetch-Site': site } : {});
      expect(res.status).toBe(200);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])('never rejects %s', async (method) => {
    const res = await buildApp().request('/api/health', {
      method,
      headers: {
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    expect(res.status).not.toBe(403);
  });

  it('sends no CORS headers, even for OPTIONS', async () => {
    for (const method of ['GET', 'OPTIONS']) {
      const res = await buildApp().request('/api/health', {
        method,
        headers: { Origin: ORIGIN },
      });
      for (const [name] of res.headers) {
        expect(name.toLowerCase()).not.toMatch(/^access-control-/);
      }
    }
  });
});

describe('security headers', () => {
  it.each([
    ['/api/health', {}, 200],
    ['/api/x', {}, 404],
    ['/api/test/throw', {}, 500],
    ['/api/test/list', { method: 'PUT', headers: json, body: '{' }, 400],
    [
      '/api/test/echo',
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
      403,
    ],
  ] as const)('sets them on %s (%i)', async (p, init, status) => {
    const res = await buildApp().request(p, init as RequestInit);
    expect(res.status).toBe(status);
    expect(res.headers.get('strict-transport-security')).toMatch(
      /max-age=(\d+); includeSubDomains/,
    );
    const maxAge = Number(
      /max-age=(\d+)/.exec(res.headers.get('strict-transport-security')!)![1],
    );
    expect(maxAge).toBeGreaterThanOrEqual(15552000);
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});
