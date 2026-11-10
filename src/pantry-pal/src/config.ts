import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  staticDir: string | undefined;
  publicOrigin: string;
  /** Better Auth signing secret; required in production. */
  authSecret: string;
  /** Better Auth base URL; defaults to publicOrigin. */
  authUrl: string;
  isProduction: boolean;
}

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PUBLIC_ORIGIN = 'http://localhost:3100';
const DEV_AUTH_SECRET = 'dev-only-better-auth-secret-not-for-production';
const MIN_SECRET_LENGTH = 32;

/** API package root (parent of `src/` or `dist/`), independent of the working directory. */
export const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT "${raw}": must be an integer from 1 to 65535.`,
    );
  }
  return port;
}

function parseOrigin(name: string, value: string): string {
  const invalid = new Error(
    `Invalid ${name} "${value}": must be an http(s) origin without a path.`,
  );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid;
  }
  const isOriginOnly =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  if (!isOriginOnly) throw invalid;
  return url.origin;
}

function parseAuthSecret(
  raw: string | undefined,
  isProduction: boolean,
): string {
  if (!raw) {
    if (isProduction) {
      throw new Error('BETTER_AUTH_SECRET is required in production.');
    }
    return DEV_AUTH_SECRET;
  }
  if (isProduction && raw.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && env.HOST !== undefined && env.HOST !== DEFAULT_HOST) {
    throw new Error(
      `Invalid HOST "${env.HOST}": production must bind ${DEFAULT_HOST}.`,
    );
  }
  const publicOrigin = parseOrigin(
    'PUBLIC_ORIGIN',
    env.PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN,
  );
  const authUrl = env.BETTER_AUTH_URL
    ? parseOrigin('BETTER_AUTH_URL', env.BETTER_AUTH_URL)
    : publicOrigin;
  if (authUrl !== publicOrigin) {
    throw new Error(
      'BETTER_AUTH_URL must match PUBLIC_ORIGIN (they name the same site).',
    );
  }
  return {
    port: parsePort(env.PORT),
    host: isProduction ? DEFAULT_HOST : env.HOST || DEFAULT_HOST,
    dbPath: env.DB_PATH
      ? path.resolve(env.DB_PATH)
      : path.join(apiRoot, 'data', 'pantry.db'),
    staticDir: env.STATIC_DIR ? env.STATIC_DIR : undefined,
    publicOrigin,
    authSecret: parseAuthSecret(env.BETTER_AUTH_SECRET, isProduction),
    authUrl,
    isProduction,
  };
}
