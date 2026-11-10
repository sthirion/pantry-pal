import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  staticDir: string | undefined;
  publicOrigin: string;
  isProduction: boolean;
}

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PUBLIC_ORIGIN = 'http://localhost:3100';

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

function parsePublicOrigin(raw: string | undefined): string {
  const value = raw ?? DEFAULT_PUBLIC_ORIGIN;
  const invalid = new Error(
    `Invalid PUBLIC_ORIGIN "${value}": must be an http(s) origin without a path.`,
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && env.HOST !== undefined && env.HOST !== DEFAULT_HOST) {
    throw new Error(
      `Invalid HOST "${env.HOST}": production must bind ${DEFAULT_HOST}.`,
    );
  }
  return {
    port: parsePort(env.PORT),
    host: isProduction ? DEFAULT_HOST : env.HOST || DEFAULT_HOST,
    dbPath: env.DB_PATH
      ? path.resolve(env.DB_PATH)
      : path.join(apiRoot, 'data', 'pantry.db'),
    staticDir: env.STATIC_DIR ? env.STATIC_DIR : undefined,
    publicOrigin: parsePublicOrigin(env.PUBLIC_ORIGIN),
    isProduction,
  };
}
