import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.js';
import { handleError } from '../errors.js';
import { registerProfileRoutes } from './profile.js';

const JSON_HEADERS = {
  'x-user': 'u1',
  'Content-Type': 'application/json',
};

const updateUser = vi.fn();
const changePassword = vi.fn();

// The fake session is chosen by the x-user header; no header means no session.
const fakeAuth = {
  api: {
    getSession: ({ headers }: { headers: Headers }) => {
      const id = headers.get('x-user');
      return Promise.resolve({
        response: id
          ? { user: { id, name: id, email: `${id}@example.com` } }
          : null,
        headers: new Headers(),
      });
    },
    updateUser,
    changePassword,
  },
} as unknown as Auth;

let clock: number;
let app: Hono;

function cookieHeaders(...cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return headers;
}

function send(
  method: string,
  path: string,
  body: unknown,
  headers: HeadersInit = JSON_HEADERS,
) {
  return app.request(path, {
    method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const patchMe = (body: unknown, headers?: HeadersInit) =>
  send('PATCH', '/api/me', body, headers);
const putPassword = (body: unknown, headers?: HeadersInit) =>
  send('PUT', '/api/me/password', body, headers);

const validPassword = {
  currentPassword: 'old password',
  newPassword: 'new password',
};

const wrongPassword = () =>
  new APIError('BAD_REQUEST', {
    message: 'Invalid password',
    code: 'INVALID_PASSWORD',
  });

beforeEach(() => {
  updateUser.mockReset();
  changePassword.mockReset();
  updateUser.mockResolvedValue({ headers: cookieHeaders(), response: {} });
  changePassword.mockResolvedValue({ headers: cookieHeaders(), response: {} });
  clock = 1_000_000;
  app = new Hono();
  app.onError(handleError);
  registerProfileRoutes(app, { auth: fakeAuth, now: () => clock });
});

describe('PATCH /api/me', () => {
  it('returns 401 without a session and does not update', async () => {
    const res = await patchMe(
      { name: 'Sam' },
      { 'Content-Type': 'application/json' },
    );

    expect(res.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('updates the name for the session user and returns the new user', async () => {
    const res = await patchMe({ name: '  Sam   Lee ' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 'u1', name: 'Sam Lee', email: 'u1@example.com' },
    });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.calls[0]![0]).toMatchObject({
      body: { name: 'Sam Lee' },
    });
  });

  it('sends only the name to Better Auth, never email or image', async () => {
    await patchMe({ name: 'Sam', email: 'evil@example.com', image: 'x' });

    expect(updateUser.mock.calls[0]![0].body).toEqual({ name: 'Sam' });
  });

  it('forwards cookies set by Better Auth', async () => {
    updateUser.mockResolvedValue({
      headers: cookieHeaders('session=abc; HttpOnly'),
      response: {},
    });

    const res = await patchMe({ name: 'Sam' });

    expect(res.headers.getSetCookie()).toEqual(['session=abc; HttpOnly']);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a 101-character name', { name: 'a'.repeat(101) }],
    ['a missing name', {}],
    ['a non-string name', { name: 5 }],
  ])('returns 400 for %s without updating', async (_label, body) => {
    const res = await patchMe(body);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('validation_failed');
    expect(json.error.details[0].path).toBe('name');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-JSON content type', async () => {
    const res = await patchMe('name=Sam', {
      'x-user': 'u1',
      'Content-Type': 'text/plain',
    });

    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('returns 500 without leaking detail when Better Auth fails', async () => {
    updateUser.mockRejectedValue(new Error('db password=XYZ'));

    const res = await patchMe({ name: 'Sam' });

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('XYZ');
  });
});

describe('PUT /api/me/password', () => {
  it('returns 401 without a session and does not change the password', async () => {
    const res = await putPassword(validPassword, {
      'Content-Type': 'application/json',
    });

    expect(res.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes the password, revokes other sessions and returns 204', async () => {
    const res = await putPassword(validPassword);

    expect(res.status).toBe(204);
    expect(changePassword.mock.calls[0]![0].body).toEqual({
      currentPassword: 'old password',
      newPassword: 'new password',
      revokeOtherSessions: true,
    });
  });

  it('forwards the replacement session cookie', async () => {
    changePassword.mockResolvedValue({
      headers: cookieHeaders('session=new; HttpOnly'),
      response: {},
    });

    const res = await putPassword(validPassword);

    expect(res.headers.getSetCookie()).toEqual(['session=new; HttpOnly']);
  });

  it.each([
    [
      'a short new password',
      { ...validPassword, newPassword: 'short' },
      'newPassword',
    ],
    [
      'a too-long new password',
      { ...validPassword, newPassword: 'a'.repeat(129) },
      'newPassword',
    ],
    [
      'an unchanged password',
      { currentPassword: 'same password', newPassword: 'same password' },
      'newPassword',
    ],
    [
      'a missing current password',
      { newPassword: 'new password' },
      'currentPassword',
    ],
  ])(
    'returns 400 for %s without calling Better Auth',
    async (_label, body, path) => {
      const res = await putPassword(body);

      expect(res.status).toBe(400);
      expect((await res.json()).error.details[0].path).toBe(path);
      expect(changePassword).not.toHaveBeenCalled();
    },
  );

  it('returns 400 on currentPassword when the current password is wrong', async () => {
    changePassword.mockRejectedValue(wrongPassword());

    const res = await putPassword(validPassword);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Request is invalid.',
        details: [
          {
            path: 'currentPassword',
            message: 'Current password is incorrect.',
          },
        ],
      },
    });
  });

  it('returns 500 for any other Better Auth failure', async () => {
    changePassword.mockRejectedValue(
      new APIError('BAD_REQUEST', {
        message: 'Credential account not found',
        code: 'CREDENTIAL_ACCOUNT_NOT_FOUND',
      }),
    );

    const res = await putPassword(validPassword);

    expect(res.status).toBe(500);
  });

  it('blocks the sixth wrong attempt within a minute with 429 and skips the check', async () => {
    changePassword.mockRejectedValue(wrongPassword());
    for (let i = 0; i < 5; i += 1) {
      expect((await putPassword(validPassword)).status).toBe(400);
    }

    const res = await putPassword(validPassword);

    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
    expect(changePassword).toHaveBeenCalledTimes(5);
  });

  it('keeps blocking at 59.999 seconds and allows attempts at 60 seconds', async () => {
    changePassword.mockRejectedValue(wrongPassword());
    for (let i = 0; i < 5; i += 1) await putPassword(validPassword);

    clock += 59_999;
    expect((await putPassword(validPassword)).status).toBe(429);

    clock += 1;
    expect((await putPassword(validPassword)).status).toBe(400);
  });

  it('counts concurrent wrong attempts so no more than five reach Better Auth', async () => {
    changePassword.mockImplementation(async () => {
      await Promise.resolve();
      throw wrongPassword();
    });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => putPassword(validPassword)),
    );

    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    expect(changePassword).toHaveBeenCalledTimes(5);
  });

  it('does not count a Better Auth failure that is not a wrong password', async () => {
    changePassword.mockRejectedValue(new Error('db down'));
    for (let i = 0; i < 6; i += 1) {
      expect((await putPassword(validPassword)).status).toBe(500);
    }

    expect(changePassword).toHaveBeenCalledTimes(6);
  });

  it('limits attempts per user', async () => {
    changePassword.mockRejectedValue(wrongPassword());
    for (let i = 0; i < 5; i += 1) await putPassword(validPassword);

    const other = await putPassword(validPassword, {
      ...JSON_HEADERS,
      'x-user': 'u2',
    });

    expect(other.status).toBe(400);
  });

  it('clears the failure count after a successful change', async () => {
    changePassword.mockRejectedValue(wrongPassword());
    for (let i = 0; i < 4; i += 1) await putPassword(validPassword);
    changePassword.mockResolvedValueOnce({
      headers: cookieHeaders(),
      response: {},
    });
    expect((await putPassword(validPassword)).status).toBe(204);

    changePassword.mockRejectedValue(wrongPassword());
    for (let i = 0; i < 4; i += 1) {
      expect((await putPassword(validPassword)).status).toBe(400);
    }
  });
});
