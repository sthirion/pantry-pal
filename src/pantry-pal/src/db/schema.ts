import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Better Auth core `user` table. Timestamps use `timestamp_ms` because Better Auth writes `Date`s. */
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('user_email_unique').on(t.email)],
);

/** Better Auth `session` table. */
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('session_token_unique').on(t.token),
    index('session_user_id_idx').on(t.userId),
  ],
);

/** Better Auth `account` table (holds the credential password hash). */
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

/** Better Auth `verification` table (unused by the enabled endpoints, required by the adapter). */
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const household = sqliteTable('household', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const householdMember = sqliteTable(
  'household_member',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => household.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    uniqueIndex('household_member_user_id_unique').on(t.userId),
  ],
);

export const shoppingList = sqliteTable(
  'shopping_list',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    version: integer('version').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('shopping_list_household_name_key_live_unique')
      .on(t.householdId, t.nameKey)
      .where(sql`${t.deletedAt} IS NULL`),
    index('shopping_list_household_version_idx').on(t.householdId, t.version),
  ],
);

export const listItem = sqliteTable(
  'list_item',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingList.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    crossedOffAt: integer('crossed_off_at'),
    version: integer('version').notNull(),
    /** Per-item merge revision, separate from the household-wide `version` sync cursor. */
    itemRevision: integer('item_revision').notNull().default(1),
    /** Greatest `itemRevision` whose journal entry was pruned; 0 while the history is complete. */
    prunedThroughItemRevision: integer('pruned_through_item_revision')
      .notNull()
      .default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('list_item_list_name_key_live_unique')
      .on(t.listId, t.nameKey)
      .where(sql`${t.deletedAt} IS NULL`),
    index('list_item_household_version_idx').on(t.householdId, t.version),
  ],
);

/** One row per accepted item change: the fields it changed, ordered by `itemRevision`. */
export const itemChange = sqliteTable(
  'item_change',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => listItem.id, { onDelete: 'cascade' }),
    householdId: text('household_id').notNull(),
    itemRevision: integer('item_revision').notNull(),
    mutationId: text('mutation_id').notNull(),
    /** JSON array of the changed field names. */
    fields: text('fields').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.itemRevision] }),
    index('item_change_created_at_idx').on(t.createdAt),
  ],
);

/** Idempotency receipt of an accepted item mutation; lives as long as its item. */
export const itemMutationReceipt = sqliteTable(
  'item_mutation_receipt',
  {
    householdId: text('household_id').notNull(),
    mutationId: text('mutation_id').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => listItem.id, { onDelete: 'cascade' }),
    baseItemRevision: integer('base_item_revision').notNull(),
    /** Canonical JSON of the normalized patch. */
    changes: text('changes').notNull(),
    /** JSON array of the fields the mutation applied. */
    appliedFields: text('applied_fields').notNull(),
    /** JSON array of `{ field, attemptedValue, serverValue }`. */
    conflicts: text('conflicts').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.mutationId] }),
    index('item_mutation_receipt_item_id_idx').on(t.itemId),
  ],
);

export const itemSuggestion = sqliteTable(
  'item_suggestion',
  {
    householdId: text('household_id').notNull(),
    nameKey: text('name_key').notNull(),
    name: text('name').notNull(),
    useCount: integer('use_count').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.nameKey] }),
    index('item_suggestion_household_last_used_idx').on(
      t.householdId,
      sql`${t.lastUsedAt} desc`,
    ),
  ],
);

export const syncState = sqliteTable('sync_state', {
  householdId: text('household_id').primaryKey(),
  purgedThroughVersion: integer('purged_through_version').notNull(),
});

/** Single-row (id 1) record of the last daily tombstone purge, in epoch milliseconds. */
export const maintenanceState = sqliteTable('maintenance_state', {
  id: integer('id').primaryKey(),
  lastRunAt: integer('last_run_at').notNull(),
});

export const changeCounter = sqliteTable('change_counter', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull(),
});
