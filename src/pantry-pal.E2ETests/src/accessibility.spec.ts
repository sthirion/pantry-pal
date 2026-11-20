import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, openMarketList, test } from './fixtures.js';

const MIN_TARGET = 44;

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectTouchTargets(page: Page): Promise<void> {
  const controls = page.getByRole('button').or(page.getByRole('link'));
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const box = await control.boundingBox();
    const label = await control.innerText();
    // Inline text links inside a sentence are exempt under WCAG 2.5.8.
    if (
      await control.evaluate(
        (el) => el.tagName === 'A' && el.closest('p') !== null,
      )
    )
      continue;
    expect(box?.height, `${label} height`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box?.width, `${label} width`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
}

test.describe('Accessibility @TEST', () => {
  test('sign-in screen has no axe violations', async ({ page, api }) => {
    // Given
    api.signedIn = false;

    // When
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('lists screen has no axe violations and 44px touch targets', async ({
    page,
    api,
  }) => {
    // Given
    void api;

    // When
    await page.goto('/lists');
    await expect(page.getByRole('link', { name: 'Market' })).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
    await expectTouchTargets(page);
  });

  test('items screen has no axe violations and 44px touch targets', async ({
    page,
    api,
  }) => {
    // Given
    void api;

    // When
    await openMarketList(page);
    await expect(
      page.getByRole('button', { name: 'Restore bread' }),
    ).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
    await expectTouchTargets(page);
  });

  test('offline and rejected-change messages have no axe violations', async ({
    page,
    context,
    api,
  }) => {
    // Given
    await openMarketList(page);
    api.writeStatus = 422;
    await page.getByRole('button', { name: 'Cross off milk' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'error 422' }),
    ).toBeVisible();
    api.networkDown = true;
    await context.setOffline(true);

    // When
    await expect(page.getByText(/You are offline/)).toBeVisible();

    // Then
    await expectNoAxeViolations(page);
  });

  test('icon and toggle buttons have accessible names', async ({
    page,
    api,
  }) => {
    // Given
    void api;

    // When
    await openMarketList(page);

    // Then
    await expect(
      page.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restore bread' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Actions for milk' }),
    ).toBeVisible();
    for (const button of await page.getByRole('button').all()) {
      await expect(button).not.toHaveAccessibleName('');
    }
  });

  test('crossed-off state is announced to screen readers', async ({
    page,
    api,
  }) => {
    // Given
    void api;
    await openMarketList(page);

    // When
    const crossed = page.getByRole('button', { name: 'Restore bread' });
    const active = page.getByRole('button', { name: 'Cross off milk' });

    // Then
    await expect(crossed).toHaveAttribute('aria-pressed', 'true');
    await expect(crossed).toHaveAccessibleDescription('Crossed off');
    await expect(active).toHaveAttribute('aria-pressed', 'false');
  });

  test('keyboard focus is visible and crossing off works from the keyboard', async ({
    page,
    api,
  }) => {
    // Given
    void api;
    await openMarketList(page);
    const toggle = page.getByRole('button', { name: 'Cross off milk' });

    // When
    await toggle.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');

    // Then
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('outline-style', 'solid');
    await expect(toggle).toHaveCSS('outline-width', '3px');

    // When
    await page.keyboard.press('Space');

    // Then
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toBeVisible();
  });
});
