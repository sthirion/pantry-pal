import { readFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { Browser, Locator, Page, TestInfo } from '@playwright/test';

interface Persona {
  name: string;
  email: string;
  password: string;
  household: 'a' | 'b' | 'c';
}

export type Credentials = Omit<Persona, 'household'>;

interface PairMember {
  name: string;
  emailPrefix: string;
  password: string;
}

interface Seed {
  households: Record<'a' | 'b' | 'c', string>;
  personas: Record<'sam' | 'alex' | 'jo' | 'pat', Persona>;
  syncPair: { household: string; sam: PairMember; alex: PairMember };
  emptyState: {
    household: string;
    name: string;
    emailPrefix: string;
    password: string;
  };
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
/**
 * Sam and Alex of a household that only the current worker uses (the server seeds one per worker,
 * see server/start.mjs). Tests in one worker run one at a time, so no concurrent test adds
 * lists that shift the rows under a click, and the 2-second sync budget is not shared with other tests' traffic.
 */
export function syncPair(testInfo: TestInfo): {
  sam: Credentials;
  alex: Credentials;
} {
  const index = testInfo.parallelIndex;
  if (index >= testInfo.config.workers) {
    throw new Error(`Worker ${index} has no seeded sync household.`);
  }
  const member = ({
    name,
    emailPrefix,
    password,
  }: PairMember): Credentials => ({
    name,
    email: `${emailPrefix}-${index}@example.com`,
    password,
  });
  return { sam: member(seed.syncPair.sam), alex: member(seed.syncPair.alex) };
}

/**
 * The only member of a household that only the current worker uses and no test ever writes to (the
 * server seeds one per worker, see server/start.mjs), so its lists screen stays empty across tests and repeats.
 */
export function emptyStatePersona(testInfo: TestInfo): Credentials {
  const index = testInfo.parallelIndex;
  if (index >= testInfo.config.workers) {
    throw new Error(`Worker ${index} has no seeded empty-state household.`);
  }
  const { name, emailPrefix, password } = seed.emptyState;
  return { name, email: `${emailPrefix}-${index}@example.com`, password };
}

/** Sign-in is limited per client address, so every browser context presents its own. */
function randomClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export const test = base.extend<{
  openPersonaPage: (persona: Credentials) => Promise<Page>;
  openAlexPage: () => Promise<Page>;
}>({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': randomClientAddress(),
    });
    await use(context);
  },
  // A persona signs in on a separate browser context (own cookies and storage) when the test asks; each is closed after the test.
  openPersonaPage: async ({ browser }, use, testInfo) => {
    const pages: Page[] = [];
    await use(async (persona) => {
      const page = await openSignedInPage(
        browser,
        persona,
        testInfo.project.use,
      );
      pages.push(page);
      return page;
    });
    await Promise.all(pages.map((page) => page.context().close()));
  },
  openAlexPage: async ({ openPersonaPage }, use) => {
    await use(() => openPersonaPage(alex));
  },
});

export { expect };

/** A name that no other test (or run) uses, so parallel tests never collide on the shared database. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${randomInt(36 ** 3).toString(36)}`;
}

export async function signIn(page: Page, persona: Credentials): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(persona.email);
  await page.getByLabel('Password').fill(persona.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
}

/** Opens a second, separate browser (own cookies and storage) signed in as `persona`. */
export async function openSignedInPage(
  browser: Browser,
  persona: Credentials,
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

export interface ServerItemRecord {
  id: string;
  name: string;
  crossedOff: boolean;
  /** Per-item merge revision. */
  itemRevision: number;
  /** Household sync cursor value of the item's last write. */
  version: number;
}

/** The live items the server holds for the list the page has open, with their revisions, read as the page's signed-in user. */
export async function serverItemRecords(
  page: Page,
): Promise<ServerItemRecord[]> {
  const listId = new URL(page.url()).pathname.split('/').pop() ?? '';
  const response = await page.request.get('/api/sync?since=0');
  const body = (await response.json()) as {
    items: Array<{
      id: string;
      listId: string;
      name: string;
      crossedOffAt: string | null;
      deletedAt: string | null;
      itemRevision: number;
      version: number;
    }>;
  };
  return body.items
    .filter((item) => item.listId === listId && item.deletedAt === null)
    .map((item) => ({
      id: item.id,
      name: item.name,
      crossedOff: item.crossedOffAt !== null,
      itemRevision: item.itemRevision,
      version: item.version,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The live items the server holds for the list the page has open, read as the page's signed-in user. */
export async function serverItems(
  page: Page,
): Promise<Array<{ name: string; crossedOff: boolean }>> {
  const records = await serverItemRecords(page);
  return records.map(({ name, crossedOff }) => ({ name, crossedOff }));
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

const MAX_TABS = 150;

/** The app draws a solid outline on `:focus-visible`; a focused control without one is invisible. */
export async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const outline = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).toBe('solid');
  expect(outline.width).toBeGreaterThan(0);
}

/** Presses Tab until `target` has focus, then checks that the focus is visible. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  for (let presses = 0; presses < MAX_TABS; presses++) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate(
      (el) => el === document.activeElement,
    );
    if (focused) {
      await expectVisibleFocus(target);
      return;
    }
  }
  throw new Error(`Tab did not reach the control within ${MAX_TABS} presses`);
}

export const OFFLINE_NOTICE =
  'You are offline. Changes are saved on this device.';

export const waitingToSync = (page: Page): Locator =>
  page.getByText(/waiting to sync/);

/** The second member signs in after the list is prepared and opens it, so they start from the same items as the first. */
export async function joinList(
  openMemberPage: () => Promise<Page>,
  listName: string,
  activeItems: readonly string[],
): Promise<Page> {
  const memberPage = await openMemberPage();
  await openList(memberPage, listName);
  for (const item of activeItems) {
    await expect(crossOffButton(memberPage, item)).toBeVisible();
  }
  return memberPage;
}

/** Signs in as `persona` and creates a fresh list, leaving the page on its items screen. */
export async function startWithList(
  page: Page,
  persona: Credentials,
  prefix = 'List',
): Promise<string> {
  const name = uniqueName(prefix);
  await signIn(page, persona);
  await createList(page, name);
  await openList(page, name);
  // The list is saved on the device first; API calls on its items fail with 404 until the server has it.
  const listId = new URL(page.url()).pathname.split('/').pop();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/sync?since=0');
      const body = (await response.json()) as {
        lists: Array<{ id: string; deletedAt: string | null }>;
      };
      return body.lists.some(
        (list) => list.id === listId && list.deletedAt === null,
      );
    })
    .toBe(true);
  return name;
}
