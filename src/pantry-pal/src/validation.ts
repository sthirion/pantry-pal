import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiErrorDetail } from '@pantry-pal/shared';
import { ValidationError } from './errors.js';

/** Runs a parser and appends its validation details instead of throwing, so every bad input is reported. */
export async function collect<T>(
  details: ApiErrorDetail[],
  parse: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await parse();
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    details.push(...err.details);
    return undefined;
  }
}

/** Parses `value` with a shared schema; throws `ValidationError` listing each failing path. */
export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Reads a JSON body (content type must be application/json) and validates it. */
export async function parseJsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  const invalid = (message: string) =>
    new ValidationError([{ path: '', message }]);
  const contentType = c.req.header('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw invalid('Content-Type must be application/json.');
  }
  let json: unknown;
  try {
    json = JSON.parse(await c.req.text());
  } catch {
    throw invalid('Body must be valid JSON.');
  }
  return parseWith(schema, json);
}
