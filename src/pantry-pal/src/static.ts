import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';
import { notFoundResponse } from './errors.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';

export function isApiPath(requestPath: string): boolean {
  return requestPath === '/api' || requestPath.startsWith('/api/');
}

/** Resolves a request path to a file inside `root`; returns undefined when it escapes `root`. */
export function resolveInside(
  root: string,
  requestPath: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, '.' + decoded);
  return target.startsWith(resolvedRoot + path.sep) ? target : undefined;
}

async function readFileIfExists(file: string): Promise<Buffer | undefined> {
  try {
    if (!(await fs.stat(file)).isFile()) return undefined;
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

function fileResponse(c: Context, file: string, body: Buffer, cache: string) {
  c.header(
    'Content-Type',
    MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
  );
  c.header('Cache-Control', cache);
  return c.body(new Uint8Array(body));
}

/**
 * Serves the built PWA: files by path, `index.html` as SPA fallback for navigations,
 * a 404 JSON error for missing `/assets/*` files. Never called for `/api/*`.
 */
export async function serveStatic(
  c: Context,
  staticDir: string,
): Promise<Response> {
  const requestPath = c.req.path;
  const isAsset = requestPath.startsWith('/assets/');
  if (requestPath !== '/') {
    const target = resolveInside(staticDir, requestPath);
    if (target === undefined) return notFoundResponse(c);
    const body = await readFileIfExists(target);
    if (body)
      return fileResponse(c, target, body, isAsset ? IMMUTABLE : 'no-cache');
  }
  if (isAsset) return notFoundResponse(c);

  const indexFile = path.join(path.resolve(staticDir), 'index.html');
  const index = await readFileIfExists(indexFile);
  return index
    ? fileResponse(c, indexFile, index, 'no-cache')
    : notFoundResponse(c);
}
