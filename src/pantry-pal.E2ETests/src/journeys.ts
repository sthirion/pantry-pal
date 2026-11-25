import { readFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';

interface Persona {
  name: string;
  email: string;
  password: string;
  household: 'a' | 'b' | 'c';
}

interface Seed {
  households: Record<'a' | 'b' | 'c', string>;
  personas: Record<'sam' | 'alex' | 'jo' | 'pat', Persona>;
  suggestions: string[];
}

/** The users and household names the E2E server seeds (see server/start.mjs). */
export const seed = JSON.parse(
  readFileSync(new URL('../server/personas.json', import.meta.url), 'utf8'),
) as Seed;

export const sam = seed.personas.sam;
export const alex = seed.personas.alex;
export const jo = seed.personas.jo;
/** Alone in household C, so tests that seed large lists do not slow other tests' first sync. */
export const pat = seed.personas.pat;

/** Sign-in is limited per client address, so every browser context presents its own. */
function randomClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export const test = base.extend<{ openAlexPage: () => Promise<Page> }>({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': randomClientAddress(),
    });
    await use(context);
  },
  // Alex signs in on a separate browser context (own cookies and storage) when the test asks; each is closed after the test.
  openAlexPage: async ({ browser }, use, testInfo) => {
    const pages: Page[] = [];
    await use(async () => {
      const page = await openSignedInPage(browser, alex, testInfo.project.use);
      pages.push(page);
      return page;
    });
    await Promise.all(pages.map((page) => page.context().close()));
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
  try {
    const page = await context.newPage();
    await signIn(page, persona);
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function createList(page: Page, name: string): Promise<void> {
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

/**
 * Clicks a control on the lists screen with a real pointer click. Parallel tests add lists to the same
 * household, so rows shift; Playwright waits for the control to be stable and re-checks that it, not a
 * neighbouring row, receives the click, retrying until it does.
 */
export async function clickRowControl(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.click();
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

export const crossOffButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Cross off ${name}`, exact: true });

export const restoreButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Restore ${name}`, exact: true });

export const itemActionsButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Actions for ${name}`, exact: true });

export async function crossOff(page: Page, name: string): Promise<void> {
  await crossOffButton(page, name).click();
  await expect(restoreButton(page, name)).toBeVisible();
}

export async function renameItem(
  page: Page,
  name: string,
  renamed: string,
): Promise<void> {
  await itemActionsButton(page, name).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel(`New name for ${name}`, { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(crossOffButton(page, renamed)).toBeVisible();
}

export async function deleteItem(page: Page, name: string): Promise<void> {
  await itemActionsButton(page, name).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(itemActionsButton(page, name)).toHaveCount(0);
}

export async function clearCrossedOff(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Clear crossed off', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Confirm clearing crossed-off items' })
    .getByRole('button', { name: 'Clear crossed off', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: 'Confirm clearing crossed-off items' }),
  ).toHaveCount(0);
}

/** Creates items through the real API (as the page's signed-in user) in the list the page has open. */
export async function seedItems(
  page: Page,
  items: ReadonlyArray<{ name: string; crossedOff?: boolean }>,
): Promise<void> {
  const { origin, pathname } = new URL(page.url());
  const listId = pathname.split('/').pop() ?? '';
  const batchSize = 25;
  for (let from = 0; from < items.length; from += batchSize) {
    await Promise.all(
      items.slice(from, from + batchSize).map(async (item) => {
        const response = await page.request.put(
          `/api/lists/${listId}/items/${randomUUID()}`,
          {
            headers: { origin },
            data: {
              name: item.name,
              crossedOff: item.crossedOff ?? false,
              changedAt: new Date().toISOString(),
            },
          },
        );
        expect(response.status()).toBe(201);
      }),
    );
  }
}

/** The live items the server holds for the list the page has open, read as the page's signed-in user. */
export async function serverItems(
  page: Page,
): Promise<Array<{ name: string; crossedOff: boolean }>> {
  const listId = new URL(page.url()).pathname.split('/').pop() ?? '';
  const response = await page.request.get('/api/sync?since=0');
  const body = (await response.json()) as {
    items: Array<{
      listId: string;
      name: string;
      crossedOffAt: string | null;
      deletedAt: string | null;
    }>;
  };
  return body.items
    .filter((item) => item.listId === listId && item.deletedAt === null)
    .map((item) => ({
      name: item.name,
      crossedOff: item.crossedOffAt !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reloads the page once the service worker controls it, then waits until the worker has cached the
 * app shell and every script and style the page loaded, so a later offline reload can start.
 */
export async function waitForOfflineShell(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        if (!navigator.serviceWorker.controller) return false;
        const assets = performance
          .getEntriesByType('resource')
          .filter((entry) =>
            ['script', 'link', 'css'].includes(
              (entry as PerformanceResourceTiming).initiatorType,
            ),
          )
          .map((entry) => new URL(entry.name))
          .filter((url) => url.origin === location.origin);
        const cached = await Promise.all(
          ['/', ...assets.map((url) => url.pathname)].map((path) =>
            caches.match(path),
          ),
        );
        return cached.every((response) => response !== undefined);
      }),
    )
    .toBe(true);
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
