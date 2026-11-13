import { eq, sql } from 'drizzle-orm';
import type { AppTransaction } from './database.js';
import { changeCounter } from './schema.js';

const COUNTER_ID = 1;

/** Increments the single `change_counter` row and returns the new version; call inside a write transaction. */
export function nextVersion(tx: AppTransaction): number {
  const row = tx
    .update(changeCounter)
    .set({ value: sql`${changeCounter.value} + 1` })
    .where(eq(changeCounter.id, COUNTER_ID))
    .returning({ value: changeCounter.value })
    .get();
  if (!row) throw new Error('change_counter is not seeded.');
  return row.value;
}
