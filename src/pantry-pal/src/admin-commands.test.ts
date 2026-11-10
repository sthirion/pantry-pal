import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CliError,
  createHousehold,
  createUser,
  normalizeEmail,
  readNewPassword,
  resetPassword,
  type PasswordPrompt,
} from './admin-commands.js';
import {
  createDatabase,
  openSqlite,
  runMigrations,
  type AppDatabase,
} from './db/database.js';
import {
  account,
  household,
  householdMember,
  session,
  user,
} from './db/schema.js';

const PASSWORD = 'correct horse';

function prompts(...answers: string[]): PasswordPrompt {
  const queue = [...answers];
  return () => Promise.resolve(queue.shift() ?? '');
}

function counts(db: AppDatabase) {
  return {
    users: db.select().from(user).all().length,
    accounts: db.select().from(account).all().length,
    members: db.select().from(householdMember).all().length,
  };
}

let db: AppDatabase;
beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  A1@Test.COM ')).toBe('a1@test.com');
  });

  it.each(['', 'nope', 'a@', '@b.com'])('rejects %j', (raw) => {
    expect(() => normalizeEmail(raw)).toThrow(CliError);
  });
});

describe('readNewPassword', () => {
  it('returns the password when both entries match', async () => {
    expect(await readNewPassword(prompts(PASSWORD, PASSWORD))).toBe(PASSWORD);
  });

  it('rejects entries that do not match', async () => {
    await expect(
      readNewPassword(prompts(PASSWORD, `${PASSWORD}!`)),
    ).rejects.toThrow('do not match');
  });

  it('rejects a password shorter than 8 characters', async () => {
    await expect(
      readNewPassword(prompts('1234567', '1234567')),
    ).rejects.toThrow('8 to 128');
  });

  it('accepts 8 and 128 characters, rejects 129', async () => {
    const eight = 'a'.repeat(8);
    const max = 'a'.repeat(128);
    expect(await readNewPassword(prompts(eight, eight))).toBe(eight);
    expect(await readNewPassword(prompts(max, max))).toBe(max);
    const tooLong = 'a'.repeat(129);
    await expect(readNewPassword(prompts(tooLong, tooLong))).rejects.toThrow(
      '8 to 128',
    );
  });
});

describe('createHousehold', () => {
  it('creates a household with a UUID id and a trimmed name', () => {
    const id = createHousehold(db, { name: '  Smiths ' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = db.select().from(household).where(eq(household.id, id)).get();
    expect(row?.name).toBe('Smiths');
  });

  it.each([undefined, '', '   '])(
    'rejects name %j and writes nothing',
    (name) => {
      expect(() => createHousehold(db, { name })).toThrow('required');
      expect(db.select().from(household).all()).toHaveLength(0);
    },
  );
});

describe('createUser', () => {
  let householdId: string;
  beforeEach(() => {
    householdId = createHousehold(db, { name: 'A' });
  });

  const options = () => ({
    email: ' A1@Test.com ',
    name: 'Ann',
    household: householdId,
  });

  it('creates user, credential account and membership with a verifiable hash', async () => {
    const id = await createUser(db, options(), prompts(PASSWORD, PASSWORD));

    const u = db.select().from(user).where(eq(user.id, id)).get();
    expect(u).toMatchObject({ email: 'a1@test.com', name: 'Ann' });
    const acc = db.select().from(account).where(eq(account.userId, id)).get();
    expect(acc?.providerId).toBe('credential');
    expect(acc?.password).not.toContain(PASSWORD);
    expect(
      await verifyPassword({ hash: acc!.password!, password: PASSWORD }),
    ).toBe(true);
    const member = db
      .select()
      .from(householdMember)
      .where(eq(householdMember.userId, id))
      .get();
    expect(member).toMatchObject({ householdId, role: 'member' });
  });

  it('rejects an unknown household and writes nothing', async () => {
    await expect(
      createUser(
        db,
        { ...options(), household: 'nope' },
        prompts(PASSWORD, PASSWORD),
      ),
    ).rejects.toThrow('Household not found');
    expect(counts(db)).toEqual({ users: 0, accounts: 0, members: 0 });
  });

  it('rejects a duplicate email regardless of case and writes nothing more', async () => {
    await createUser(db, options(), prompts(PASSWORD, PASSWORD));
    await expect(
      createUser(
        db,
        { ...options(), email: 'a1@TEST.com' },
        prompts(PASSWORD, PASSWORD),
      ),
    ).rejects.toThrow('already exists');
    expect(counts(db)).toEqual({ users: 1, accounts: 1, members: 1 });
  });

  it('rejects an invalid email', async () => {
    await expect(
      createUser(
        db,
        { ...options(), email: 'bad' },
        prompts(PASSWORD, PASSWORD),
      ),
    ).rejects.toThrow('Invalid email');
    expect(counts(db).users).toBe(0);
  });

  it.each(['email', 'name', 'household'] as const)(
    'requires %s',
    async (key) => {
      await expect(
        createUser(
          db,
          { ...options(), [key]: '' },
          prompts(PASSWORD, PASSWORD),
        ),
      ).rejects.toThrow('required');
      expect(counts(db).users).toBe(0);
    },
  );

  it('rejects mismatched or short passwords and writes nothing', async () => {
    await expect(
      createUser(db, options(), prompts(PASSWORD, 'different one')),
    ).rejects.toThrow('do not match');
    await expect(
      createUser(db, options(), prompts('short', 'short')),
    ).rejects.toThrow('8 to 128');
    expect(counts(db)).toEqual({ users: 0, accounts: 0, members: 0 });
  });
});

describe('resetPassword', () => {
  let userId: string;
  beforeEach(async () => {
    const householdId = createHousehold(db, { name: 'A' });
    userId = await createUser(
      db,
      { email: 'a1@test.com', name: 'Ann', household: householdId },
      prompts(PASSWORD, PASSWORD),
    );
    const now = new Date();
    for (const token of ['t1', 't2']) {
      db.insert(session)
        .values({
          id: token,
          token,
          userId,
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  });

  it('replaces the hash and deletes every session of the user', async () => {
    await resetPassword(
      db,
      { email: 'A1@Test.com' },
      prompts('new password', 'new password'),
    );

    const acc = db
      .select()
      .from(account)
      .where(eq(account.userId, userId))
      .get();
    expect(
      await verifyPassword({ hash: acc!.password!, password: 'new password' }),
    ).toBe(true);
    expect(
      await verifyPassword({ hash: acc!.password!, password: PASSWORD }),
    ).toBe(false);
    expect(db.select().from(session).all()).toHaveLength(0);
  });

  it('leaves other users sessions alone', async () => {
    const other = await createUser(
      db,
      {
        email: 'b1@test.com',
        name: 'Bob',
        household: createHousehold(db, { name: 'B' }),
      },
      prompts(PASSWORD, PASSWORD),
    );
    const now = new Date();
    db.insert(session)
      .values({
        id: 'o',
        token: 'o',
        userId: other,
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await resetPassword(
      db,
      { email: 'a1@test.com' },
      prompts('new password', 'new password'),
    );

    expect(
      db
        .select()
        .from(session)
        .all()
        .map((s) => s.id),
    ).toEqual(['o']);
  });

  it('rejects an unknown email and changes nothing', async () => {
    await expect(
      resetPassword(
        db,
        { email: 'nobody@test.com' },
        prompts('new password', 'new password'),
      ),
    ).rejects.toThrow('User not found');
    expect(db.select().from(session).all()).toHaveLength(2);
  });

  it('keeps hash and sessions when the new passwords do not match', async () => {
    const before = db
      .select()
      .from(account)
      .where(eq(account.userId, userId))
      .get();
    await expect(
      resetPassword(
        db,
        { email: 'a1@test.com' },
        prompts('new password', 'other one'),
      ),
    ).rejects.toThrow('do not match');
    const after = db
      .select()
      .from(account)
      .where(eq(account.userId, userId))
      .get();
    expect(after?.password).toBe(before?.password);
    expect(db.select().from(session).all()).toHaveLength(2);
  });

  it('keeps sessions when the user has no credential account', async () => {
    db.delete(account).where(eq(account.userId, userId)).run();
    await expect(
      resetPassword(
        db,
        { email: 'a1@test.com' },
        prompts('new password', 'new password'),
      ),
    ).rejects.toThrow('no password credential');
    expect(db.select().from(session).all()).toHaveLength(2);
  });
});
