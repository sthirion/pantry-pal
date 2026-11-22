import { addItem, expect, sam, startWithList, test } from './journeys.js';

test.describe('Item management @TEST', () => {
  test('sam can add, cross off and restore an item', async ({ page }) => {
    // Given
    await startWithList(page, sam);

    // When
    await addItem(page, 'milk');
    await page.getByRole('button', { name: 'Cross off milk' }).click();

    // Then
    const restore = page.getByRole('button', { name: 'Restore milk' });
    await expect(restore).toBeVisible();
    await expect(restore).toHaveAttribute('aria-pressed', 'true');

    // When
    await restore.click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
  });

  test('sam can rename an item', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    await addItem(page, 'bred');

    // When
    await page.getByRole('button', { name: 'Actions for bred' }).click();
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('New name for bred').fill('bread');
    await page.getByRole('button', { name: 'Save' }).click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off bread' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cross off bred' }),
    ).toHaveCount(0);
  });

  test('sam can delete an item', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    await addItem(page, 'eggs');

    // When
    await page.getByRole('button', { name: 'Actions for eggs' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off eggs' }),
    ).toHaveCount(0);
    await expect(page.getByText('No items yet.')).toBeVisible();
  });

  test('sam can clear crossed-off items', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    await addItem(page, 'milk');
    await addItem(page, 'butter');
    await page.getByRole('button', { name: 'Cross off milk' }).click();
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toBeVisible();

    // When
    await page.getByRole('button', { name: 'Clear crossed off' }).click();
    await expect(page.getByText('Remove 1 crossed-off item?')).toBeVisible();
    await page
      .getByRole('group', { name: 'Confirm clearing crossed-off items' })
      .getByRole('button', { name: 'Clear crossed off' })
      .click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Cross off butter' }),
    ).toBeVisible();
  });

  test('a blank item name is rejected', async ({ page }) => {
    // Given
    await startWithList(page, sam);

    // When
    await page.getByRole('combobox', { name: 'Add an item' }).fill('   ');
    await page.getByRole('button', { name: 'Add item' }).click();

    // Then
    await expect(page.getByText('Enter an item name.')).toBeVisible();
  });

  test('items persist after a reload', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    await addItem(page, 'apples');

    // When
    await page.reload();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off apples' }),
    ).toBeVisible();
  });

  test('sam can choose a suggestion', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    const input = page.getByRole('combobox', { name: 'Add an item' });

    // When
    await input.fill('oat');
    await page.getByRole('option', { name: 'oat milk' }).click();

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off oat milk' }),
    ).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('sam can choose a suggestion from the keyboard', async ({ page }) => {
    // Given
    await startWithList(page, sam);
    const input = page.getByRole('combobox', { name: 'Add an item' });

    // When
    await input.fill('oliv');
    await input.press('ArrowDown');
    await input.press('Enter');

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off olive oil' }),
    ).toBeVisible();
  });
});
