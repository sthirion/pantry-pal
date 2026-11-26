import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Credentials } from './journeys.js';
import {
  createList,
  crossOff,
  crossOffButton,
  expect,
  joinList,
  jo,
  OFFLINE_NOTICE,
  openList,
  openSignedInPage,
  renameItem,
  restoreButton,
  seedItems,
  serverItemRecords,
  startWithList,
  syncPair,
  tabTo,
  test,
  uniqueName,
  waitingToSync,
} from './journeys.js';
import { expireItemHistory } from './server-database.js';

interface ItemMutationReply {
  replayed: boolean;
  appliedFields: string[];
  itemRevision: number;
}

const reviewPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Changes to review' });

/** Moves focus to the control and activates it with the keyboard. */
async function pressWithKeyboard(page: Page, control: Locator): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
}

/**
 * Sam and Alex share a list with one item. Sam goes offline and renames it (and, with `crossOffToo`,
 * crosses it off); Alex renames it online. Reconnecting Sam is left to the test. They belong to a
 * household only this worker uses, so no other test adds lists under their clicks.
 */
async function offlineRenameAgainstOnlineRename(
  page: Page,
  openPersonaPage: (persona: Credentials) => Promise<Page>,
  testInfo: TestInfo,
  { prefix, crossOffToo = false }: { prefix: string; crossOffToo?: boolean },
) {
  const { sam, alex } = syncPair(testInfo);
  const listName = await startWithList(page, sam, prefix);
  const original = 'merge-original';
  const samName = 'merge-sam-name';
  const alexName = 'merge-alex-name';
  await seedItems(page, [{ name: original }]);
  const alexPage = await joinList(() => openPersonaPage(alex), listName, [
    original,
  ]);
  await expect(crossOffButton(page, original)).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();

  await renameItem(page, original, samName);
  if (crossOffToo) await crossOff(page, samName);
  await expect(
    page.getByText(
      crossOffToo ? '2 changes waiting to sync' : '1 change waiting to sync',
    ),
  ).toBeVisible();
  await renameItem(alexPage, original, alexName);
  await expect
    .poll(() => serverItemRecords(alexPage))
    .toMatchObject([{ name: alexName, crossedOff: false, itemRevision: 2 }]);

  return { listName, alexPage, samName, alexName };
}

/**
 * Sam goes offline and renames the item, then the queued edit is given a base revision the server
 * has never reached (the only way to produce `BASE_VERSION_AHEAD`; there is no test-only endpoint).
 * Reconnecting Sam is left to the test.
 */
async function offlineEditWithFutureBase(page: Page, testInfo: TestInfo) {
  await startWithList(page, syncPair(testInfo).sam, 'Future base');
  const original = 'future-original';
  const attempted = 'future-attempted';
  await seedItems(page, [{ name: original }]);
  await expect(crossOffButton(page, original)).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();

  await renameItem(page, original, attempted);
  await expect(page.getByText('1 change waiting to sync')).toBeVisible();
  await page.evaluate(
    (baseItemRevision) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pantry-pal');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('outbox', 'readwrite');
          const store = transaction.objectStore('outbox');
          const read = store.getAll();
          read.onsuccess = () => {
            for (const entry of read.result as Array<{
              mutation: { kind: string };
            }>) {
              if (entry.mutation.kind === 'updateItem') {
                store.put({
                  ...entry,
                  mutation: { ...entry.mutation, baseItemRevision },
                });
              }
            }
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    99,
  );
  return { original, attempted };
}

/**
 * Sam renames the item offline and Alex renames it online, then the server prunes the item's history
 * past Sam's base revision (what its hourly task does once entries are 25 hours old).
 * Reconnecting Sam is left to the test.
 */
async function offlineEditWithExpiredHistory(
  page: Page,
  openPersonaPage: (persona: Credentials) => Promise<Page>,
  testInfo: TestInfo,
  prefix: string,
) {
  const setup = await offlineRenameAgainstOnlineRename(
    page,
    openPersonaPage,
    testInfo,
    { prefix },
  );
  const [item] = await serverItemRecords(setup.alexPage);
  expireItemHistory(item!.id);
  return setup;
}

test.describe('Same-field conflict after an offline edit @TEST', () => {
  test("sam's offline rename loses to alex's online rename, stays recoverable after a reload, and his cross-off is kept", async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { listName, alexPage, samName, alexName } =
      await offlineRenameAgainstOnlineRename(page, openPersonaPage, testInfo, {
        prefix: 'Same field',
        crossOffToo: true,
      });

    // When
    await page.context().setOffline(false);

    // Then
    const review = reviewPanel(page);
    await expect(review).toBeVisible();
    await expect(
      review.getByText(
        `Someone else changed "${alexName}" while you were offline. The current value was kept.`,
      ),
    ).toBeVisible();
    await expect(review.getByText(`Current value: ${alexName}`)).toBeVisible();
    await expect(review.getByText(`Your value: ${samName}`)).toBeVisible();
    // Only the name conflicts: the cross-off queued after it was applied on top of Alex's rename.
    await expect(review.getByText(/Your value: (Yes|No)/)).toHaveCount(0);
    await expect(restoreButton(page, alexName)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    await expect
      .poll(() => serverItemRecords(alexPage))
      .toMatchObject([{ name: alexName, crossedOff: true, itemRevision: 3 }]);

    // The attempted name is neither retried nor lost when the page is reloaded.
    await page.reload();
    await expect(page.getByRole('heading', { name: listName })).toBeVisible();
    await expect(review.getByText(`Current value: ${alexName}`)).toBeVisible();
    await expect(review.getByText(`Your value: ${samName}`)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(alexPage)).toMatchObject([
      { name: alexName, crossedOff: true, itemRevision: 3 },
    ]);

    // Using the attempted value sends it as a new mutation on the current revision.
    await pressWithKeyboard(
      page,
      review.getByRole('button', {
        name: `Use my value for ${alexName}`,
        exact: true,
      }),
    );
    await expect(review).toHaveCount(0);
    await expect
      .poll(() => serverItemRecords(alexPage))
      .toMatchObject([{ name: samName, crossedOff: true, itemRevision: 4 }]);
    await expect(restoreButton(page, samName)).toBeVisible();
    await alexPage.reload();
    await expect(restoreButton(alexPage, samName)).toBeVisible();
  });

  test("sam can keep alex's value and the attempted name is dropped for good", async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { listName, alexPage, alexName } =
      await offlineRenameAgainstOnlineRename(page, openPersonaPage, testInfo, {
        prefix: 'Keep current',
      });
    await page.context().setOffline(false);
    const review = reviewPanel(page);
    await expect(review).toBeVisible();

    // When
    await pressWithKeyboard(
      page,
      review.getByRole('button', {
        name: `Keep current value of ${alexName}`,
        exact: true,
      }),
    );

    // Then
    await expect(review).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: listName })).toBeVisible();
    await expect(crossOffButton(page, alexName)).toBeVisible();
    await expect(review).toHaveCount(0);
    expect(await serverItemRecords(alexPage)).toMatchObject([
      { name: alexName, crossedOff: false, itemRevision: 2 },
    ]);
  });

  test('the conflict review has no axe violations', async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    await offlineRenameAgainstOnlineRename(page, openPersonaPage, testInfo, {
      prefix: 'Axe conflict',
    });

    // When
    await page.context().setOffline(false);
    await expect(reviewPanel(page)).toBeVisible();

    // Then
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Edit based on a revision the server does not have @TEST', () => {
  test('the edit is not applied, stays blocked across a reload, and can be applied again from the keyboard', async ({
    page,
  }, testInfo) => {
    // Given
    const { original, attempted } = await offlineEditWithFutureBase(
      page,
      testInfo,
    );

    // When
    await page.context().setOffline(false);

    // Then
    const review = reviewPanel(page);
    await expect(
      review.getByText(
        `Your change to "${original}" was based on a version the server does not have. Nothing was applied.`,
      ),
    ).toBeVisible();
    await expect(review.getByText(`Your value: ${attempted}`)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(page)).toMatchObject([
      { name: original, crossedOff: false, itemRevision: 1 },
    ]);

    // The pending patch is kept, not retried and not dropped, when the page is reloaded.
    await page.reload();
    await expect(review.getByText(`Your value: ${attempted}`)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(page)).toMatchObject([
      { name: original, crossedOff: false, itemRevision: 1 },
    ]);

    // Applying it again sends the complete patch as a new mutation on the revision the server reported.
    await pressWithKeyboard(
      page,
      review.getByRole('button', {
        name: `Apply my change again for ${original}`,
        exact: true,
      }),
    );
    await expect(review).toHaveCount(0);
    await expect
      .poll(() => serverItemRecords(page))
      .toMatchObject([{ name: attempted, crossedOff: false, itemRevision: 2 }]);
    await expect(crossOffButton(page, attempted)).toBeVisible();
  });

  test('sam can discard the blocked edit and the server value stays', async ({
    page,
  }, testInfo) => {
    // Given
    const { original, attempted } = await offlineEditWithFutureBase(
      page,
      testInfo,
    );
    await page.context().setOffline(false);
    const review = reviewPanel(page);
    await expect(review.getByText(`Your value: ${attempted}`)).toBeVisible();

    // When
    await pressWithKeyboard(
      page,
      review.getByRole('button', {
        name: `Discard my change to ${original}`,
        exact: true,
      }),
    );

    // Then
    await expect(review).toHaveCount(0);
    await expect(crossOffButton(page, original)).toBeVisible();
    await page.reload();
    await expect(crossOffButton(page, original)).toBeVisible();
    await expect(review).toHaveCount(0);
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(page)).toMatchObject([
      { name: original, crossedOff: false, itemRevision: 1 },
    ]);
  });
});

test.describe('Edit based on history the server has pruned @TEST', () => {
  test('the edit is not applied, stays blocked across a reload, and can be applied again from the keyboard', async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { listName, alexPage, samName, alexName } =
      await offlineEditWithExpiredHistory(
        page,
        openPersonaPage,
        testInfo,
        'Expired history',
      );

    // When
    await page.context().setOffline(false);

    // Then
    const review = reviewPanel(page);
    await expect(
      review.getByText(
        `Your change to "${alexName}" is too old to merge automatically. Nothing was applied.`,
      ),
    ).toBeVisible();
    await expect(review.getByText(`Your value: ${samName}`)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(alexPage)).toMatchObject([
      { name: alexName, crossedOff: false, itemRevision: 2 },
    ]);

    // The pending patch is kept, not retried and not dropped, when the page is reloaded.
    await page.reload();
    await expect(page.getByRole('heading', { name: listName })).toBeVisible();
    await expect(review.getByText(`Your value: ${samName}`)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(alexPage)).toMatchObject([
      { name: alexName, crossedOff: false, itemRevision: 2 },
    ]);

    // Applying it again sends the complete patch as a new mutation on the revision the server reported.
    const apply = review.getByRole('button', {
      name: `Apply my change again for ${alexName}`,
      exact: true,
    });
    await tabTo(page, apply);
    await page.keyboard.press('Enter');
    await expect(review).toHaveCount(0);
    await expect
      .poll(() => serverItemRecords(alexPage))
      .toMatchObject([{ name: samName, crossedOff: false, itemRevision: 3 }]);
    await expect(crossOffButton(page, samName)).toBeVisible();
    await alexPage.reload();
    await expect(crossOffButton(alexPage, samName)).toBeVisible();
  });

  test('sam can discard the blocked edit from the keyboard and the server value stays', async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { listName, alexPage, alexName } =
      await offlineEditWithExpiredHistory(
        page,
        openPersonaPage,
        testInfo,
        'Expired discard',
      );
    await page.context().setOffline(false);
    const review = reviewPanel(page);
    await expect(review).toBeVisible();

    // When
    await tabTo(
      page,
      review.getByRole('button', {
        name: `Discard my change to ${alexName}`,
        exact: true,
      }),
    );
    await page.keyboard.press('Enter');

    // Then
    await expect(review).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: listName })).toBeVisible();
    await expect(crossOffButton(page, alexName)).toBeVisible();
    await expect(review).toHaveCount(0);
    await expect(waitingToSync(page)).toHaveCount(0);
    expect(await serverItemRecords(alexPage)).toMatchObject([
      { name: alexName, crossedOff: false, itemRevision: 2 },
    ]);
  });

  test('the blocked edit review has no axe violations', async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    await offlineEditWithExpiredHistory(
      page,
      openPersonaPage,
      testInfo,
      'Axe expired',
    );

    // When
    await page.context().setOffline(false);
    await expect(reviewPanel(page)).toBeVisible();

    // Then
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Retry after a lost response @TEST', () => {
  // Request interception does not see requests of a page a service worker controls in every browser.
  test.use({ serviceWorkers: 'block' });

  test("sam's cross-off whose reply is lost is retried with the same mutation and applied once", async ({
    page,
  }, testInfo) => {
    // Given
    await startWithList(page, syncPair(testInfo).sam, 'Lost reply');
    const target = 'retry-target';
    await seedItems(page, [{ name: target }]);
    await expect(crossOffButton(page, target)).toBeVisible();
    const attempts: Array<{ body: string; reply?: ItemMutationReply }> = [];
    await page.route('**/api/lists/*/items/*', async (route) => {
      const request = route.request();
      const body = request.postData() ?? '';
      if (request.method() !== 'PUT' || !body.includes('mutationId')) {
        return route.continue();
      }
      const attempt: (typeof attempts)[number] = { body };
      attempts.push(attempt);
      // The server handles the first attempt, but its reply never reaches the page.
      const response = await route.fetch();
      if (attempts.length === 1) return route.abort('failed');
      attempt.reply = (await response.json()) as ItemMutationReply;
      return route.fulfill({ response });
    });

    // When
    await crossOffButton(page, target).click();

    // Then
    await expect
      .poll(() => attempts[1]?.reply?.replayed, { timeout: 15_000 })
      .toBe(true);
    expect(attempts).toHaveLength(2);
    expect(JSON.parse(attempts[0]!.body)).toMatchObject({
      changes: { crossedOff: true },
    });
    expect(attempts[1]!.body).toBe(attempts[0]!.body);
    expect(attempts[1]!.reply).toMatchObject({
      replayed: true,
      appliedFields: ['crossedOff'],
      itemRevision: 2,
    });
    await expect(restoreButton(page, target)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);
    await expect(reviewPanel(page)).toHaveCount(0);
    expect(await serverItemRecords(page)).toMatchObject([
      { name: target, crossedOff: true, itemRevision: 2 },
    ]);
  });
});

test.describe('Household isolation of item mutations @TEST', () => {
  const mutation = () => ({
    mutationId: randomUUID(),
    baseItemRevision: 1,
    changes: { crossedOff: true },
  });
  const sameOrigin = (page: Page) => ({ origin: new URL(page.url()).origin });
  const listIdOf = (page: Page) =>
    new URL(page.url()).pathname.split('/').pop() ?? '';

  test("household B cannot change an item of household A through A's list", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    await startWithList(page, syncPair(testInfo).sam, 'Isolated item');
    await seedItems(page, [{ name: 'secret sauce' }]);
    await expect(crossOffButton(page, 'secret sauce')).toBeVisible();
    const [item] = await serverItemRecords(page);
    const listId = listIdOf(page);
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    const response = await joPage.request.put(
      `/api/lists/${listId}/items/${item!.id}`,
      { headers: sameOrigin(joPage), data: mutation() },
    );

    // Then
    expect(response.status()).toBe(403);
    expect(await serverItemRecords(page)).toMatchObject([
      { name: 'secret sauce', crossedOff: false, itemRevision: 1 },
    ]);
    await page.reload();
    await expect(crossOffButton(page, 'secret sauce')).toBeVisible();
    await joPage.context().close();
  });

  test("a foreign item on household B's own list gets the same 404 as a missing item", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    await startWithList(page, syncPair(testInfo).sam, 'Isolated item');
    await seedItems(page, [{ name: 'secret sauce' }]);
    await expect(crossOffButton(page, 'secret sauce')).toBeVisible();
    const [item] = await serverItemRecords(page);
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);
    const joList = uniqueName('Jo own');
    await createList(joPage, joList);
    await openList(joPage, joList);
    const joListId = listIdOf(joPage);

    // When
    const foreign = await joPage.request.put(
      `/api/lists/${joListId}/items/${item!.id}`,
      { headers: sameOrigin(joPage), data: mutation() },
    );
    const missing = await joPage.request.put(
      `/api/lists/${joListId}/items/${randomUUID()}`,
      { headers: sameOrigin(joPage), data: mutation() },
    );

    // Then
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(await serverItemRecords(page)).toMatchObject([
      { name: 'secret sauce', crossedOff: false, itemRevision: 1 },
    ]);
    await joPage.context().close();
  });
});
