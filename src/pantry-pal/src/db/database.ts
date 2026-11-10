import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { apiRoot } from '../config.js';
import * as schema from './schema.js';

export type AppDatabase = ReturnType<typeof createDatabase>;

export const migrationsFolder = path.join(apiRoot, 'drizzle');

/** Opens the SQLite file (creating its parent directory) with the required pragmas. */
export function openSqlite(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return sqlite;
}

export function createDatabase(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

/** Applies pending drizzle-kit migrations; already-applied ones are skipped. */
export function runMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder });
}
