import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, apiRequest } from './services/apiClient';
import { authService } from './services/authService';

const wiremockRoot = join(import.meta.dirname, '..', 'wiremock');

interface Mapping {
  name: string;
  scenarioName?: string;
  requiredScenarioState?: string;
  newScenarioState?: string;
  priority?: number;
  request: {
    urlPath: string;
    method: string;
    bodyPatterns?: { matchesJsonPath: string }[];
  };
  response: {
    status: number;
    bodyFileName?: string;
    jsonBody?: unknown;
    headers?: Record<string, string>;
  };
}

const readJson = <T>(path: string) =>
  JSON.parse(readFileSync(join(wiremockRoot, path), 'utf8')) as T;
const { mappings } = readJson<{ mappings: Mapping[] }>(
  'mappings/auth-stubs.json',
);
const overrides = [
  'mappings/auth-stubs.me-error.json.bak',
  'mappings/auth-stubs.sign-out-error.json.bak',
].flatMap((path) => readJson<{ mappings: Mapping[] }>(path).mappings);

const find = (fragment: string) =>
  mappings.find((m) => m.name.includes(fragment))!;

describe('WireMock auth stubs', () => {
  it('only reference body files that exist', () => {
    for (const mapping of [...mappings, ...overrides]) {
      const file = mapping.response.bodyFileName;
      if (file) {
        expect(
          existsSync(join(wiremockRoot, '__files', file)),
          `${mapping.name} -> ${file}`,
        ).toBe(true);
      }
    }
  });

  it('cover the endpoints the frontend calls', () => {
    const endpoints = mappings.map(
      (m) => `${m.request.method} ${m.request.urlPath}`,
    );
    expect(endpoints).toEqual(
      expect.arrayContaining([
        'GET /api/me',
        'POST /api/auth/sign-in/email',
        'POST /api/auth/sign-out',
      ]),
    );
  });

  it('model the session scenario: signed out, sign in, signed in, sign out', () => {
    expect(find('signed out').requiredScenarioState).toBe('Started');
    expect(find('signed out').response.status).toBe(401);
    expect(find('Me - signed in').requiredScenarioState).toBe('signed-in');
    expect(find('Me - signed in').response.status).toBe(200);
    expect(find('default success').newScenarioState).toBe('signed-in');
    expect(find('Sign out').newScenarioState).toBe('Started');
  });

  it('return the status each sign-in failure trigger documents', () => {
    expect(find('wrong password').response.status).toBe(401);
    expect(find('rate limited').response.status).toBe(429);
    expect(find('rate limited').response.headers?.['Retry-After']).toBe('60');
    expect(find('server error').response.status).toBe(500);
  });

  it('let the failure triggers win over the default success stub', () => {
    const fallback = find('default success').priority!;
    for (const fragment of ['wrong password', 'rate limited', 'server error']) {
      expect(find(fragment).priority!).toBeLessThan(fallback);
    }
  });

  it('keep the optional failure overrides above every other stub', () => {
    const lowest = Math.min(...mappings.map((m) => m.priority!));
    expect(overrides).toHaveLength(2);
    for (const override of overrides) {
      expect(override.response.status).toBe(500);
      expect(override.priority!).toBeLessThan(lowest);
    }
  });

  it('serve a /api/me body that matches the shape the frontend reads', () => {
    const me = readJson<{
      user: { id: string; name: string; email: string };
      household: { id: string; name: string };
    }>('__files/auth/me/response.json');

    expect(me.user).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
    });
    expect(me.household).toEqual({
      id: expect.any(String),
      name: expect.any(String),
    });
  });

  it.each([
    ['401', 'unauthenticated'],
    ['429', undefined],
    ['500', undefined],
  ])('serve a %s error body with a code and message', (status, code) => {
    const body = readJson<{ error: { code: string; message: string } }>(
      `__files/auth/errors/${status}.json`,
    );

    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    if (code) expect(body.error.code).toBe(code);
  });
});

describe('frontend client against stubbed responses', () => {
  const stubFetch = (mapping: Mapping) => {
    const file = mapping.response.bodyFileName;
    const body = file
      ? readFileSync(join(wiremockRoot, '__files', file), 'utf8')
      : JSON.stringify(mapping.response.jsonBody);
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(body, { status: mapping.response.status }),
      )) as typeof fetch;
  };

  it('parses the signed-in /api/me stub', async () => {
    stubFetch(find('Me - signed in'));

    const me = await authService.getMe();

    expect(me.user.name).toBe('Sam');
    expect(me.household.name).toBe('The Smiths');
  });

  it.each([
    ['signed out', 401],
    ['wrong password', 401],
    ['rate limited', 429],
    ['server error', 500],
  ])('raises an ApiError for the %s stub', async (fragment, status) => {
    stubFetch(find(fragment));

    await expect(apiRequest('/api/anything')).rejects.toEqual(
      expect.objectContaining({ name: ApiError.name, status }),
    );
  });

  it('resolves the sign-out stub', async () => {
    stubFetch(find('Sign out'));

    await expect(authService.signOut()).resolves.toEqual({ success: true });
  });
});
