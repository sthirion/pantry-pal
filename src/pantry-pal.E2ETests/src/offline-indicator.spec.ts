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
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toBeVisible();
  });

  test('a rejected item edit is blocked and shown for review with its attempted values', async ({
    page,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.writeStatus = 422;

    // When
    await page.getByRole('button', { name: 'Cross off milk' }).click();

    // Then
    const review = page.getByRole('region', { name: 'Changes to review' });
    await expect(review).toBeVisible();
    await expect(
      review.getByText(
        'Your change to "milk" was not accepted (error 422). Nothing was applied.',
      ),
    ).toBeVisible();
    await expect(review.getByText('Crossed off')).toBeVisible();
    await expect(review.getByText('Your value: Yes')).toBeVisible();
    await expect(
      page.getByText(
        '1 change needs your review. Open its list to resolve it.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toHaveCount(0);

    // When
    await page.reload();

    // Then
    const reviewAfterReload = page.getByRole('region', {
      name: 'Changes to review',
    });
    await expect(reviewAfterReload).toBeVisible();
    await expect(
      reviewAfterReload.getByText(
        'Your change to "milk" was not accepted (error 422). Nothing was applied.',
      ),
    ).toBeVisible();
    await expect(reviewAfterReload.getByText('Crossed off')).toBeVisible();
    await expect(reviewAfterReload.getByText('Your value: Yes')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toHaveCount(0);
  });

  test('shopper can discard a blocked item edit from the keyboard', async ({
    page,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.writeStatus = 422;
    await page.getByRole('button', { name: 'Cross off milk' }).click();
    const review = page.getByRole('region', { name: 'Changes to review' });
    const discard = review.getByRole('button', {
      name: 'Discard my change to milk',
      exact: true,
    });
    await expect(discard).toBeVisible();

    // When
    await discard.focus();
    await expect(discard).toBeFocused();
    await page.keyboard.press('Enter');

    // Then
    await expect(review).toHaveCount(0);
    await expect(page.getByText(/needs? your review/)).toHaveCount(0);
    await expect(page.getByText(/waiting to sync/)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
  });
});
