import { describe, expect, it } from 'vitest';
import {
  ASSET_BODY,
  MANIFEST_BODY,
  SECRET,
  SHELL,
  SW_BODY,
  sameOrigin,
  useHarness,
} from './api.harness.js';

const NOT_FOUND = '{"error":{"code":"not_found","message":"Not found."}}';

describe('AC-12 static PWA serving and caching', () => {
  const ctx = useHarness();

  it.each(['/', '/lists/abc'])(
    'Get_%s_ServesIndexHtmlAsTextHtmlNoCache',
    async (p) => {
      // Given STATIC_DIR with index.html
      // When requesting the root or a client-side route without a file
      const res = await ctx.get(p);

      // Then the shell is served as text/html and must be revalidated
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toBe(SHELL);
    },
  );

  it.each([
    ['/sw.js', SW_BODY, 'text/javascript'],
    ['/manifest.webmanifest', MANIFEST_BODY, 'application/manifest+json'],
  ])('Get_%s_ServesFileBodyWithNoCache', async (p, body, type) => {
    // Given a service worker / manifest file
    // When requested
    const res = await ctx.get(p);

    // Then its exact body is served with the right type and no-cache
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(type);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(body);
  });

  it('Get_HashedAsset_IsImmutable', async () => {
    // Given a hashed asset
    // When requested
    const res = await ctx.get('/assets/app-abc123.js');

    // Then it is cached for a year as immutable
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toBe(ASSET_BODY);
  });

  it('Get_MissingAsset_Returns404JsonNotIndexHtmlAndNeverImmutable', async () => {
    // Given an asset that does not exist
    // When requested
    const res = await ctx.get('/assets/missing-zzz.js');
    const text = await res.text();

    // Then exact JSON 404 without an immutable cache policy
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(text).toBe(NOT_FOUND);
    expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
  });

  it.each([
    '/assets/..%2f..%2fsecret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/..%5c..%5csecret.txt',
    '/%00',
  ])('Get_PathTraversal_IsBlocked %s', async (p) => {
    // Given a secret file outside STATIC_DIR
    // When a traversal path is requested
    const res = await ctx.get(p);
    const text = await res.text();

    // Then the file is never served
    expect(text).not.toContain(SECRET);
    expect([404, 400]).toContain(res.status);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'Request_Same%sOriginToNonApiPath_Returns404JsonNotIndexHtml',
    async (method) => {
      // Given a same-origin unsafe request to a SPA route
      // When sent
      const res = await ctx.get('/lists/abc', { method, headers: sameOrigin });
      const text = await res.text();

      // Then 404 JSON, not the shell
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(text).toBe(NOT_FOUND);
    },
  );

  it('Get_UnknownApiPath_Returns404JsonNeverIndexHtml', async () => {
    // Given STATIC_DIR is configured
    // When an unknown API path is requested
    const res = await ctx.get('/api/x');

    // Then the JSON 404, never the shell
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND);
  });
});
