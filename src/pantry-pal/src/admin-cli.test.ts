import { beforeEach, describe, expect, it } from 'vitest';
import { runCli, type CliIo } from './admin-cli.js';
import { createHousehold } from './admin-commands.js';
import {
  createDatabase,
  openSqlite,
  runMigrations,
  type AppDatabase,
} from './db/database.js';
import { account, household, user } from './db/schema.js';

let db: AppDatabase;
let out: string[];
let err: string[];
let prompted: number;

function io(overrides: Partial<CliIo> = {}): CliIo {
  return {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    prompt: () => {
      prompted += 1;
      return Promise.resolve('long enough pw');
    },
    isInteractive: true,
    ...overrides,
  };
}

beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
  out = [];
  err = [];
  prompted = 0;
});

describe('runCli', () => {
  it('household:create prints the new id and exits 0', async () => {
    const code = await runCli(['household:create', '--name', 'A'], db, io());
    expect(code).toBe(0);
    const [row] = db.select().from(household).all();
    expect(out).toEqual([row!.id]);
  });

  it('household:create without a name fails on stderr', async () => {
    expect(await runCli(['household:create'], db, io())).toBe(1);
    expect(err[0]).toContain('required');
    expect(out).toEqual([]);
  });

  it('user:create prints the user id and exits 0', async () => {
    await runCli(['household:create', '--name', 'A'], db, io());
    const householdId = out[0]!;
    out = [];
    const code = await runCli(
      [
        'user:create',
        '--email',
        'a@test.com',
        '--name',
        'Ann',
        '--household',
        householdId,
      ],
      db,
      io(),
    );
    expect(code).toBe(0);
    expect(out).toEqual([db.select().from(user).get()!.id]);
    expect(prompted).toBe(2);
  });

  it('user:reset-password succeeds for an existing user', async () => {
    await runCli(['household:create', '--name', 'A'], db, io());
    const householdId = out[0]!;
    await runCli(
      [
        'user:create',
        '--email',
        'a@test.com',
        '--name',
        'Ann',
        '--household',
        householdId,
      ],
      db,
      io(),
    );
    const before = db.select().from(account).get()!.password;
    const code = await runCli(
      ['user:reset-password', '--email', 'a@test.com'],
      db,
      io({ prompt: () => Promise.resolve('another password') }),
    );
    expect(code).toBe(0);
    expect(db.select().from(account).get()!.password).not.toBe(before);
  });

  it.each([['--password'], ['--password=secret'], ['--pw', 'secret']])(
    'rejects the unknown option %s with usage and exit 1',
    async (...extra) => {
      const code = await runCli(
        [
          'user:create',
          '--email',
          'a@test.com',
          '--name',
          'A',
          '--household',
          'h',
          ...extra,
        ],
        db,
        io(),
      );
      expect(code).toBe(1);
      expect(err[0]).toContain('Usage:');
      expect(prompted).toBe(0);
    },
  );

  it('rejects an unknown command with usage', async () => {
    expect(await runCli(['nope'], db, io())).toBe(1);
    expect(err[0]).toContain('Usage:');
  });

  it('rejects a missing command with usage', async () => {
    expect(await runCli([], db, io())).toBe(1);
    expect(err[0]).toContain('Usage:');
  });

  it.each([
    ['user:create', '--email', 'a@test.com', '--name', 'A', '--household', 'h'],
    ['user:reset-password', '--email', 'a@test.com'],
  ])(
    '%s refuses to read a password when stdin is not a TTY',
    async (...argv) => {
      const code = await runCli(argv, db, io({ isInteractive: false }));
      expect(code).toBe(1);
      expect(err[0]).toContain('terminal');
      expect(prompted).toBe(0);
    },
  );

  it('rethrows unexpected errors', async () => {
    const householdId = createHousehold(db, { name: 'A' });
    await expect(
      runCli(
        [
          'user:create',
          '--email',
          'a@test.com',
          '--name',
          'A',
          '--household',
          householdId,
        ],
        db,
        io({
          prompt: () => Promise.reject(new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
  });
});
