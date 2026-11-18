export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

/** Sends a same-origin JSON request; throws `ApiError` for any non-2xx response. */
export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) throw new ApiError(response.status);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
