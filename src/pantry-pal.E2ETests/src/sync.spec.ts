import type { Page } from '@playwright/test';
import {
  addItem,
  clearCrossedOff,
  crossOff,
  crossOffButton,
  deleteItem,
  expect,
  joinList,
  OFFLINE_NOTICE,
  renameItem,
  restoreButton,
  seedItems,
  serverItemRecords,
  serverItems,
  startWithList,
  syncPair,
  test,
  waitForOfflineShell,
  waitingToSync,
} from './journeys.js';

const SYNC_DEADLINE_MS = 2_000;
const MIN_SYNCED = 19;

/** The accessible names of every button on the page, read in one snapshot. */
async function buttonNames(page: Page): Promise<Set<string>> {
  const names = await page
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? ''),
    );
  return new Set(names);
}

// Sam and Alex belong to a household only this worker uses, so no other test adds lists under their clicks.
test.describe('Sync between household members @TEST', () => {
  test('at least 19 of 20 changes by sam reach alex within 2 seconds', async ({
    page,
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { sam, alex } = syncPair(testInfo);
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
    const alexPage = await joinList(() => openPersonaPage(alex), listName, [
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
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { sam, alex } = syncPair(testInfo);
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
    const alexPage = await joinList(() => openPersonaPage(alex), listName, [
      crossTarget,
      renameTarget,
      deleteTarget,
    ]);
    await expect(restoreButton(alexPage, clearTarget)).toBeVisible();
    await waitForOfflineShell(page);
    // The helper reloads; going offline before the app has rendered the list would cut its session check short.
    await expect(crossOffButton(page, deleteTarget)).toBeVisible();
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
    openPersonaPage,
  }, testInfo) => {
    // Given
    const { sam, alex } = syncPair(testInfo);
    const listName = await startWithList(page, sam, 'Conflict');
    const original = 'conflict-original';
    const renamed = 'conflict-renamed';
    await seedItems(page, [{ name: original }]);
    const alexPage = await joinList(() => openPersonaPage(alex), listName, [
      original,
    ]);
    await page.context().setOffline(true);
    await expect(page.getByText(OFFLINE_NOTICE)).toBeVisible();

    // When
    await crossOff(page, original);
    await expect(page.getByText('1 change waiting to sync')).toBeVisible();
    await renameItem(alexPage, original, renamed);
    await expect
      .poll(() => serverItemRecords(alexPage))
      .toMatchObject([{ name: renamed, crossedOff: false, itemRevision: 2 }]);
    const [afterRename] = await serverItemRecords(alexPage);
    await page.context().setOffline(false);
    // Sam's page shows the shared name once his queued change has been sent and answered.
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(waitingToSync(page)).toHaveCount(0);

    // Then
    // Sam's patch is applied on top of Alex's rename: one more item revision and a later sync cursor.
    await expect
      .poll(() => serverItemRecords(alexPage))
      .toMatchObject([{ name: renamed, crossedOff: true, itemRevision: 3 }]);
    const [merged] = await serverItemRecords(alexPage);
    expect(merged!.version).toBeGreaterThan(afterRename!.version);
    await expect(
      page.getByRole('heading', { name: 'Changes to review' }),
    ).toHaveCount(0);
    await alexPage.reload();
    await expect(restoreButton(alexPage, renamed)).toBeVisible();
    await expect(restoreButton(page, renamed)).toBeVisible();
  });
});
