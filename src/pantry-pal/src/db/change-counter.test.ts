import { beforeEach, describe, expect, it } from 'vitest';
import { nextVersion } from './change-counter.js';
import { createDatabase, openSqlite, runMigrations } from './database.js';
import type { AppDatabase } from './database.js';

let db: AppDatabase;
beforeEach(() => {
  db = createDatabase(openSqlite(':memory:'));
  runMigrations(db);
});

describe('nextVersion', () => {
  it('returns strictly increasing versions and persists the counter', () => {
    const versions = db.transaction((tx) => [
      nextVersion(tx),
      nextVersion(tx),
      nextVersion(tx),
    ]);

    expect(versions).toEqual([1, 2, 3]);
    expect(
      db.$client.prepare('SELECT value FROM change_counter').get(),
    ).toEqual({ value: 3 });
  });

  it('does not advance the counter when the transaction rolls back', () => {
    expect(() =>
      db.transaction((tx) => {
        nextVersion(tx);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');

    expect(
      db.$client.prepare('SELECT value FROM change_counter').get(),
    ).toEqual({ value: 0 });
  });

  it('fails when the counter row is missing', () => {
    db.$client.exec('DELETE FROM change_counter');
    expect(() => db.transaction((tx) => nextVersion(tx))).toThrow(
      'change_counter is not seeded.',
    );
  });
});
