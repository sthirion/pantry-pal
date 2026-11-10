import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, openSqlite, runMigrations } from './database.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-db-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
  it('creates the missing parent directory and applies the pragmas', () => {
    const file = path.join(dir, 'nested', 'pantry.db');
    const sqlite = openSqlite(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1);
    sqlite.close();
  });

  it('fails when the path cannot be created', () => {
    const file = path.join(dir, 'file');
    fs.writeFileSync(file, 'x');
    expect(() => openSqlite(path.join(file, 'pantry.db'))).toThrow();
  });

  it('migrates a fresh database and keeps data on a second run', () => {
    const sqlite = openSqlite(path.join(dir, 'pantry.db'));
    const db = createDatabase(sqlite);
    runMigrations(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'user',
        'household',
        'household_member',
        'shopping_list',
        'list_item',
        'item_suggestion',
        'sync_state',
        'change_counter',
      ]),
    );
    expect(
      sqlite.prepare('SELECT id, value FROM change_counter').all(),
    ).toEqual([{ id: 1, value: 0 }]);

    sqlite.prepare("INSERT INTO household VALUES ('h1', 'Home', 1)").run();
    runMigrations(db);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household').get()).toEqual(
      {
        n: 1,
      },
    );
    expect(sqlite.prepare('SELECT value FROM change_counter').get()).toEqual({
      value: 0,
    });
    sqlite.close();
  });

  it('enforces foreign keys and the partial unique index', () => {
    const sqlite = openSqlite(path.join(dir, 'pantry.db'));
    runMigrations(createDatabase(sqlite));
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO list_item VALUES ('i','h','nope','n','n',NULL,1,1,1,NULL)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);

    const insertList = sqlite.prepare(
      "INSERT INTO shopping_list VALUES (?, 'h', 'A', 'a', 1, 1, 1, ?)",
    );
    insertList.run('l1', null);
    expect(() => insertList.run('l2', null)).toThrow(/UNIQUE/);
    sqlite
      .prepare("UPDATE shopping_list SET deleted_at = 5 WHERE id = 'l1'")
      .run();
    expect(() => insertList.run('l2', null)).not.toThrow();
    sqlite.close();
  });
});
