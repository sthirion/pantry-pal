import { describe, expect, it } from 'vitest';
import { sameOrigin, useHarness } from './api.harness.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}

const json = { ...sameOrigin, 'Content-Type': 'application/json' };

describe('AC-7 validation failures', () => {
  const ctx = useHarness();
  const put = (body: string, headers: Record<string, string> = json) =>
    ctx.get('/api/test/list', { method: 'PUT', headers, body });

  it('PutList_WithInvalidBody_Returns400WithExactDetailPaths', async () => {
    // Given a body violating the shared schema in two fields
    // When it is sent to a validated route
    const res = await put(
      JSON.stringify({ name: '   ', changedAt: 'not-a-date' }),
    );

    // Then 400 validation_failed with one dot-path detail per failing field
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe('Request is invalid.');
    expect(body.error.details?.map((d) => d.path)).toEqual([
      'name',
      'changedAt',
    ]);
    expect(body.error.details?.[0]?.message).toBe(
      'Must be 1 to 100 characters.',
    );
    expect(body.error.details?.[1]?.message).toBeTruthy();
  });

  it('DeleteItems_WithInvalidIdAtIndexThree_ReportsDottedArrayPath', async () => {
    // Given an itemIds array whose fourth entry is not a UUID
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'nope',
    ];

    // When it is sent to the validated route
    const res = await ctx.get('/api/test/items', {
      method: 'DELETE',
      headers: json,
      body: JSON.stringify({ itemIds: ids, changedAt: '2026-11-09T18:00:00Z' }),
    });

    // Then the detail path is "itemIds.3"
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.details?.map((d) => d.path)).toEqual(['itemIds.3']);
    expect(body.error.details?.[0]?.message).toBeTruthy();
  });

  it('PutList_WithMalformedJson_Returns400WithSingleRootDetail', async () => {
    // Given a malformed JSON body
    // When it is sent
    const res = await put('{not json');

    // Then 400 validation_failed (not 500) with one detail at path ""
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toHaveLength(1);
    expect(body.error.details?.[0]?.path).toBe('');
    expect(body.error.details?.[0]?.message).toBeTruthy();
  });

  it('PutList_WithTextPlainContentType_Returns400WithSingleRootDetail', async () => {
    // Given a valid JSON payload declared as text/plain
    // When it is sent to a JSON route
    const res = await put(
      JSON.stringify({ name: 'Milk', changedAt: '2026-11-09T18:00:00Z' }),
      { ...sameOrigin, 'Content-Type': 'text/plain' },
    );

    // Then 400 validation_failed (not 500) with one detail at path ""
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toHaveLength(1);
    expect(body.error.details?.[0]?.path).toBe('');
    expect(body.error.details?.[0]?.message).toBeTruthy();
  });

  it('PutList_WithValidBody_ReturnsTrimmedAndCollapsedValue', async () => {
    // Given a valid body whose name has extra whitespace
    // When it is sent
    const res = await put(
      JSON.stringify({
        name: '  Rural   King  ',
        changedAt: '2026-11-09T18:00:00+02:00',
      }),
    );

    // Then the handler received the transformed value and no error is returned
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: 'Rural King',
      changedAt: '2026-11-09T18:00:00+02:00',
    });
  });
});

describe.each([
  ['development', false],
  ['production', true],
])('AC-8 unexpected errors in %s mode', (_mode, production) => {
  const ctx = useHarness({ production });
  const INTERNAL = {
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    },
  };

  it.each(['throw', 'throw-string', 'throw-object'])(
    'Get_WhenHandlerThrows_%s_Returns500ExactBodyWithoutLeak',
    async (route) => {
      // Given a route that throws an Error / string / plain object carrying internal detail
      // When requested
      const res = await ctx.get(`/api/test/${route}`);
      const text = await res.text();

      // Then the exact generic 500 body is returned and nothing leaks
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(text).toBe(JSON.stringify(INTERNAL));
      expect(text).not.toMatch(/XYZ987|boom|secret\.ts|stack|details/);
    },
  );

  const rows: [number, number, string, string, boolean][] = [
    [400, 400, 'validation_failed', 'Request is invalid.', true],
    [401, 401, 'unauthenticated', 'Authentication required.', false],
    [403, 403, 'forbidden', 'Forbidden.', false],
    [404, 404, 'not_found', 'Not found.', false],
    [409, 409, 'name_taken', 'Name is already in use.', false],
    [429, 429, 'rate_limited', 'Too many requests.', false],
    [500, 500, 'internal_error', 'An unexpected error occurred.', false],
    [418, 500, 'internal_error', 'An unexpected error occurred.', false],
    [503, 500, 'internal_error', 'An unexpected error occurred.', false],
  ];
  it.each(rows)(
    'Get_WhenHandlerThrowsHttpException%i_Returns%i%s',
    async (thrown, status, code, message, hasDetail) => {
      // Given a route throwing an HTTPException with an internal message
      // When requested
      const res = await ctx.get(`/api/test/http/${thrown}`);
      const text = await res.text();

      // Then the complete body is the fixed row, never the internal message
      expect(res.status).toBe(status);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(text)).toEqual({
        error: {
          code,
          message,
          ...(hasDetail && { details: [{ path: '', message }] }),
        },
      });
      expect(text).not.toContain('internal detail');
    },
  );
});

describe('AC-9 unknown API routes', () => {
  const ctx = useHarness();

  it.each(['/api/x', '/api/lists/abc/unknown', '/api'])(
    'Get_UnknownApiPath_Returns404JsonNeverIndexHtml %s',
    async (p) => {
      // Given STATIC_DIR is configured with an index.html
      // When an unknown API path is requested
      const res = await ctx.get(p);
      const text = await res.text();

      // Then the exact JSON 404, not the SPA shell
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(text).toBe(
        '{"error":{"code":"not_found","message":"Not found."}}',
      );
    },
  );

  it('Post_UnknownApiPathSameOrigin_Returns404Json', async () => {
    // Given a same-origin POST
    // When it targets an unknown API path
    const res = await ctx.get('/api/nope', {
      method: 'POST',
      headers: sameOrigin,
    });

    // Then 404 JSON
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'Not found.' },
    });
  });
});

describe('AC-9 without STATIC_DIR', () => {
  const ctx = useHarness({ withStatic: false });

  it.each(['/lists/abc', '/'])(
    'Get_ClientRouteWithStaticDirUnset_Returns404Json %s',
    async (p) => {
      // Given STATIC_DIR is unset
      // When a client route is requested
      const res = await ctx.get(p);
      const text = await res.text();

      // Then the same JSON 404 as for unknown API routes
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(text).toBe(
        '{"error":{"code":"not_found","message":"Not found."}}',
      );
    },
  );

  it('Get_UnknownApiPathWithStaticDirUnset_Returns404Json', async () => {
    // Given STATIC_DIR is unset
    // When an unknown API path is requested
    const res = await ctx.get('/api/x');

    // Then 404 JSON
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
