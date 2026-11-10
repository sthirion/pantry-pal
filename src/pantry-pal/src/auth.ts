import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Config } from './config.js';
import type { AppDatabase } from './db/database.js';
import * as schema from './db/schema.js';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;
const SIGN_IN_PATH = '/sign-in/email';
const SIGN_IN_WINDOW_SECONDS = 60;
const SIGN_IN_MAX_REQUESTS = 5;

/** Better Auth routes (relative to `/api/auth`) that the API exposes; everything else is a 404. */
export const ALLOWED_AUTH_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
}> = [
  { method: 'POST', path: SIGN_IN_PATH },
  { method: 'POST', path: '/sign-out' },
  { method: 'GET', path: '/get-session' },
];

export function createAuth(config: Config, db: AppDatabase) {
  return betterAuth({
    baseURL: config.authUrl,
    secret: config.authSecret,
    trustedOrigins: [config.publicOrigin],
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      customRules: {
        [SIGN_IN_PATH]: {
          window: SIGN_IN_WINDOW_SECONDS,
          max: SIGN_IN_MAX_REQUESTS,
        },
      },
    },
    advanced: {
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // Nginx must overwrite (not append to) this header with the real client address.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      database: { generateId: 'uuid' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
