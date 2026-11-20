import { expect, openMarketList, test } from './fixtures.js';

test.describe('Offline indicator and sync errors @TEST', () => {
  test('shopper offline sees the offline notice and the pending change count', async ({
    page,
    context,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.networkDown = true;
    await context.setOffline(true);

    // When
    await page.getByLabel('Add an item').fill('apples');
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Add an item').fill('pears');
    await page.getByRole('button', { name: 'Add item' }).click();

    // Then
    await expect(
      page.getByText('You are offline. Changes are saved on this device.'),
    ).toBeVisible();
    await expect(page.getByText('2 changes waiting to sync')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cross off apples' }),
    ).toBeVisible();
  });

  test('shopper sees a singular pending count for one change', async ({
    page,
    context,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.networkDown = true;
    await context.setOffline(true);

    // When
    await page.getByRole('button', { name: 'Cross off milk' }).click();

    // Then
    await expect(page.getByText('1 change waiting to sync')).toBeVisible();
  });

  test('indicator is hidden while online with nothing pending', async ({
    page,
    api,
  }) => {
    // Given
    void api;

    // When
    await openMarketList(page);

    // Then
    await expect(page.getByText(/You are offline/)).toHaveCount(0);
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  });

  test('indicator disappears after reconnecting and syncing', async ({
    page,
    context,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.networkDown = true;
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Cross off milk' }).click();
    await expect(page.getByText('1 change waiting to sync')).toBeVisible();

    // When
    api.networkDown = false;
    await context.setOffline(false);

    // Then
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
    await expect(page.getByText(/You are offline/)).toHaveCount(0);
  });

  test('shopper sees a plain-language message when the server rejects a change', async ({
    page,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.writeStatus = 422;

    // When
    await page.getByRole('button', { name: 'Cross off milk' }).click();

    // Then
    const alert = page
      .getByRole('alert')
      .filter({ hasText: "couldn't be saved" });
    await expect(alert).toContainText('error 422');
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
  });

  test('shopper can dismiss the rejected-change message', async ({
    page,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.writeStatus = 422;
    await page.getByRole('button', { name: 'Cross off milk' }).click();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: "couldn't be saved" });
    await expect(alert).toBeVisible();

    // When
    await alert.getByRole('button', { name: 'Dismiss' }).click();

    // Then
    await expect(alert).toHaveCount(0);
  });
});
