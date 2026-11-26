import type { Page } from '@playwright/test';
import {
  addItem,
  alex,
  createList,
  emptyStatePersona,
  expect,
  jo,
  openList,
  openSignedInPage,
  sam,
  seed,
  signIn,
  test,
  uniqueName,
} from './journeys.js';

test.describe('Household data isolation @TEST', () => {
  test("household B never sees household A's lists", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const name = uniqueName('Smith groceries');
    await signIn(page, sam);
    await createList(page, name);
    await openList(page, name);
    await addItem(page, 'secret sauce');

    // When
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // Then
    await expect(
      joPage.getByText(`Signed in as Jo (${seed.households.b}).`),
    ).toBeVisible();
    await expect(joPage.getByRole('link', { name })).toHaveCount(0);
    await joPage.reload();
    await expect(joPage.getByRole('heading', { name: 'Lists' })).toBeVisible();
    await expect(joPage.getByRole('link', { name })).toHaveCount(0);
    await joPage.context().close();
  });

  test("household B cannot open household A's list by address", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const name = uniqueName('Private');
    await signIn(page, sam);
    await createList(page, name);
    await openList(page, name);
    const listPath = new URL(page.url()).pathname;
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    await joPage.goto(listPath);

    // Then
    await expect(joPage.getByText('This list no longer exists.')).toBeVisible();
    await expect(joPage.getByRole('heading', { name })).toHaveCount(0);
    await joPage.context().close();
  });

  test("both members of household A see each other's lists", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const name = uniqueName('Shared');
    await signIn(page, sam);
    await createList(page, name);

    // When
    const alexPage = await openSignedInPage(
      browser,
      alex,
      testInfo.project.use,
    );

    // Then
    await expect(alexPage.getByRole('link', { name })).toBeVisible();
    await alexPage.context().close();
  });

  test('a household with no lists sees the empty state', async ({
    browser,
  }, testInfo) => {
    // Given: the worker's empty-state household never gets a list from any test

    // When
    const emptyPage = await openSignedInPage(
      browser,
      emptyStatePersona(testInfo),
      testInfo.project.use,
    );

    // Then
    await expect(
      emptyPage.getByText('No lists yet. Create your first list above.'),
    ).toBeVisible();
    await emptyPage.context().close();
  });
});

/** Sam creates a list with an item; returns its name and id (taken from its address). */
async function createSamList(
  page: Page,
): Promise<{ name: string; id: string }> {
  const name = uniqueName('Smith groceries');
  await signIn(page, sam);
  await createList(page, name);
  await openList(page, name);
  await addItem(page, 'secret sauce');
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(id).not.toBe('');
  return { name, id };
}

test.describe('Household data isolation through the API @TEST', () => {
  // The browser context sends its session cookie; the Origin header makes each call same-origin,
  // so the CSRF check passes and a 403 can only come from the household boundary.
  const sameOrigin = (page: Page) => ({ origin: new URL(page.url()).origin });

  test("household B's sync contains none of household A's data", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const list = await createSamList(page);
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    const response = await joPage.request.get('/api/sync?since=0');

    // Then
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      lists: { id: string }[];
      items: { listId: string }[];
    };
    expect(body.lists.map((l) => l.id)).not.toContain(list.id);
    expect(body.items.map((i) => i.listId)).not.toContain(list.id);
    const text = JSON.stringify(body);
    expect(text).not.toContain(list.name);
    expect(text).not.toContain('secret sauce');
    await joPage.context().close();
  });

  test("household B cannot rename household A's list", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const list = await createSamList(page);
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    const response = await joPage.request.put(`/api/lists/${list.id}`, {
      headers: sameOrigin(joPage),
      data: {
        name: uniqueName('Hijacked'),
        changedAt: new Date().toISOString(),
      },
    });

    // Then
    expect(response.status()).toBe(403);
    const alexPage = await openSignedInPage(
      browser,
      alex,
      testInfo.project.use,
    );
    await expect(alexPage.getByRole('link', { name: list.name })).toBeVisible();
    await alexPage.context().close();
    await joPage.context().close();
  });

  test("household B cannot delete household A's list", async ({
    page,
    browser,
  }, testInfo) => {
    // Given
    const list = await createSamList(page);
    const joPage = await openSignedInPage(browser, jo, testInfo.project.use);

    // When
    const changedAt = encodeURIComponent(new Date().toISOString());
    const response = await joPage.request.delete(
      `/api/lists/${list.id}?changedAt=${changedAt}`,
      { headers: sameOrigin(joPage) },
    );

    // Then
    expect(response.status()).toBe(403);
    const alexPage = await openSignedInPage(
      browser,
      alex,
      testInfo.project.use,
    );
    await expect(alexPage.getByRole('link', { name: list.name })).toBeVisible();
    await alexPage.getByRole('link', { name: list.name }).click();
    await expect(
      alexPage.getByRole('button', { name: 'Cross off secret sauce' }),
    ).toBeVisible();
    await alexPage.context().close();
    await joPage.context().close();
  });

  test('an anonymous caller is rejected', async ({ request }) => {
    // Given: no session cookie

    // When
    const response = await request.get('/api/sync?since=0');

    // Then
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain('secret sauce');
  });
});
