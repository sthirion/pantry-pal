// fetch wrapper (design doc §8.1 http.mjs): retries on 429/5xx honoring Retry-After (max 3),
// redacts Authorization in error output, and small JSON/patch helpers. `fetchImpl` is always
// injectable so tests never touch the network.
import { Buffer } from 'node:buffer';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_RETRIES = 3;

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Returns a copy of `headers` with Authorization redacted — use before logging, throwing,
 * or printing a --dry-run request (§11 security: tokens must never appear in output). */
export function redactHeaders(headers = {}) {
  const redacted = { ...headers };
  for (const key of Object.keys(redacted)) {
    if (key.toLowerCase() === 'authorization') redacted[key] = '[redacted]';
  }
  return redacted;
}

/** Builds the Authorization header for a resolved auth object ({ token, scheme }) from
 * adlc-lib/auth.mjs. Basic scheme sends `:<token>` (PAT convention, e.g. ADO). */
export function authHeader(auth) {
  if (!auth) return {};
  if (auth.scheme === 'Basic') return { Authorization: `Basic ${Buffer.from(`:${auth.token}`).toString('base64')}` };
  return { Authorization: `Bearer ${auth.token}` };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Performs one logical HTTP call with retry-on-transient-failure. Returns the raw Response
 * on success (2xx); throws HttpError (with Authorization redacted in the message) otherwise.
 * `sleepImpl` is injectable so tests can assert retry behavior without real delays. */
export async function request(url, { method = 'GET', headers = {}, body, fetchImpl = fetch, maxRetries = DEFAULT_MAX_RETRIES, sleepImpl = sleep } = {}) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body });
    } catch (err) {
      throw new HttpError(`Network error calling ${method} ${url}: ${err.message}`, {});
    }
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
      const retryAfterHeader = Number(res.headers?.get?.('retry-after'));
      const waitMs = (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2 ** attempt) * 1000;
      await sleepImpl(waitMs);
      attempt++;
      continue;
    }
    if (!res.ok) {
      const text = await safeText(res);
      const detail = extractErrorDetail(text);
      throw new HttpError(
        `${method} ${url} failed: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`,
        { status: res.status, body: text }
      );
    }
    return res;
  }
}

function extractErrorDetail(text) {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    return parsed.message ?? parsed.error?.message ?? '';
  } catch {
    return text.slice(0, 300);
  }
}

/** Convenience wrapper: performs `request` and parses the body as JSON (or returns null for
 * an empty body, e.g. 204 No Content). */
export async function requestJson(url, opts) {
  const res = await request(url, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
