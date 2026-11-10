import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { useHarness } from './api.harness.js';

const ctx = useHarness();

type Col = [name: string, type: string, notNull: 0 | 1, pk: number];

const EXPECTED_COLUMNS: Record<string, Col[]> = {
  user: [
    ['id', 'TEXT', 1, 1],
    ['name', 'TEXT', 1, 0],
    ['email', 'TEXT', 1, 0],
    ['email_verified', 'INTEGER', 1, 0],
    ['image', 'TEXT', 0, 0],
    ['created_at', 'INTEGER', 1, 0],
    ['updated_at', 'INTEGER', 1, 0],
  ],
  household: [
    ['id', 'TEXT', 1, 1],
    ['name', 'TEXT', 1, 0],
    ['created_at', 'INTEGER', 1, 0],
  ],
  household_member: [
    ['household_id', 'TEXT', 1, 1],
    ['user_id', 'TEXT', 1, 2],
    ['role', 'TEXT', 1, 0],
    ['created_at', 'INTEGER', 1, 0],
  ],
  shopping_list: [
    ['id', 'TEXT', 1, 1],
    ['household_id', 'TEXT', 1, 0],
    ['name', 'TEXT', 1, 0],
    ['name_key', 'TEXT', 1, 0],
    ['version', 'INTEGER', 1, 0],
    ['created_at', 'INTEGER', 1, 0],
    ['updated_at', 'INTEGER', 1, 0],
    ['deleted_at', 'INTEGER', 0, 0],
  ],
  list_item: [
    ['id', 'TEXT', 1, 1],
    ['household_id', 'TEXT', 1, 0],
    ['list_id', 'TEXT', 1, 0],
    ['name', 'TEXT', 1, 0],
    ['name_key', 'TEXT', 1, 0],
    ['crossed_off_at', 'INTEGER', 0, 0],
    ['version', 'INTEGER', 1, 0],
    ['created_at', 'INTEGER', 1, 0],
    ['updated_at', 'INTEGER', 1, 0],
    ['deleted_at', 'INTEGER', 0, 0],
  ],
  item_suggestion: [
    ['household_id', 'TEXT', 1, 1],
    ['name_key', 'TEXT', 1, 2],
    ['name', 'TEXT', 1, 0],
    ['use_count', 'INTEGER', 1, 0],
    ['last_used_at', 'INTEGER', 1, 0],
  ],
  sync_state: [
    ['household_id', 'TEXT', 1, 1],
    ['purged_through_version', 'INTEGER', 1, 0],
  ],
  change_counter: [
    ['id', 'INTEGER', 1, 1],
    ['value', 'INTEGER', 1, 0],
  ],
};

interface IndexShape {
  unique: boolean;
  partial: boolean;
  columns: string[];
}

const EXPECTED_INDEXES: Record<string, Record<string, IndexShape>> = {
  user: {
    user_email_unique: { unique: true, partial: false, columns: ['email'] },
  },
  household_member: {
    household_member_user_id_unique: {
      unique: true,
      partial: false,
      columns: ['user_id'],
    },
  },
  shopping_list: {
    shopping_list_household_name_key_live_unique: {
      unique: true,
      partial: true,
      columns: ['household_id', 'name_key'],
    },
    shopping_list_household_version_idx: {
      unique: false,
      partial: false,
      columns: ['household_id', 'version'],
    },
  },
  list_item: {
    list_item_list_name_key_live_unique: {
      unique: true,
      partial: true,
      columns: ['list_id', 'name_key'],
    },
    list_item_household_version_idx: {
      unique: false,
      partial: false,
      columns: ['household_id', 'version'],
    },
  },
  item_suggestion: {
    item_suggestion_household_last_used_idx: {
      unique: false,
      partial: false,
      columns: ['household_id', 'last_used_at DESC'],
    },
  },
};

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}

function appTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function insertUser(db: Database.Database, id: string, email: string): void {
  db.prepare(
    'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)',
  ).run(id, 'Name', email);
}

function insertList(
  db: Database.Database,
  id: string,
  household: string,
  nameKey: string,
  deletedAt: number | null = null,
): void {
  db.prepare(
    'INSERT INTO shopping_list (id, household_id, name, name_key, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, 1, 1, ?)',
  ).run(id, household, nameKey, nameKey, deletedAt);
}

function insertItem(
  db: Database.Database,
  id: string,
  listId: string,
  nameKey: string,
  deletedAt: number | null = null,
): void {
  db.prepare(
    'INSERT INTO list_item (id, household_id, list_id, name, name_key, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)',
  ).run(id, 'h1', listId, nameKey, nameKey, deletedAt);
}

describe('AC-1 fresh database boot and health', () => {
  it('Boot_WithFreshDbPath_CreatesExactlyTheEightTables', () => {
    // Given a freshly booted app on an empty DB_PATH
    const db = openReadonly(ctx.h.dbPath);

    // When the table list is read
    const tables = appTables(db);
    db.close();

    // Then exactly the 8 application tables exist
    expect(tables).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
  });

  it.each(Object.keys(EXPECTED_COLUMNS))(
    'Boot_WithFreshDbPath_%s_HasExactColumnsAndPrimaryKey',
    (table) => {
      // Given a freshly booted app
      const db = openReadonly(ctx.h.dbPath);

      // When the table is inspected
      const cols = (
        db.pragma(`table_info(${table})`) as {
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }[]
      ).map((c) => [c.name, c.type, c.notnull, c.pk]);
      db.close();

      // Then names, types, nullability and primary key positions match exactly
      expect(cols).toEqual(EXPECTED_COLUMNS[table]);
    },
  );

  it('Boot_WithFreshDbPath_UserEmailVerifiedDefaultsToZero', () => {
    // Given a freshly booted app
    const db = ctx.h.sqlite;

    // When a user is inserted without email_verified
    db.prepare(
      'INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
    ).run('u1', 'Name', 'a@example.com');
    const row = db.prepare('SELECT email_verified AS v FROM user').get();

    // Then the stored value is 0
    expect(row).toEqual({ v: 0 });
  });

  it('Boot_WithFreshDbPath_CreatesExactForeignKeys', () => {
    // Given a freshly booted app
    const db = openReadonly(ctx.h.dbPath);

    // When foreign keys of every table are listed
    const fks = Object.keys(EXPECTED_COLUMNS).flatMap((table) =>
      (
        db.pragma(`foreign_key_list(${table})`) as {
          table: string;
          from: string;
          to: string;
        }[]
      ).map((f) => `${table}.${f.from}->${f.table}.${f.to}`),
    );
    db.close();

    // Then exactly the three required foreign keys exist
    expect(fks.sort()).toEqual([
      'household_member.household_id->household.id',
      'household_member.user_id->user.id',
      'list_item.list_id->shopping_list.id',
    ]);
  });

  it.each(Object.keys(EXPECTED_INDEXES))(
    'Boot_WithFreshDbPath_%s_HasExactIndexes',
    (table) => {
      // Given a freshly booted app
      const db = openReadonly(ctx.h.dbPath);

      // When the explicit (non-PK) indexes of the table are inspected
      const list = (
        db.pragma(`index_list(${table})`) as {
          name: string;
          unique: number;
          partial: number;
          origin: string;
        }[]
      ).filter((i) => i.origin === 'c');
      const actual: Record<string, IndexShape> = {};
      for (const i of list) {
        const columns = (
          db.pragma(`index_xinfo(${i.name})`) as {
            name: string | null;
            desc: number;
            key: number;
          }[]
        )
          .filter((c) => c.key === 1)
          .map((c) => `${c.name}${c.desc ? ' DESC' : ''}`);
        actual[i.name] = {
          unique: i.unique === 1,
          partial: i.partial === 1,
          columns,
        };
      }
      db.close();

      // Then uniqueness, partial-ness and ordered columns match exactly
      expect(actual).toEqual(EXPECTED_INDEXES[table]);
    },
  );

  it.each(['shopping_list', 'list_item'])(
    'Boot_WithFreshDbPath_%sPartialIndexIsLimitedToLiveRows',
    (table) => {
      // Given a freshly booted app
      const db = openReadonly(ctx.h.dbPath);

      // When the partial unique index definition is read
      const sql = (
        db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql LIKE '%WHERE%'",
          )
          .all(table) as { sql: string }[]
      ).map((r) => r.sql);
      db.close();

      // Then its predicate is deleted_at IS NULL
      expect(sql).toHaveLength(1);
      expect(sql[0]).toMatch(/where\s+[`"\w.]*deleted_at[`"]?\s+is\s+null/i);
    },
  );

  it('Boot_WithFreshDbPath_SeedsCounterAndLeavesOtherTablesEmpty', () => {
    // Given a freshly booted app
    const db = openReadonly(ctx.h.dbPath);

    // When row counts and the counter are read
    const counts = appTables(db)
      .filter((t) => t !== 'change_counter')
      .map((t) => [
        t,
        (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
      ]);
    const counter = db.prepare('SELECT id, value FROM change_counter').all();
    db.close();

    // Then change_counter has exactly {1, 0} and every other table is empty
    expect(counter).toEqual([{ id: 1, value: 0 }]);
    expect(counts.every(([, n]) => n === 0)).toBe(true);
    expect(counts).toHaveLength(7);
  });

  it('GetHealth_WithoutAuthentication_Returns200Ok', async () => {
    // Given an unauthenticated client
    // When requesting health
    const res = await ctx.get('/api/health');

    // Then 200 with the exact body {"status":"ok"} as JSON
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('Restart_OnExistingDatabase_KeepsDataAndDoesNotReseed', async () => {
    // Given data written through the first boot
    const h = ctx.h;
    h.sqlite
      .prepare('INSERT INTO household (id, name, created_at) VALUES (?, ?, ?)')
      .run('h1', 'Home', 1);
    h.sqlite.prepare('UPDATE change_counter SET value = 7 WHERE id = 1').run();
    const migrationsBefore = h.sqlite
      .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
      .get();

    // When the app is booted again on the same DB_PATH
    await ctx.restart();
    const res = await ctx.get('/api/health');

    // Then health is ok, data and counter are intact and no migration was re-applied
    expect(res.status).toBe(200);
    const db = ctx.h.sqlite;
    expect(
      db.prepare('SELECT name FROM household WHERE id = ?').get('h1'),
    ).toEqual({ name: 'Home' });
    expect(db.prepare('SELECT id, value FROM change_counter').all()).toEqual([
      { id: 1, value: 7 },
    ]);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get(),
    ).toEqual(migrationsBefore);
  });

  it('Insert_ShoppingListDuplicateLiveName_IsRejectedUnlessOneIsSoftDeleted', () => {
    // Given a live list in a household
    const db = ctx.h.sqlite;
    insertList(db, 'l1', 'h1', 'milk');

    // When a second live list has the same household and name_key
    const duplicate = () => insertList(db, 'l2', 'h1', 'milk');

    // Then SQLite rejects it; once the first is soft-deleted it succeeds
    expect(duplicate).toThrow(/UNIQUE constraint failed/);
    db.prepare('UPDATE shopping_list SET deleted_at = 5 WHERE id = ?').run(
      'l1',
    );
    expect(duplicate).not.toThrow();
    expect(() => insertList(db, 'l3', 'h2', 'milk')).not.toThrow();
  });

  it('Insert_ListItemDuplicateLiveName_IsRejectedUnlessOneIsSoftDeleted', () => {
    // Given a list with a live item
    const db = ctx.h.sqlite;
    insertList(db, 'l1', 'h1', 'groceries');
    insertItem(db, 'i1', 'l1', 'eggs');

    // When a second live item has the same list and name_key
    const duplicate = () => insertItem(db, 'i2', 'l1', 'eggs');

    // Then it is rejected; once the first is soft-deleted it succeeds
    expect(duplicate).toThrow(/UNIQUE constraint failed/);
    db.prepare('UPDATE list_item SET deleted_at = 5 WHERE id = ?').run('i1');
    expect(duplicate).not.toThrow();
  });

  it('Insert_HouseholdMemberWithUnknownUser_FailsUntilUserExists', () => {
    // Given a household and no user u1
    const db = ctx.h.sqlite;
    db.prepare(
      'INSERT INTO household (id, name, created_at) VALUES (?, ?, ?)',
    ).run('h1', 'Home', 1);
    const addMember = () =>
      db
        .prepare(
          'INSERT INTO household_member (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run('h1', 'u1', 'owner', 1);

    // When the member is inserted before and after the user exists
    expect(addMember).toThrow(/FOREIGN KEY constraint failed/);
    insertUser(db, 'u1', 'a@example.com');

    // Then the insert only succeeds once the user exists
    expect(addMember).not.toThrow();
  });

  it('Insert_UserWithDuplicateEmail_IsRejected', () => {
    // Given a user
    const db = ctx.h.sqlite;
    insertUser(db, 'u1', 'a@example.com');

    // When another user uses the same email
    const duplicate = () => insertUser(db, 'u2', 'a@example.com');

    // Then SQLite rejects it
    expect(duplicate).toThrow(/UNIQUE constraint failed/);
  });

  it('Insert_UserAlreadyInAHousehold_IsRejectedForSecondMembership', () => {
    // Given a user who is a member of household h1
    const db = ctx.h.sqlite;
    insertUser(db, 'u1', 'a@example.com');
    for (const id of ['h1', 'h2']) {
      db.prepare(
        'INSERT INTO household (id, name, created_at) VALUES (?, ?, ?)',
      ).run(id, id, 1);
    }
    const join = (household: string) =>
      db
        .prepare(
          'INSERT INTO household_member (household_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(household, 'u1', 'member', 1);
    join('h1');

    // When the same user joins a second household
    // Then the unique user_id index rejects it
    expect(() => join('h2')).toThrow(/UNIQUE constraint failed/);
  });
});

describe('AC-2 SQLite connection pragmas', () => {
  it('Boot_WithFileDatabase_AppliesRequiredPragmasOnTheAppConnection', () => {
    // Given the connection the app opened on a file database
    const db = ctx.h.sqlite;

    // When the pragmas are queried
    const pragmas = {
      journalMode: db.pragma('journal_mode', { simple: true }),
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
      busyTimeout: db.pragma('busy_timeout', { simple: true }),
      synchronous: db.pragma('synchronous', { simple: true }),
    };

    // Then they have the required values
    expect(pragmas).toEqual({
      journalMode: 'wal',
      foreignKeys: 1,
      busyTimeout: 5000,
      synchronous: 1,
    });
  });

  it('Boot_WithFileDatabase_PersistsWalJournalModeInTheFile', () => {
    // Given a booted app
    // When a separate connection reads the journal mode
    const db = openReadonly(ctx.h.dbPath);
    const mode = db.pragma('journal_mode', { simple: true });
    db.close();

    // Then the file is in WAL mode
    expect(mode).toBe('wal');
  });

  it('Insert_ListItemWithUnknownListId_FailsWithForeignKeyError', () => {
    // Given foreign_keys is on
    const db = ctx.h.sqlite;

    // When a list_item references a list that does not exist
    const insert = () => insertItem(db, 'i1', 'missing-list', 'eggs');

    // Then the insert fails with a foreign key constraint error
    expect(insert).toThrow(/FOREIGN KEY constraint failed/);
  });
});
