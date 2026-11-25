import type { Locator, Page } from '@playwright/test';
import { expect, sam, test, uniqueName } from './journeys.js';

const MAX_TABS = 150;

/** Presses Tab until `target` has focus, then checks that the focus is visible. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  for (let presses = 0; presses < MAX_TABS; presses++) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate(
      (el) => el === document.activeElement,
    );
    if (focused) {
      await expectVisibleFocus(target);
      return;
    }
  }
  throw new Error(`Tab did not reach the control within ${MAX_TABS} presses`);
}

/** The app draws a solid outline on `:focus-visible`; a focused control without one is invisible. */
async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const outline = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).toBe('solid');
  expect(outline.width).toBeGreaterThan(0);
}

test.describe('Keyboard-only journey @TEST', () => {
  test('J7 sam can use the whole core flow with only the keyboard', async ({
    page,
    browserName,
  }) => {
    // Given
    // The "000" prefix sorts the list first, so Tab reaches it before the other tests' lists.
    const name = uniqueName('000 Keyboard');
    await page.goto('/sign-in');

    // When: sign in (Tab to each field, type, Enter on the button)
    await tabTo(page, page.getByLabel('Email'));
    await page.keyboard.type(sam.email);
    await tabTo(page, page.getByLabel('Password'));
    await page.keyboard.type(sam.password);
    await tabTo(page, page.getByRole('button', { name: 'Sign in' }));
    await page.keyboard.press('Enter');

    // Then
    await expect(page.getByRole('heading', { name: 'Lists' })).toBeVisible();

    // When: create a list (Space on the button)
    await tabTo(page, page.getByLabel('New list name'));
    await page.keyboard.type(name);
    await tabTo(page, page.getByRole('button', { name: 'Create list' }));
    await page.keyboard.press('Space');

    // Then
    const listLink = page.getByRole('link', { name });
    await expect(listLink).toBeVisible();

    // When: open it (Enter on the link)
    if (browserName === 'webkit') {
      // WebKit leaves links out of the Tab order by default (Safari needs Option+Tab; headless
      // WebKit has no such key), so the link gets focus directly there. Enter still activates it.
      await listLink.focus();
      await expectVisibleFocus(listLink);
    } else {
      await tabTo(page, listLink);
    }
    await page.keyboard.press('Enter');

    // Then
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // When: add an item, stepping back once with Shift+Tab
    const field = page.getByRole('combobox', { name: 'Add an item' });
    const addButton = page.getByRole('button', { name: 'Add item' });
    await tabTo(page, field);
    await page.keyboard.type('milk');
    await tabTo(page, addButton);
    await page.keyboard.press('Shift+Tab');
    await expectVisibleFocus(field);
    await page.keyboard.press('Tab');
    await expectVisibleFocus(addButton);
    await page.keyboard.press('Enter');

    // Then
    const crossOff = page.getByRole('button', { name: 'Cross off milk' });
    await expect(crossOff).toBeVisible();

    // When: cross it off (Space)
    await tabTo(page, crossOff);
    await page.keyboard.press('Space');

    // Then
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // When: open the clear-crossed-off prompt (Enter) and cancel it (Enter)
    const clear = page.getByRole('button', {
      name: 'Clear crossed off',
      exact: true,
    });
    const prompt = page.getByRole('group', {
      name: 'Confirm clearing crossed-off items',
    });
    await tabTo(page, clear);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Remove 1 crossed-off item?')).toBeVisible();
    await tabTo(page, prompt.getByRole('button', { name: 'Cancel' }));
    await page.keyboard.press('Enter');

    // Then
    await expect(prompt).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toBeVisible();

    // When: open the prompt again and confirm it (Space)
    await tabTo(page, clear);
    await page.keyboard.press('Enter');
    await tabTo(
      page,
      prompt.getByRole('button', { name: 'Clear crossed off', exact: true }),
    );
    await page.keyboard.press('Space');

    // Then
    await expect(
      page.getByRole('button', { name: 'Restore milk' }),
    ).toHaveCount(0);
    await expect(page.getByText('No items yet.')).toBeVisible();

    // And the data is still there after a reload
    await page.reload();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('No items yet.')).toBeVisible();
  });
});
