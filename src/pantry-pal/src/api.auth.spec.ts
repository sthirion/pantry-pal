import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createHousehold,
  createUser,
  resetPassword,
} from './admin-commands.js';
import { ORIGIN, sameOrigin, useHarness } from './api.harness.js';
import type { HarnessContext } from './api.harness.js';
import { account, session, user } from './db/schema.js';

const PASSWORD = 'correct horse';
const UNAUTHENTICATED =
  '{"error":{"code":"unauthenticated","message":"Authentication required."}}';

const prompt = (pw: string) => () => Promise.resolve(pw);

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

async function seedUser(
  ctx: HarnessContext,
  email: string,
  householdId?: string,
) {
  const id = await createUser(
    ctx.h.db,
    { email, name: email.split('@')[0], household: householdId },
    prompt(PASSWORD),
  );
  return id;
}

function signIn(
  ctx: HarnessContext,
  email: string,
  password: string,
  ip = nextIp(),
) {
  return ctx.get('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

async function signedInCookie(
  ctx: HarnessContext,
  email: string,
  password = PASSWORD,
): Promise<string> {
  const res = await signIn(ctx, email, password);
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

const withCookie = (cookie: string) => ({ headers: { Cookie: cookie } });

describe('sign-in and /api/me', () => {
  const ctx = useHarness();

  it('AC-1 signs in, sets a hardened cookie and returns only user and household', async () => {
    const householdId = createHousehold(ctx.h.db, { name: 'Household A' });
    const userId = await seedUser(ctx, 'a1@test.com', householdId);

    const res = await signIn(ctx, 'A1@Test.com', PASSWORD);

    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().join('\n');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toMatch(/Secure/i);

    const me = await ctx.get(
      '/api/me',
      withCookie(res.headers.getSetCookie()[0]!.split(';')[0]!),
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: { id: userId, name: 'a1', email: 'a1@test.com' },
      household: { id: householdId, name: 'Household A' },
    });
  });

  it('AC-2 gives identical 401 responses for a wrong password and an unknown email', async () => {
    await seedUser(
      ctx,
      'a1@test.com',
      createHousehold(ctx.h.db, { name: 'A' }),
    );

    const wrong = await signIn(ctx, 'a1@test.com', 'wrong password');
    const unknown = await signIn(ctx, 'nobody@test.com', 'wrong password');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongBody = await wrong.text();
    expect(wrongBody).toBe(UNAUTHENTICATED);
    expect(await unknown.text()).toBe(wrongBody);
    expect(wrong.headers.getSetCookie()).toEqual([]);
    expect(unknown.headers.getSetCookie()).toEqual([]);
  });

  it('AC-3 limits sign-in to 5 per minute per IP and returns 429 in project format', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await signIn(ctx, 'x@test.com', 'wrong password', ip)).status,
      ).toBe(401);
    }

    const limited = await signIn(ctx, 'x@test.com', 'wrong password', ip);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests.' },
    });
    expect(
      limited.headers.get('X-Retry-After') ??
        limited.headers.get('Retry-After'),
    ).toMatch(/^\d+$/);
    const other = await signIn(
      ctx,
      'x@test.com',
      'wrong password',
      '198.51.100.8',
    );
    expect(other.status).toBe(401);
  });

  it('AC-4 rejects sign-up and creates nothing', async () => {
    const res = await ctx.get('/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': nextIp(),
      },
      body: JSON.stringify({
        email: 'new@test.com',
        password: PASSWORD,
        name: 'New',
      }),
    });

    expect(res.ok).toBe(false);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(ctx.h.db.select().from(user).all()).toHaveLength(0);
    expect(ctx.h.db.select().from(account).all()).toHaveLength(0);
  });

  it.each([
    ['POST', '/api/auth/change-password'],
    ['POST', '/api/auth/update-user'],
    ['GET', '/api/auth/list-sessions'],
    ['POST', '/api/auth/revoke-sessions'],
    ['POST', '/api/auth/request-password-reset'],
    ['GET', '/api/auth/sign-in/email'],
    ['GET', '/api/auth/unknown'],
  ])('AC-5 %s %s is closed with 404', async (method, path) => {
    const res = await ctx.get(path, {
      method,
      headers: { 'X-Forwarded-For': nextIp() },
      ...(method === 'POST' && { body: '{}' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('allows get-session without a cookie', async () => {
    const res = await ctx.get('/api/auth/get-session', {
      headers: { 'X-Forwarded-For': nextIp() },
    });
    expect(res.status).toBe(200);
  });

  it('still applies the origin check to sign-in', async () => {
    const res = await ctx.get('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ email: 'a@test.com', password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });
});

describe('guards', () => {
  const ctx = useHarness();

  it('AC-6 returns 401 for a missing, garbage, expired or revoked session', async () => {
    const householdId = createHousehold(ctx.h.db, { name: 'A' });
    await seedUser(ctx, 'a1@test.com', householdId);

    const none = await ctx.get('/api/test/guarded');
    expect(none.status).toBe(401);
    expect(await none.text()).toBe(UNAUTHENTICATED);
    expect(
      (
        await ctx.get(
          '/api/test/guarded',
          withCookie('better-auth.session_token=garbage'),
        )
      ).status,
    ).toBe(401);

    const expired = await signedInCookie(ctx, 'a1@test.com');
    ctx.h.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();
    expect(
      (await ctx.get('/api/test/guarded', withCookie(expired))).status,
    ).toBe(401);

    const revoked = await signedInCookie(ctx, 'a1@test.com');
    ctx.h.db.delete(session).run();
    expect(
      (await ctx.get('/api/test/guarded', withCookie(revoked))).status,
    ).toBe(401);
  });

  it('AC-6 returns 403 for a user without a household', async () => {
    ctx.h.db
      .insert(user)
      .values({
        id: 'u-orphan',
        name: 'Orphan',
        email: 'orphan@test.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    // Credential created through the CLI path is not possible without a household, so reuse a hash.
    const householdId = createHousehold(ctx.h.db, { name: 'tmp' });
    const donor = await seedUser(ctx, 'donor@test.com', householdId);
    const hash = ctx.h.db
      .select()
      .from(account)
      .where(eq(account.userId, donor))
      .get()!.password;
    ctx.h.db
      .insert(account)
      .values({
        id: 'acc-orphan',
        accountId: 'u-orphan',
        providerId: 'credential',
        userId: 'u-orphan',
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const cookie = await signedInCookie(ctx, 'orphan@test.com');

    const session200 = await ctx.get(
      '/api/test/session-only',
      withCookie(cookie),
    );
    const res = await ctx.get('/api/test/guarded', withCookie(cookie));
    const me = await ctx.get('/api/me', withCookie(cookie));

    expect(session200.status).toBe(200);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(
      '{"error":{"code":"forbidden","message":"Forbidden."}}',
    );
    expect(me.status).toBe(403);
  });

  it('AC-6 hands each member their own householdId from the database', async () => {
    const a = createHousehold(ctx.h.db, { name: 'A' });
    const b = createHousehold(ctx.h.db, { name: 'B' });
    await seedUser(ctx, 'a1@test.com', a);
    const b1 = await seedUser(ctx, 'b1@test.com', b);

    const res = await ctx.get('/api/test/guarded?householdId=' + a, {
      headers: {
        Cookie: await signedInCookie(ctx, 'b1@test.com'),
        'X-Household-Id': a,
      },
    });

    expect(await res.json()).toEqual({ userId: b1, householdId: b });
  });
});

describe('sessions', () => {
  const ctx = useHarness();

  it('AC-7 sign-out revokes only the current session', async () => {
    await seedUser(
      ctx,
      'a1@test.com',
      createHousehold(ctx.h.db, { name: 'A' }),
    );
    const first = await signedInCookie(ctx, 'a1@test.com');
    const second = await signedInCookie(ctx, 'a1@test.com');

    const out = await ctx.get('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        Cookie: first,
        ...sameOrigin,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(out.status).toBe(200);
    expect(ctx.h.db.select().from(session).all()).toHaveLength(1);
    expect((await ctx.get('/api/me', withCookie(first))).status).toBe(401);
    expect((await ctx.get('/api/me', withCookie(second))).status).toBe(200);
  });

  it('AC-10 password reset revokes every session and swaps the credential', async () => {
    await seedUser(
      ctx,
      'a1@test.com',
      createHousehold(ctx.h.db, { name: 'A' }),
    );
    const first = await signedInCookie(ctx, 'a1@test.com');
    const second = await signedInCookie(ctx, 'a1@test.com');

    await resetPassword(
      ctx.h.db,
      { email: 'a1@test.com' },
      prompt('brand new pw'),
    );

    expect((await ctx.get('/api/me', withCookie(first))).status).toBe(401);
    expect((await ctx.get('/api/me', withCookie(second))).status).toBe(401);
    expect((await signIn(ctx, 'a1@test.com', PASSWORD)).status).toBe(401);
    expect((await signIn(ctx, 'a1@test.com', 'brand new pw')).status).toBe(200);
  });
});

describe('production cookies', () => {
  const ctx = useHarness({ production: true });

  it('AC-1 marks the session cookie Secure in production', async () => {
    await seedUser(
      ctx,
      'a1@test.com',
      createHousehold(ctx.h.db, { name: 'A' }),
    );

    const res = await signIn(ctx, 'a1@test.com', PASSWORD);

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/Secure/i);
    expect(ORIGIN).toMatch(/^https:/);
  });
});
