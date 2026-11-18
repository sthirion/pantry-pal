import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './apiClient';

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('parses a JSON body and sends same-origin credentials', async () => {
    const fetchMock = stubFetch(new Response('{"a":1}', { status: 200 }));
    await expect(apiRequest<{ a: number }>('/api/x')).resolves.toEqual({
      a: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('serialises the body with a JSON content type', async () => {
    const fetchMock = stubFetch(new Response('', { status: 200 }));
    await apiRequest('/api/x', { method: 'POST', body: { k: 'v' } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"k":"v"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('resolves undefined for an empty body', async () => {
    stubFetch(new Response('', { status: 200 }));
    await expect(apiRequest('/api/x')).resolves.toBeUndefined();
  });

  it('throws an ApiError carrying the status for non-2xx responses', async () => {
    stubFetch(new Response('{}', { status: 429 }));
    await expect(apiRequest('/api/x')).rejects.toEqual(expect.any(ApiError));
    await expect(apiRequest('/api/x')).rejects.toMatchObject({ status: 429 });
  });
});
