import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  addItem,
  clickRowControl,
  createList,
  expect,
  jo,
  openSignedInPage,
  sam,
  signIn,
  startWithList,
  test,
  uniqueName,
} from './journeys.js';

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('Accessibility of the real screens @TEST', () => {
  test('sign-in screen has no axe violations', async ({ page }) => {
    // Given / When
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('sign-in error state has no axe violations', async ({ page }) => {
    // Given
    await page.goto('/sign-in');

    // When
    await page.getByLabel('Email').fill(sam.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('lists screen has no axe violations', async ({ page }) => {
    // Given / When
    await startWithList(page, sam, 'Axe');
    await page.getByRole('link', { name: 'Back to lists' }).click();
    await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('items screen and its suggestions have no axe violations', async ({
    page,
  }) => {
    // Given
    await startWithList(page, sam, 'Axe');
    await addItem(page, 'milk');
    await addItem(page, 'bread');
    await page.getByRole('button', { name: 'Cross off bread' }).click();
    await expect(
      page.getByRole('button', { name: 'Restore bread' }),
    ).toBeVisible();

    // When
    await expectNoAxeViolations(page);
    await page.getByRole('combobox', { name: 'Add an item' }).fill('o');
    await expect(page.getByRole('listbox')).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('confirmation prompts have no axe violations', async ({ page }) => {
    // Given
    await startWithList(page, sam, 'Axe');
    await addItem(page, 'milk');
    await page.getByRole('button', { name: 'Cross off milk' }).click();

    // When
    await page.getByRole('button', { name: 'Clear crossed off' }).click();
    await expect(page.getByText('Remove 1 crossed-off item?')).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('not-found screen has no axe violations', async ({ page }) => {
    // Given
    await signIn(page, sam);

    // When
    await page.goto('/no-such-page');
    await expect(
      page.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('empty lists screen has no axe violations', async ({
    browser,
  }, testInfo) => {
    // Given / When
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);
    await expect(
      joPage.getByText('No lists yet. Create your first list above.'),
    ).toBeVisible();

    // Then
    await expectNoAxeViolations(joPage);
    await joPage.context().close();
  });

  test('empty items screen has no axe violations', async ({ page }) => {
    // Given / When
    await startWithList(page, sam, 'Axe');
    await expect(page.getByText('No items yet.')).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('delete-list prompt has no axe violations', async ({ page }) => {
    // Given
    const name = uniqueName('Axe');
    await signIn(page, sam);
    await createList(page, name);

    // When
    await clickRowControl(page.getByRole('button', { name: `Delete ${name}` }));
    await expect(
      page.getByRole('group', { name: `Confirm deleting ${name}` }),
    ).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('list rename edit state has no axe violations', async ({ page }) => {
    // Given
    const name = uniqueName('Axe');
    await signIn(page, sam);
    await createList(page, name);

    // When
    await clickRowControl(page.getByRole('button', { name: `Rename ${name}` }));
    await expect(page.getByLabel(`New name for ${name}`)).toBeFocused();

    // Then
    await expectNoAxeViolations(page);
  });

  test('item rename edit state has no axe violations', async ({ page }) => {
    // Given
    await startWithList(page, sam, 'Axe');
    await addItem(page, 'milk');

    // When
    await page.getByRole('button', { name: 'Actions for milk' }).click();
    await page.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByLabel('New name for milk')).toBeFocused();

    // Then
    await expectNoAxeViolations(page);
  });

  test('"list no longer exists" screen has no axe violations', async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    await startWithList(page, sam, 'Axe');
    const listPath = new URL(page.url()).pathname;
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    await joPage.goto(listPath);
    await expect(joPage.getByText('This list no longer exists.')).toBeVisible();

    // Then
    await expectNoAxeViolations(joPage);
    await joPage.context().close();
  });
});
