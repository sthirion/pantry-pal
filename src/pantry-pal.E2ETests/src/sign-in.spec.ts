import { alex, expect, jo, sam, seed, signIn, test } from './journeys.js';

test.describe('Sign in and out @TEST', () => {
  test('sam can sign in and sign out', async ({ page }) => {
    // Given
    await page.goto('/sign-in');

    // When
    await signIn(page, sam);

    // Then
    await expect(
      page.getByText(`Signed in as Sam (${seed.households.a}).`),
    ).toBeVisible();

    // When
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Then
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.goto('/lists');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a wrong password shows an error and stays on sign-in', async ({
    page,
  }) => {
    // Given
    await page.goto('/sign-in');

    // When
    await page.getByLabel('Email').fill(sam.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Then
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Email or password is incorrect' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a signed-out visitor is sent to sign-in', async ({ page }) => {
    // Given / When
    await page.goto('/lists');

    // Then
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  for (const persona of [alex, jo]) {
    test(`${persona.name} sees their own household`, async ({ page }) => {
      // Given / When
      await signIn(page, persona);

      // Then
      await expect(
        page.getByText(
          `Signed in as ${persona.name} (${seed.households[persona.household]}).`,
        ),
      ).toBeVisible();
    });
  }
});
