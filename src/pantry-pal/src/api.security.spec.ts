import { describe, expect, it } from 'vitest';
import { ORIGIN, sameOrigin, useHarness } from './api.harness.js';

const FORBIDDEN = '{"error":{"code":"forbidden","message":"Forbidden."}}';

const CONTENT_TYPES: [string, string | undefined][] = [
  ['application/json', '{}'],
  ['application/x-www-form-urlencoded', 'a=1'],
  ['multipart/form-data; boundary=x', '--x--'],
  ['text/plain', '{}'],
  ['none', undefined],
];

function request(origin: string | undefined, site: string | undefined) {
  return (contentType: string, body: string | undefined, method = 'POST') => ({
    method,
    headers: {
      ...(origin !== undefined && { Origin: origin }),
      ...(site !== undefined && { 'Sec-Fetch-Site': site }),
      ...(contentType !== 'none' && { 'Content-Type': contentType }),
    },
    ...(body !== undefined && { body }),
  });
}

describe('AC-10 CSRF protection', () => {
  const ctx = useHarness();

  const rejectedCases: [string | undefined, string | undefined][] = [
    ['https://evil.example', undefined],
    ['https://evil.example', 'same-origin'],
    ['null', undefined],
    ['http://pantry.thirion.org', undefined],
    ['https://pantry.thirion.org:8443', undefined],
    ['https://sub.pantry.thirion.org', undefined],
    [`${ORIGIN}.evil.example`, undefined],
    [undefined, 'cross-site'],
  ];

  describe.each(rejectedCases)('Origin=%s Sec-Fetch-Site=%s', (o, s) => {
    it.each(CONTENT_TYPES)(
      'Post_With%sContent_Returns403ExactBodyAndHandlerDoesNotRun',
      async (contentType, body) => {
        // Given a request that fails the origin rule
        const before = ctx.h.calls.echo;

        // When it posts with this content type
        const res = await ctx.get(
          '/api/test/echo',
          request(o, s)(contentType, body),
        );

        // Then 403 with the exact body and the handler never runs
        expect(res.status).toBe(403);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.text()).toBe(FORBIDDEN);
        expect(ctx.h.calls.echo).toBe(before);
      },
    );
  });

  const passingCases: [string | undefined, string | undefined][] = [
    [ORIGIN, undefined],
    [ORIGIN, 'cross-site'],
    [undefined, undefined],
    [undefined, 'same-origin'],
    [undefined, 'same-site'],
    [undefined, 'none'],
  ];

  describe.each(passingCases)('Origin=%s Sec-Fetch-Site=%s', (o, s) => {
    it.each(CONTENT_TYPES)(
      'Post_With%sContent_PassesAndHandlerRuns',
      async (contentType, body) => {
        // Given a request that satisfies the origin rule
        const before = ctx.h.calls.echo;

        // When it posts with this content type
        const res = await ctx.get(
          '/api/test/echo',
          request(o, s)(contentType, body),
        );

        // Then the handler runs
        expect(res.status).toBe(200);
        expect(ctx.h.calls.echo).toBe(before + 1);
      },
    );
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'Request_CrossOrigin%s_Returns403AndHandlerDoesNotRun',
    async (method) => {
      // Given a request from another origin
      // When it uses this unsafe method
      const res = await ctx.get('/api/test/echo', {
        method,
        headers: { Origin: 'https://evil.example' },
        body: '{}',
      });

      // Then 403 and the handler does not run
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN);
      expect(ctx.h.calls.echo).toBe(0);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'Request_SameOrigin%s_PassesAndHandlerRuns',
    async (method) => {
      // Given the configured origin
      // When it uses this unsafe method
      const res = await ctx.get('/api/test/echo', {
        method,
        headers: sameOrigin,
      });

      // Then the handler runs
      expect(res.status).toBe(200);
      expect(ctx.h.calls.echo).toBe(1);
    },
  );

  it('Put_CrossOriginWithInvalidBody_Returns403NotValidation400', async () => {
    // Given a cross-origin request carrying an invalid body
    // When it is sent to a validated route
    const res = await ctx.get('/api/test/list', {
      method: 'PUT',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: '{not json',
    });

    // Then the CSRF check wins before body parsing
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(FORBIDDEN);
  });

  it('Post_CrossOriginToUnknownApiPath_Returns403Not404', async () => {
    // Given a cross-origin POST
    // When it targets an unregistered path
    const res = await ctx.get('/api/nope', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });

    // Then CSRF rejects it before routing
    expect(res.status).toBe(403);
  });

  it('Post_SameOriginToUnknownApiPath_ReachesRoutingAndReturns404', async () => {
    // Given a same-origin POST
    // When it targets an unregistered path
    const res = await ctx.get('/api/nope', {
      method: 'POST',
      headers: sameOrigin,
    });

    // Then it passes CSRF and gets the not_found error
    expect(res.status).toBe(404);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'Request_Safe%sFromCrossSite_IsNeverRejectedByCsrf',
    async (method) => {
      // Given a safe method with a hostile Origin and Sec-Fetch-Site
      // When it is sent
      const res = await ctx.get('/api/health', {
        method,
        headers: {
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      });

      // Then CSRF does not reject it (200 for GET/HEAD, routing result for OPTIONS)
      expect(res.status).not.toBe(403);
      if (method !== 'OPTIONS') expect(res.status).toBe(200);
    },
  );

  it('Request_Options_ReachesRoutingWithoutCors', async () => {
    // Given a cross-origin preflight to an unregistered route
    // When it is sent
    const res = await ctx.get('/api/test/echo', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
        'Access-Control-Request-Method': 'POST',
      },
    });

    // Then it is not a 403 and not a successful preflight
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(204);
  });

  it('Request_AnyResponse_HasNoCorsHeaders', async () => {
    // Given same-origin, cross-origin reads, a preflight, a 403 and a 404
    const responses = await Promise.all([
      ctx.get('/api/health', { headers: sameOrigin }),
      ctx.get('/api/health', { headers: { Origin: 'https://evil.example' } }),
      ctx.get('/api/test/echo', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      ctx.get('/api/test/echo', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      }),
      ctx.get('/api/x', { headers: sameOrigin }),
    ]);

    // When their headers are read
    // Then none grants CORS access
    for (const res of responses) {
      for (const h of [
        'access-control-allow-origin',
        'access-control-allow-credentials',
        'access-control-allow-methods',
      ]) {
        expect(res.headers.get(h)).toBeNull();
      }
    }
  });
});

describe('AC-11 security headers', () => {
  const ctx = useHarness();

  const expectSecure = (res: Response) => {
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    const hsts = res.headers.get('strict-transport-security') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(15552000);
    expect(hsts).toContain('includeSubDomains');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  };

  const cases: [string, number, string, RequestInit | undefined][] = [
    ['200 health', 200, '/api/health', undefined],
    [
      '400 validation',
      400,
      '/api/test/list',
      {
        method: 'PUT',
        headers: { ...sameOrigin, 'Content-Type': 'application/json' },
        body: '{}',
      },
    ],
    [
      '403 CSRF',
      403,
      '/api/test/echo',
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
    ],
    ['404 API', 404, '/api/missing', undefined],
    ['500 error', 500, '/api/test/throw', undefined],
    ['index.html', 200, '/', undefined],
    ['SPA fallback', 200, '/lists/abc', undefined],
    ['static asset', 200, '/assets/app-abc123.js', undefined],
  ];

  it.each(cases)(
    'Response_On%s_CarriesSecurityHeaders',
    async (_name, status, p, init) => {
      // Given any kind of response
      // When requested
      const res = await ctx.get(p, init);

      // Then the expected status is returned with every security header and no X-Powered-By
      expect(res.status).toBe(status);
      expectSecure(res);
    },
  );
});
