import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiRoot, loadConfig } from './config.js';

const SECRET = 'x'.repeat(32);

describe('loadConfig', () => {
  it('uses the documented defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3100,
      host: '127.0.0.1',
      dbPath: path.join(apiRoot, 'data', 'pantry.db'),
      staticDir: undefined,
      publicOrigin: 'http://localhost:3100',
      authSecret: 'dev-only-better-auth-secret-not-for-production',
      authUrl: 'http://localhost:3100',
      isProduction: false,
    });
  });

  it('resolves the default DB path inside the api package, not the cwd', () => {
    expect(path.basename(apiRoot)).toBe('pantry-pal');
  });

  it('uses every provided value in production', () => {
    const config = loadConfig({
      PORT: '4000',
      DB_PATH: '/tmp/x.db',
      STATIC_DIR: '/tmp/web',
      PUBLIC_ORIGIN: 'https://pantry.thirion.org',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: 'https://pantry.thirion.org',
    });
    expect(config).toEqual({
      port: 4000,
      host: '127.0.0.1',
      dbPath: path.resolve('/tmp/x.db'),
      staticDir: '/tmp/web',
      publicOrigin: 'https://pantry.thirion.org',
      authSecret: SECRET,
      authUrl: 'https://pantry.thirion.org',
      isProduction: true,
    });
  });

  it('binds 127.0.0.1 in production when HOST is unset', () => {
    expect(
      loadConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRET }).host,
    ).toBe('127.0.0.1');
  });

  it('allows another HOST outside production', () => {
    expect(loadConfig({ HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it.each(['0.0.0.0', 'localhost', '::', ''])(
    'rejects HOST %j in production',
    (host) => {
      expect(() => loadConfig({ NODE_ENV: 'production', HOST: host })).toThrow(
        /HOST.*production must bind 127\.0\.0\.1/,
      );
    },
  );

  it('treats only NODE_ENV=production as production', () => {
    expect(loadConfig({ NODE_ENV: 'Production' }).isProduction).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development' }).isProduction).toBe(false);
  });

  it('serializes PUBLIC_ORIGIN without a trailing slash', () => {
    expect(
      loadConfig({ PUBLIC_ORIGIN: 'https://pantry.thirion.org/' }).publicOrigin,
    ).toBe('https://pantry.thirion.org');
  });

  it.each(['abc', '0', '70000', '-1', '3.5', ''])('rejects PORT %j', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  it.each(['1', '65535'])('accepts boundary PORT %s', (port) => {
    expect(loadConfig({ PORT: port }).port).toBe(Number(port));
  });

  it.each([
    'not a url',
    'ftp://pantry.thirion.org',
    'https://pantry.thirion.org/app',
    'https://pantry.thirion.org/?x=1',
    'https://user@pantry.thirion.org',
    'https://user:secret@pantry.thirion.org',
    'https://:secret@pantry.thirion.org',
    'https://pantry.thirion.org/#frag',
  ])('rejects PUBLIC_ORIGIN %j', (origin) => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: origin })).toThrow(
      /PUBLIC_ORIGIN/,
    );
  });
});

describe('loadConfig auth settings', () => {
  const prod = { NODE_ENV: 'production' };

  it('requires BETTER_AUTH_SECRET in production without leaking anything', () => {
    expect(() => loadConfig(prod)).toThrow('BETTER_AUTH_SECRET is required');
  });

  it('rejects a short secret in production without echoing it', () => {
    const short = 'short-secret-value';
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: short })).toThrow(
      /at least 32/,
    );
    expect(() =>
      loadConfig({ ...prod, BETTER_AUTH_SECRET: short }),
    ).not.toThrow(new RegExp(short));
  });

  it('accepts a 32 character secret in production', () => {
    expect(loadConfig({ ...prod, BETTER_AUTH_SECRET: SECRET }).authSecret).toBe(
      SECRET,
    );
  });

  it('uses a provided secret outside production', () => {
    expect(loadConfig({ BETTER_AUTH_SECRET: 'abc' }).authSecret).toBe('abc');
  });

  it('defaults the auth URL to PUBLIC_ORIGIN', () => {
    expect(
      loadConfig({ PUBLIC_ORIGIN: 'https://pantry.thirion.org' }).authUrl,
    ).toBe('https://pantry.thirion.org');
  });

  it('rejects a BETTER_AUTH_URL that differs from PUBLIC_ORIGIN', () => {
    expect(() =>
      loadConfig({ BETTER_AUTH_URL: 'https://other.example' }),
    ).toThrow(/must match PUBLIC_ORIGIN/);
  });

  it('rejects a malformed BETTER_AUTH_URL', () => {
    expect(() => loadConfig({ BETTER_AUTH_URL: 'nope' })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
});
