import {
  createList,
  expect,
  sam,
  signIn,
  test,
  uniqueName,
} from './journeys.js';

test.describe('List management @TEST', () => {
  test('sam can create, rename and delete a list', async ({ page }) => {
    // Given
    const name = uniqueName('Weekly');
    const renamed = uniqueName('Party');
    await signIn(page, sam);

    // When
    await createList(page, name);

    // Then
    await expect(page.getByRole('link', { name })).toBeVisible();

    // When
    await page.getByRole('button', { name: `Rename ${name}` }).click();
    await page.getByLabel(`New name for ${name}`).fill(renamed);
    await page.getByRole('button', { name: 'Save' }).click();

    // Then
    await expect(page.getByRole('link', { name: renamed })).toBeVisible();
    await expect(page.getByRole('link', { name })).toHaveCount(0);

    // When
    await page.getByRole('button', { name: `Delete ${renamed}` }).click();
    await page
      .getByRole('group', { name: `Confirm deleting ${renamed}` })
      .getByRole('button', { name: 'Delete list' })
      .click();

    // Then
    await expect(page.getByRole('link', { name: renamed })).toHaveCount(0);
  });

  test('a duplicate list name is rejected', async ({ page }) => {
    // Given
    const name = uniqueName('Dupes');
    await signIn(page, sam);
    await createList(page, name);

    // When
    await page.getByLabel('New list name').fill(name);
    await page.getByRole('button', { name: 'Create list' }).click();

    // Then
    await expect(
      page.getByText('You already have a list with this name.'),
    ).toBeVisible();
  });

  test('cancelling a delete keeps the list', async ({ page }) => {
    // Given
    const name = uniqueName('Keep');
    await signIn(page, sam);
    await createList(page, name);

    // When
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Then
    await expect(page.getByRole('link', { name })).toBeVisible();
  });

  test('lists persist after a reload', async ({ page }) => {
    // Given
    const name = uniqueName('Persist');
    await signIn(page, sam);
    await createList(page, name);

    // When
    await page.reload();

    // Then
    await expect(page.getByRole('link', { name })).toBeVisible();
  });
});
