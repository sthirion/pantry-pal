import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiClient';
import { authService } from './authService';

const fetchMock = vi.fn();

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('authService', () => {
  it('requests the current session from /api/me', async () => {
    fetchMock.mockReturnValue(ok({ user: { id: 'u1' } }));

    const me = await authService.getMe();

    expect(me).toEqual({ user: { id: 'u1' } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('posts the credentials to the email sign-in endpoint', async () => {
    fetchMock.mockReturnValue(ok({}));

    await authService.signIn({ email: 'sam@example.com', password: 'secret' });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/sign-in/email');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'sam@example.com',
      password: 'secret',
    });
  });

  it('posts an empty JSON object to sign out', async () => {
    fetchMock.mockReturnValue(ok({ success: true }));

    await authService.signOut();

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/sign-out');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  it('surfaces a rejected sign-in as an ApiError with its status', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve(new Response('{}', { status: 401 })),
    );

    await expect(
      authService.signIn({ email: 'a@b.c', password: 'x' }),
    ).rejects.toEqual(expect.any(ApiError));
  });
});
