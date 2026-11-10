import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Better Auth core `user` table; Better Auth wiring and its other tables arrive in story 5. */
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('user_email_unique').on(t.email)],
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

export const changeCounter = sqliteTable('change_counter', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull(),
});
