import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  addItem,
  expect,
  sam,
  signIn,
  startWithList,
  test,
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
});
