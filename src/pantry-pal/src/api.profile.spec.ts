import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createHousehold, createUser } from './admin-commands.js';
import { ORIGIN, useHarness } from './api.harness.js';
import type { HarnessContext } from './api.harness.js';
import { session, user } from './db/schema.js';

const PASSWORD = 'correct horse';
const NEW_PASSWORD = 'battery staple';
const UNAUTHENTICATED =
  '{"error":{"code":"unauthenticated","message":"Authentication required."}}';

let ipCounter = 0;
const nextIp = () => `192.0.2.${(ipCounter += 1) % 250}`;

async function seedUser(ctx: HarnessContext, email: string) {
  const householdId = createHousehold(ctx.h.db, { name: `H ${email}` });
  return createUser(
    ctx.h.db,
    { email, name: email.split('@')[0], household: householdId },
    () => Promise.resolve(PASSWORD),
  );
}

async function signIn(
  ctx: HarnessContext,
  email: string,
  password: string,
): Promise<Response> {
  return ctx.get('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'X-Forwarded-For': nextIp(),
    },
    body: JSON.stringify({ email, password }),
  });
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

async function signedInCookie(ctx: HarnessContext, email: string) {
  const res = await signIn(ctx, email, PASSWORD);
  expect(res.status).toBe(200);
  return cookieOf(res);
}

function call(
  ctx: HarnessContext,
  method: string,
  path: string,
  o: { cookie?: string; body?: unknown; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  return ctx.get(path, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

describe('PATCH /api/me', () => {
  const ctx = useHarness();

  it('requires a session', async () => {
    const res = await call(ctx, 'PATCH', '/api/me', { body: { name: 'Sam' } });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(UNAUTHENTICATED);
  });

  it('updates the name, persists it and shows it on GET /api/me', async () => {
    const id = await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PATCH', '/api/me', {
      cookie,
      body: { name: '  Sam   Lee ' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id, name: 'Sam Lee', email: 'a@test.com' },
    });
    const row = ctx.h.db.select().from(user).where(eq(user.id, id)).get();
    expect(row?.name).toBe('Sam Lee');
    const me = await call(ctx, 'GET', '/api/me', { cookie });
    expect((await me.json()).user.name).toBe('Sam Lee');
  });

  it('never changes the email even when one is sent', async () => {
    const id = await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PATCH', '/api/me', {
      cookie,
      body: { name: 'Sam', email: 'evil@test.com' },
    });

    expect(res.status).toBe(200);
    expect(
      ctx.h.db.select().from(user).where(eq(user.id, id)).get()?.email,
    ).toBe('a@test.com');
  });

  it('only changes the caller, not another user', async () => {
    await seedUser(ctx, 'a@test.com');
    const otherId = await seedUser(ctx, 'b@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    await call(ctx, 'PATCH', '/api/me', { cookie, body: { name: 'Changed' } });

    expect(
      ctx.h.db.select().from(user).where(eq(user.id, otherId)).get()?.name,
    ).toBe('b');
  });

  it('rejects an invalid name with 400 and keeps the old name', async () => {
    const id = await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PATCH', '/api/me', {
      cookie,
      body: { name: 'a'.repeat(101) },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('name');
    expect(
      ctx.h.db.select().from(user).where(eq(user.id, id)).get()?.name,
    ).toBe('a');
  });

  it('rejects a cross-origin request with 403 and changes nothing', async () => {
    const id = await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PATCH', '/api/me', {
      cookie,
      origin: 'https://evil.example',
      body: { name: 'Hacked' },
    });

    expect(res.status).toBe(403);
    expect(
      ctx.h.db.select().from(user).where(eq(user.id, id)).get()?.name,
    ).toBe('a');
  });
});

describe('PUT /api/me/password', () => {
  const ctx = useHarness();

  it('requires a session', async () => {
    const res = await call(ctx, 'PUT', '/api/me/password', {
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(401);
  });

  it('changes the password: the new one signs in, the old one does not', async () => {
    await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(204);
    expect((await signIn(ctx, 'a@test.com', NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(ctx, 'a@test.com', PASSWORD)).status).toBe(401);
  });

  it('revokes other sessions and keeps the caller signed in', async () => {
    const id = await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');
    const otherCookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(204);
    expect(
      (await call(ctx, 'GET', '/api/me', { cookie: otherCookie })).status,
    ).toBe(401);
    const renewed = cookieOf(res);
    expect(renewed).not.toBe('');
    expect(
      (await call(ctx, 'GET', '/api/me', { cookie: renewed })).status,
    ).toBe(200);
    expect(
      ctx.h.db.select().from(session).where(eq(session.userId, id)).all(),
    ).toHaveLength(1);
  });

  it('rejects a wrong current password with 400 and keeps the old password', async () => {
    await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      body: { currentPassword: 'not the password', newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toEqual([
      { path: 'currentPassword', message: 'Current password is incorrect.' },
    ]);
    expect((await signIn(ctx, 'a@test.com', PASSWORD)).status).toBe(200);
  });

  it('rejects a short new password with 400', async () => {
    await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: 'short' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].path).toBe('newPassword');
  });

  it('limits wrong current passwords to 5 per minute per user', async () => {
    await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');
    const attempt = () =>
      call(ctx, 'PUT', '/api/me/password', {
        cookie,
        body: {
          currentPassword: 'not the password',
          newPassword: NEW_PASSWORD,
        },
      });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(400);

    const limited = await attempt();

    expect(limited.status).toBe(429);
    const correct = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(correct.status).toBe(429);
    expect((await signIn(ctx, 'a@test.com', PASSWORD)).status).toBe(200);
  });

  it('rejects a cross-origin request with 403 and changes nothing', async () => {
    await seedUser(ctx, 'a@test.com');
    const cookie = await signedInCookie(ctx, 'a@test.com');

    const res = await call(ctx, 'PUT', '/api/me/password', {
      cookie,
      origin: 'https://evil.example',
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(res.status).toBe(403);
    expect((await signIn(ctx, 'a@test.com', PASSWORD)).status).toBe(200);
  });
});
