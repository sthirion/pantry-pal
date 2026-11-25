import type { Page } from '@playwright/test';
import {
  addItem,
  clearCrossedOff,
  crossOff,
  crossOffButton,
  deleteItem,
  expect,
  openList,
  renameItem,
  restoreButton,
  sam,
  seedItems,
  serverItems,
  startWithList,
  test,
  waitForOfflineShell,
} from './journeys.js';

const SYNC_DEADLINE_MS = 2_000;
const MIN_SYNCED = 19;

const OFFLINE_NOTICE = 'You are offline. Changes are saved on this device.';
const waitingToSync = (page: Page) => page.getByText(/waiting to sync/);

/** Alex signs in after the list is prepared and opens it, so he starts from the same items as Sam. */
async function joinList(
  openAlexPage: () => Promise<Page>,
  listName: string,
  activeItems: readonly string[],
): Promise<Page> {
  const alexPage = await openAlexPage();
  await openList(alexPage, listName);
  for (const item of activeItems) {
    await expect(crossOffButton(alexPage, item)).toBeVisible();
  }
  return alexPage;
}

/** The accessible names of every button on the page, read in one snapshot. */
async function buttonNames(page: Page): Promise<Set<string>> {
  const names = await page
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? ''),
    );
  return new Set(names);
}

test.describe('Sync between household members @TEST', () => {
  test('at least 19 of 20 changes by sam reach alex within 2 seconds', async ({
    page,
    openAlexPage,
  }) => {
    // Given
    const listName = await startWithList(page, sam, 'Sync twenty');
    const renames = [1, 2, 3, 4].map((n) => ({
      from: `rename-from-${n}`,
      to: `rename-to-${n}`,
    }));
    const crosses = [1, 2, 3, 4, 5].map((n) => `cross-${n}`);
    const deletes = [1, 2, 3, 4].map((n) => `delete-${n}`);
    const cleared = ['clear-1', 'clear-2'];
    const added = [1, 2, 3, 4, 5, 6].map((n) => `added-${n}`);
    await seedItems(page, [
      ...renames.map(({ from }) => ({ name: from })),
      ...crosses.map((name) => ({ name })),
      ...deletes.map((name) => ({ name })),
      ...cleared.map((name) => ({ name, crossedOff: true })),
    ]);
    const alexPage = await joinList(openAlexPage, listName, [
      ...renames.map(({ from }) => from),
      ...crosses,
      ...deletes,
    ]);
    await expect(restoreButton(alexPage, cleared[0]!)).toBeVisible();

    // One check per change: does Alex's page show its outcome?
    const changes: Array<(names: Set<string>) => boolean> = [
      ...added.map(
        (name) => (names: Set<string>) => names.has(`Cross off ${name}`),
      ),
      ...crosses.map(
        (name) => (names: Set<string>) => names.has(`Restore ${name}`),
      ),
      ...renames.map(
        ({ from, to }) =>
          (names: Set<string>) =>
            names.has(`Cross off ${to}`) && !names.has(`Cross off ${from}`),
      ),
      ...deletes.map(
        (name) => (names: Set<string>) =>
          !names.has(`Cross off ${name}`) && !names.has(`Restore ${name}`),
      ),
      (names) => cleared.every((name) => !names.has(`Restore ${name}`)),
    ];
    expect(changes).toHaveLength(20);

    // When
    // Clear runs first: it removes every crossed-off item, including ones crossed off earlier.
    await clearCrossedOff(page);
    for (const name of deletes) await deleteItem(page, name);
    for (const { from, to } of renames) await renameItem(page, from, to);
    for (const name of crosses) await crossOff(page, name);
    for (const name of added) await addItem(page, name);

    // Then
    // The final change is acknowledged in Sam's UI; the 2-second budget starts now.
    const reflected = async () => {
      const names = await buttonNames(alexPage);
      return changes.filter((isReflected) => isReflected(names)).length;
    };
    await expect
      .poll(reflected, {
        timeout: SYNC_DEADLINE_MS,
        intervals: [50, 100, 200],
        message: `changes of 20 reflected for Alex within ${SYNC_DEADLINE_MS} ms (minimum ${MIN_SYNCED})`,
      })
      .toBeGreaterThanOrEqual(MIN_SYNCED);
  });

  test('five offline changes by sam survive a reload and reach alex after reconnecting', async ({
    page,
    openAlexPage,
  }) => {
    // Given
    const listName = await startWithList(page, sam, 'Offline five');
    const added = 'added-offline';
    const crossTarget = 'cross-target';
    const renameTarget = 'rename-target';
    const renamed = 'renamed-offline';
    const deleteTarget = 'delete-target';
    const clearTarget = 'clear-target';
    await seedItems(page, [
      { name: crossTarget },
      { name: renameTarget },
      { name: deleteTarget },
      { name: clearTarget, crossedOff: true },
    ]);
    const alexPage = await joinList(openAlexPage, listName, [
      crossTarget,
      renameTarget,
      deleteTarget,
    ]);
    await expect(restoreButton(alexPage, clearTarget)).toBeVisible();
    await expect(crossOffButton(page, deleteTarget)).toBeVisible();
    await waitForOfflineShell(page);
    await page.context().setOffline(true);
    await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();

    // When
    // Clear runs before the cross-off: it removes every crossed-off item, including ones crossed off earlier.
    await addItem(page, added);
    await renameItem(page, renameTarget, renamed);
    await deleteItem(page, deleteTarget);
    await clearCrossedOff(page);
    await crossOff(page, crossTarget);
    await expect(page.getByText('5 changes waiting to sync')).toBeVisible();
    await page.reload();
    // The offline page must finish its session check before reconnecting; reconnecting mid-check races it.
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(
      page.getByRole('heading', { name: listName }).or(retry),
    ).toBeVisible();
    await page.context().setOffline(false);
    // A cold start offline cannot resolve the session, so the app shows its retry screen; reconnecting does not clear it.
    if (await retry.isVisible()) await retry.click();

    // Then
    await expect(page.getByRole('heading', { name: listName })).toBeVisible();
    await expect
      .poll(() => serverItems(alexPage))
      .toEqual([
        { name: added, crossedOff: false },
        { name: crossTarget, crossedOff: true },
        { name: renamed, crossedOff: false },
      ]);
    await expect(waitingToSync(page)).toHaveCount(0);
    await alexPage.reload();
    await expect(crossOffButton(alexPage, added)).toBeVisible();
    await expect(restoreButton(alexPage, crossTarget)).toBeVisible();
    await expect(crossOffButton(alexPage, renamed)).toBeVisible();
    await expect(crossOffButton(alexPage, renameTarget)).toHaveCount(0);
    await expect(crossOffButton(alexPage, deleteTarget)).toHaveCount(0);
    await expect(restoreButton(alexPage, clearTarget)).toHaveCount(0);
  });

  test("alex's later online rename and sam's earlier offline cross-off are both kept", async ({
    page,
    openAlexPage,
  }) => {
    // Given
    const listName = await startWithList(page, sam, 'Conflict');
    const original = 'conflict-original';
    const renamed = 'conflict-renamed';
    await seedItems(page, [{ name: original }]);
    const alexPage = await joinList(openAlexPage, listName, [original]);
    await page.context().setOffline(true);
    await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();

    // When
    await crossOff(page, original);
    await expect(page.getByText('1 change waiting to sync')).toBeVisible();
    await renameItem(alexPage, original, renamed);
    await expect
      .poll(() => serverItems(alexPage))
      .toEqual([{ name: renamed, crossedOff: false }]);
    await page.context().setOffline(false);
    // Sam's page shows the shared name once his queued change has been sent and answered.
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);

    // Then
    await expect
      .poll(() => serverItems(alexPage))
      .toEqual([{ name: renamed, crossedOff: true }]);
    await alexPage.reload();
    await expect(restoreButton(alexPage, renamed)).toBeVisible();
    await expect(restoreButton(page, renamed)).toBeVisible();
  });
});
