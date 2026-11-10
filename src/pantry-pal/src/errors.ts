import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  ApiError,
  ApiErrorCode,
  ApiErrorDetail,
} from '@pantry-pal/shared';

/** Thrown by the validation helpers; mapped to `400 validation_failed`. */
export class ValidationError extends Error {
  constructor(public readonly details: ApiErrorDetail[]) {
    super('Request is invalid.');
    this.name = 'ValidationError';
  }
}

interface ErrorRow {
  status: ContentfulStatusCode;
  code: ApiErrorCode;
  message: string;
}

const INTERNAL: ErrorRow = {
  status: 500,
  code: 'internal_error',
  message: 'An unexpected error occurred.',
};

const ERROR_ROWS: Record<number, ErrorRow> = {
  400: {
    status: 400,
    code: 'validation_failed',
    message: 'Request is invalid.',
  },
  401: {
    status: 401,
    code: 'unauthenticated',
    message: 'Authentication required.',
  },
  403: { status: 403, code: 'forbidden', message: 'Forbidden.' },
  404: { status: 404, code: 'not_found', message: 'Not found.' },
  409: { status: 409, code: 'name_taken', message: 'Name is already in use.' },
  429: { status: 429, code: 'rate_limited', message: 'Too many requests.' },
  500: INTERNAL,
};

export function errorResponse(
  c: Context,
  row: ErrorRow,
  details?: ApiErrorDetail[],
): Response {
  const body: ApiError = {
    error: {
      code: row.code,
      message: row.message,
      ...(details && { details }),
    },
  };
  return c.json(body, row.status);
}

export function forbiddenResponse(c: Context): Response {
  return errorResponse(c, ERROR_ROWS[403]!);
}

export function notFoundResponse(c: Context): Response {
  return errorResponse(c, ERROR_ROWS[404]!);
}

/** Hono `onError` handler: fixed code/message per status, never any internal detail. */
export function handleError(err: unknown, c: Context): Response {
  if (err instanceof ValidationError) {
    return errorResponse(c, ERROR_ROWS[400]!, err.details);
  }
  if (err instanceof HTTPException) {
    const row = ERROR_ROWS[err.status] ?? INTERNAL;
    return errorResponse(
      c,
      row,
      row.status === 400 ? [{ path: '', message: row.message }] : undefined,
    );
  }
  return errorResponse(c, INTERNAL);
}
