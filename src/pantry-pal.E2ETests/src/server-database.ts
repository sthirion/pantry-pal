import { DatabaseSync } from 'node:sqlite';

/**
 * Applies what the server's hourly pruning task does to an item once its journal entries are 25 hours
 * old: deletes them and raises the item's pruning watermark to its current revision. Pruning only
 * runs on a schedule and there is no endpoint for it, so the spec writes to the E2E server's database
 * (the file `playwright.config.ts` hands to `server/start.mjs`) directly.
 */
export function expireItemHistory(itemId: string): void {
  const dbPath = process.env.E2E_DB_PATH;
  if (!dbPath) {
    throw new Error('E2E_DB_PATH is not set; run the specs with Playwright.');
  }
  const database = new DatabaseSync(dbPath);
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('BEGIN IMMEDIATE');
    const raised = database
      .prepare(
        'UPDATE list_item SET pruned_through_item_revision = max(pruned_through_item_revision, item_revision) WHERE id = ?',
      )
      .run(itemId);
    if (raised.changes !== 1) {
      throw new Error(`Item ${itemId} is not in the E2E database.`);
    }
    database.prepare('DELETE FROM item_change WHERE item_id = ?').run(itemId);
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}
