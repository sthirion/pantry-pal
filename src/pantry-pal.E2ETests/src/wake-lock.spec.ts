import {
  expect,
  heldWakeLocks,
  installWakeLock,
  openMarketList,
  setVisibility,
  test,
  wakeLockRequests,
} from './fixtures.js';

test.describe('Screen wake lock @TEST', () => {
  test('list screen holds a wake lock and releases it when leaving', async ({
    page,
    api,
  }) => {
    // Given
    void api;
    await installWakeLock(page, true);

    // When
    await openMarketList(page);

    // Then
    await expect.poll(() => heldWakeLocks(page)).toBe(1);

    // When
    await page.getByRole('link', { name: 'Back to lists' }).click();

    // Then
    await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
    await expect.poll(() => heldWakeLocks(page)).toBe(0);
  });

  test('lists screen does not request a wake lock', async ({ page, api }) => {
    // Given
    void api;
    await installWakeLock(page, true);

    // When
    await page.goto('/lists');

    // Then
    await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();
    expect(await wakeLockRequests(page)).toBe(0);
  });

  test('wake lock is requested again when the shopper returns to the app', async ({
    page,
    api,
  }) => {
    // Given
    void api;
    await installWakeLock(page, true);
    await openMarketList(page);
    await expect.poll(() => heldWakeLocks(page)).toBe(1);

    // When
    await setVisibility(page, 'hidden');
    await expect.poll(() => heldWakeLocks(page)).toBe(0);
    await setVisibility(page, 'visible');

    // Then
    await expect.poll(() => heldWakeLocks(page)).toBe(1);
  });

  test('list screen works in a browser without Wake Lock', async ({
    page,
    api,
  }) => {
    // Given
    void api;
    await installWakeLock(page, false);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // When
    await openMarketList(page);
    await page.getByLabel('Add an item').fill('apples');
    await page.getByRole('button', { name: 'Add item' }).click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off apples' }),
    ).toBeVisible();
    expect(await page.evaluate(() => 'wakeLock' in navigator)).toBe(false);
    expect(errors).toEqual([]);
  });
});
