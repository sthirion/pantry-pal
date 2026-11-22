import {
  addItem,
  alex,
  createList,
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
});
