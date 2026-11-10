import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth.js';
import type { AppDatabase } from './db/database.js';
import {
  account,
  household,
  householdMember,
  session,
  user,
} from './db/schema.js';

/** Reads a password without echoing it. Injected so tests need no TTY. */
export type PasswordPrompt = (label: string) => Promise<string>;

/** A user-facing failure: the CLI prints the message to stderr and exits non-zero. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

const emailSchema = z.email();

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) {
    throw new CliError(`Invalid email "${raw}".`);
  }
  return email;
}

function requireText(value: string | undefined, label: string): string {
  const text = value?.trim();
  if (!text) throw new CliError(`${label} is required.`);
  return text;
}

/** Prompts twice and enforces the length policy and that both entries match. */
export async function readNewPassword(prompt: PasswordPrompt): Promise<string> {
  const password = await prompt('Password: ');
  const confirmation = await prompt('Confirm password: ');
  if (password !== confirmation) throw new CliError('Passwords do not match.');
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new CliError(
      `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return password;
}

export function createHousehold(
  db: AppDatabase,
  options: { name?: string },
): string {
  const name = requireText(options.name, 'Household name');
  const id = randomUUID();
  db.insert(household).values({ id, name, createdAt: Date.now() }).run();
  return id;
}

export async function createUser(
  db: AppDatabase,
  options: { email?: string; name?: string; household?: string },
  prompt: PasswordPrompt,
): Promise<string> {
  const email = normalizeEmail(requireText(options.email, 'Email'));
  const name = requireText(options.name, 'Name');
  const householdId = requireText(options.household, 'Household');
  const found = db
    .select({ id: household.id })
    .from(household)
    .where(eq(household.id, householdId))
    .get();
  if (!found) throw new CliError('Household not found.');
  const existing = db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (existing) throw new CliError('A user with that email already exists.');

  const passwordHash = await hashPassword(await readNewPassword(prompt));
  const id = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(user)
      .values({ id, name, email, createdAt: now, updatedAt: now })
      .run();
    tx.insert(account)
      .values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(householdMember)
      .values({
        householdId,
        userId: id,
        role: 'member',
        createdAt: now.getTime(),
      })
      .run();
  });
  return id;
}

export async function resetPassword(
  db: AppDatabase,
  options: { email?: string },
  prompt: PasswordPrompt,
): Promise<void> {
  const email = normalizeEmail(requireText(options.email, 'Email'));
  const found = db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  if (!found) throw new CliError('User not found.');

  const passwordHash = await hashPassword(await readNewPassword(prompt));
  db.transaction((tx) => {
    const updated = tx
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(
        and(eq(account.userId, found.id), eq(account.providerId, 'credential')),
      )
      .run();
    if (updated.changes === 0) {
      throw new CliError('User has no password credential.');
    }
    tx.delete(session).where(eq(session.userId, found.id)).run();
  });
}
