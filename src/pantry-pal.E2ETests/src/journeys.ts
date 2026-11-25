import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';

interface Persona {
  name: string;
  email: string;
  password: string;
  household: 'a' | 'b';
}

interface Seed {
  households: Record<'a' | 'b', string>;
  personas: Record<'sam' | 'alex' | 'jo', Persona>;
  suggestions: string[];
}

/** The users and household names the E2E server seeds (see server/start.mjs). */
export const seed = JSON.parse(
  readFileSync(new URL('../server/personas.json', import.meta.url), 'utf8'),
) as Seed;

export const sam = seed.personas.sam;
export const alex = seed.personas.alex;
export const jo = seed.personas.jo;

/** Sign-in is limited per client address, so every browser context presents its own. */
function randomClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': randomClientAddress(),
    });
    await use(context);
  },
});

export { expect };

/** A name that no other test (or run) uses, so parallel tests never collide on the shared database. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${randomInt(36 ** 3).toString(36)}`;
}

export async function signIn(page: Page, persona: Persona): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(persona.email);
  await page.getByLabel('Password').fill(persona.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
}

/** Opens a second, separate browser (own cookies and storage) signed in as `persona`. */
export async function openSignedInPage(
  browser: Browser,
  persona: Persona,
  options: Parameters<Browser['newContext']>[0],
): Promise<Page> {
  const context = await browser.newContext({
    ...options,
    extraHTTPHeaders: { 'x-forwarded-for': randomClientAddress() },
  });
  const page = await context.newPage();
  await signIn(page, persona);
  return page;
}

export async function createList(page: Page, name: string): Promise<void> {
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

/**
 * Clicks a control on the lists screen. Parallel tests add lists to the same household, so the rows
 * shift while a pointer click is in flight and the click can be dropped or hit a neighbouring row.
 * Dispatching the click on the located element always reaches this row's control.
 */
export async function clickRowControl(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.dispatchEvent('click');
}

export async function openList(page: Page, name: string): Promise<void> {
  await clickRowControl(page.getByRole('link', { name }));
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function addItem(page: Page, name: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Add an item' }).fill(name);
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(
    page.getByRole('button', { name: `Cross off ${name}` }),
  ).toBeVisible();
}

/** Signs in as `persona` and creates a fresh list, leaving the page on its items screen. */
export async function startWithList(
  page: Page,
  persona: Persona,
  prefix = 'List',
): Promise<string> {
  const name = uniqueName(prefix);
  await signIn(page, persona);
  await createList(page, name);
  await openList(page, name);
  return name;
}
