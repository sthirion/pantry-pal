import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemsPage } from './ItemsPage';
import { clearAllStores, db } from '../services/db';
import { saveItem, saveList } from '../services/mutations';

vi.mock('../services/sync-engine', () => ({
  syncEngine: { flush: vi.fn().mockResolvedValue(undefined) },
}));

const LIST = 'list-1';

beforeEach(async () => {
  await clearAllStores();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = (listId = LIST) =>
  render(
    <MemoryRouter initialEntries={[`/lists/${listId}`]}>
      <Routes>
        <Route path="/lists/:listId" element={<ItemsPage />} />
      </Routes>
    </MemoryRouter>,
  );

const seed = async (
  ...items: { name: string; crossedOff?: boolean; at?: string }[]
) => {
  await saveList('Market', LIST);
  for (const { name, crossedOff = false, at } of items) {
    const id = await saveItem(LIST, { name, crossedOff });
    if (at) await db.items.update(id, { crossedOffAt: at });
  }
  await db.outbox.clear();
};

const outbox = async () => (await db.outbox.toArray()).map((e) => e.mutation);
const addField = () => screen.getByLabelText('Add an item');
const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.item-row__name')?.textContent);

describe('ItemsPage', () => {
  it('shows the list name, an empty state, and a labelled add field', async () => {
    await seed();
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Market' }),
    ).toBeVisible();
    expect(screen.getByText(/No items yet/)).toBeVisible();
    expect(addField()).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to lists' })).toHaveAttribute(
      'href',
      '/lists',
    );
  });

  it('shows a not-found message for a missing or deleted list', async () => {
    renderPage('missing');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer exists',
    );
    expect(screen.queryByLabelText('Add an item')).not.toBeInTheDocument();
  });

  it('shows an error when the local store cannot be read', async () => {
    const spy = vi.spyOn(db.lists, 'get').mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this list',
    );
    spy.mockRestore();
  });

  it('adds an item with Enter, queues it, and keeps the field focused and empty', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });

    await user.type(addField(), '  green   apples {Enter}');

    expect(
      await screen.findByRole('button', { name: 'Cross off green apples' }),
    ).toBeVisible();
    expect(addField()).toHaveValue('');
    expect(addField()).toHaveFocus();
    expect(await outbox()).toMatchObject([
      {
        kind: 'putItem',
        listId: LIST,
        body: { name: 'green apples', crossedOff: false },
      },
    ]);
  });

  it('adds an item with the + button and refocuses the field', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });

    await user.type(addField(), 'apples');
    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(
      await screen.findByRole('button', { name: 'Cross off apples' }),
    ).toBeVisible();
    expect(addField()).toHaveFocus();
  });

  it('adds two different items', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });

    await user.type(addField(), 'apples{Enter}');
    await user.type(addField(), 'pears{Enter}');

    await screen.findByRole('button', { name: 'Cross off pears' });
    expect(await db.items.count()).toBe(2);
  });

  it.each([
    ['an empty name', '   ', 'Enter an item name.'],
    ['a name over 200 characters', 'a'.repeat(201), 'at most 200 characters'],
  ])(
    'shows an inline error and adds nothing for %s',
    async (_c, text, message) => {
      await seed();
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('heading', { name: 'Market' });

      await user.type(addField(), `${text}{Enter}`);

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(addField()).toHaveAttribute('aria-invalid', 'true');
      expect(await db.items.count()).toBe(0);
      expect(await outbox()).toEqual([]);
    },
  );

  it('accepts a 200-character name', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });

    await user.type(addField(), `${'a'.repeat(200)}{Enter}`);

    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears an earlier error after a valid add', async () => {
    await seed();
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });

    await user.type(addField(), '{Enter}');
    expect(screen.getByRole('alert')).toBeVisible();
    await user.type(addField(), 'milk{Enter}');

    await screen.findByRole('button', { name: 'Cross off milk' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores a crossed-off item instead of adding a duplicate', async () => {
    await seed({ name: 'milk', crossedOff: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Restore milk' });

    await user.type(addField(), 'Milk{Enter}');

    expect(
      await screen.findByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    expect(await db.items.count()).toBe(1);
    expect(await outbox()).toMatchObject([
      {
        kind: 'updateItem',
        baseItemRevision: 1,
        changes: { crossedOff: false },
      },
    ]);
  });

  it('adds nothing and highlights an active item with the same name', async () => {
    await seed({ name: 'milk' }, { name: 'eggs' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Cross off milk' });

    await user.type(addField(), 'MILK{Enter}');

    const row = screen
      .getByRole('button', { name: 'Cross off milk' })
      .closest('li');
    expect(row).toHaveClass('item-row--highlight');
    expect(within(row as HTMLElement).getByRole('status')).toHaveTextContent(
      'Already on the list',
    );
    expect(
      screen.getByRole('button', { name: 'Cross off eggs' }).closest('li'),
    ).not.toHaveClass('item-row--highlight');
    expect(await db.items.count()).toBe(2);
    expect(await outbox()).toEqual([]);
    expect(addField()).toHaveValue('');
  });

  it('crosses an item off with strikethrough styling and restores it on a second tap', async () => {
    await seed({ name: 'bread' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Cross off bread' }),
    );

    const crossed = await screen.findByRole('button', {
      name: 'Restore bread',
    });
    expect(crossed).toHaveAttribute('aria-pressed', 'true');
    expect(crossed.closest('li')).toHaveClass('item-row--crossed');
    expect(screen.getByRole('heading', { name: 'Crossed Off' })).toBeVisible();
    expect((await outbox())[0]).toHaveProperty('changes', { crossedOff: true });

    await user.click(crossed);

    const back = await screen.findByRole('button', {
      name: 'Cross off bread',
    });
    expect(back).toHaveAttribute('aria-pressed', 'false');
    expect(back.closest('li')).not.toHaveClass('item-row--crossed');
    expect(
      screen.queryByRole('heading', { name: 'Crossed Off' }),
    ).not.toBeInTheDocument();
  });

  it('lists crossed-off items with the most recent first', async () => {
    await seed(
      { name: 'old', crossedOff: true, at: '2026-01-01T00:00:00.000Z' },
      { name: 'new', crossedOff: true, at: '2026-01-03T00:00:00.000Z' },
      { name: 'mid', crossedOff: true, at: '2026-01-02T00:00:00.000Z' },
    );
    renderPage();

    const section = await screen.findByRole('list', { name: 'Crossed Off' });

    expect(names(section)).toEqual(['new', 'mid', 'old']);
  });

  it('shows active items in the order they were added', async () => {
    await seed({ name: 'first' }, { name: 'second' });
    renderPage();

    const section = await screen.findByRole('list', { name: 'Items to buy' });

    expect(names(section)).toEqual(['first', 'second']);
  });

  it('renames an item through its menu and keeps it crossed off', async () => {
    await seed({ name: 'milk', crossedOff: true });
    const user = userEvent.setup();
    renderPage();

    const menu = await screen.findByRole('button', {
      name: 'Actions for milk',
    });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New name for milk');
    await user.clear(input);
    await user.type(input, 'oat  milk');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('button', { name: 'Restore oat milk' }),
    ).toBeVisible();
    expect(await outbox()).toHaveLength(1);
    expect((await outbox())[0]).toHaveProperty('changes', { name: 'oat milk' });
  });

  it.each([
    ['empty', '  ', 'Enter an item name.'],
    ['too long', 'a'.repeat(201), 'at most 200 characters'],
    ['a duplicate', ' EGGS ', 'already has an item'],
  ])('rejects renaming to %s with an inline error', async (_c, text, msg) => {
    await seed({ name: 'milk' }, { name: 'eggs' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for milk' }),
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New name for milk');
    await user.clear(input);
    if (text.trim()) await user.type(input, text);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent(msg);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await outbox()).toEqual([]);
  });

  it('allows renaming an item to a different case of its own name', async () => {
    await seed({ name: 'milk' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for milk' }),
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New name for milk');
    await user.clear(input);
    await user.type(input, 'MILK');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('button', { name: 'Cross off MILK' }),
    ).toBeVisible();
  });

  it('cancels a rename without changes', async () => {
    await seed({ name: 'milk' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for milk' }),
    );
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    expect(await outbox()).toEqual([]);
  });

  it('deletes an item through its menu at once', async () => {
    await seed({ name: 'milk' }, { name: 'eggs' });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for milk' }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Cross off milk' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Cross off eggs' }),
    ).toBeVisible();
    expect(await outbox()).toMatchObject([
      { kind: 'deleteItem', listId: LIST },
    ]);
  });

  it('hides the clear button when nothing is crossed off', async () => {
    await seed({ name: 'milk' });
    renderPage();
    await screen.findByRole('button', { name: 'Cross off milk' });

    expect(
      screen.queryByRole('button', { name: 'Clear crossed off' }),
    ).not.toBeInTheDocument();
  });

  it('clears exactly the crossed-off items after confirming', async () => {
    await seed(
      { name: 'milk' },
      { name: 'bread', crossedOff: true },
      { name: 'eggs', crossedOff: true },
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Clear crossed off' }),
    );
    expect(screen.getByText('Remove 2 crossed-off items?')).toBeVisible();
    expect(await db.items.filter((i) => i.deletedAt !== null).count()).toBe(0);

    await user.click(
      within(
        screen.getByRole('group', {
          name: 'Confirm clearing crossed-off items',
        }),
      ).getByRole('button', { name: 'Clear crossed off' }),
    );

    await vi.waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Crossed Off' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Cross off milk' }),
    ).toBeVisible();
    expect(await outbox()).toMatchObject([
      { kind: 'deleteItems', listId: LIST },
    ]);
  });

  it('keeps crossed-off items when clearing is cancelled', async () => {
    await seed({ name: 'bread', crossedOff: true });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Clear crossed off' }),
    );
    expect(screen.getByText('Remove 1 crossed-off item?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Restore bread' })).toBeVisible();
    expect(await outbox()).toEqual([]);
  });

  it('updates live when the local store changes', async () => {
    await seed();
    renderPage();
    await screen.findByText(/No items yet/);

    await act(async () => {
      await saveItem(LIST, { name: 'synced', crossedOff: false });
    });

    expect(
      await screen.findByRole('button', { name: 'Cross off synced' }),
    ).toBeVisible();
  });

  it('adds a chosen suggestion to the list, queues it, and stops suggesting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await seed();
    const lastUsedAt = '2026-11-01T00:00:00.000Z';
    await db.suggestions.bulkPut([
      { name: 'ice cream', nameKey: 'ice cream', useCount: 3, lastUsedAt },
      { name: 'iced tea', nameKey: 'iced tea', useCount: 1, lastUsedAt },
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Market' });
    await user.type(addField(), 'ic');

    await user.click(await screen.findByRole('option', { name: 'ice cream' }));

    expect(
      await screen.findByRole('button', { name: 'Cross off ice cream' }),
    ).toBeVisible();
    expect(await outbox()).toMatchObject([
      {
        kind: 'putItem',
        listId: LIST,
        body: { name: 'ice cream', crossedOff: false },
      },
    ]);
    await user.type(addField(), 'ic');
    expect(
      await screen.findByRole('option', { name: 'iced tea' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('option', { name: 'ice cream' }),
    ).not.toBeInTheDocument();
  });

  it('announces the crossed-off state of an item', async () => {
    await seed({ name: 'milk' }, { name: 'bread', crossedOff: true });
    renderPage();

    const crossed = await screen.findByRole('button', {
      name: 'Restore bread',
    });
    expect(crossed).toHaveAttribute('aria-pressed', 'true');
    expect(crossed).toHaveAccessibleDescription('Crossed off');
    expect(
      screen.getByRole('button', { name: 'Cross off milk' }),
    ).toHaveAccessibleDescription('');
  });

  it('keeps the screen awake while a list is open', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    });
    await seed();

    const { unmount } = renderPage();
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    await Promise.resolve();
    unmount();

    expect(release).toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('has no axe violations', async () => {
    await seed({ name: 'milk' }, { name: 'bread', crossedOff: true });
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Restore bread' });

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });

  describe('recovery', () => {
    const seedConflict = async () => {
      await seed({ name: 'Online name' });
      const item = (await db.items.toArray())[0];
      await db.items.update(item.id, { itemRevision: 16 });
      await db.itemConflicts.put({
        mutationId: 'm1',
        listId: LIST,
        itemId: item.id,
        conflicts: [
          {
            field: 'name',
            attemptedValue: 'Offline name',
            serverValue: 'Online name',
          },
        ],
        recordedAt: '2026-01-01T00:00:00.000Z',
      });
      return item.id;
    };

    const seedBlocked = async (
      reason: 'BASE_VERSION_EXPIRED' | 'BASE_VERSION_AHEAD' | 'rejected',
      status = 409,
      details?: { path: string; message: string }[],
    ) => {
      await seed({ name: 'milk' });
      const item = (await db.items.toArray())[0];
      await db.outbox.add({
        mutation: {
          id: 'old-id',
          kind: 'updateItem',
          listId: LIST,
          itemId: item.id,
          baseItemRevision: 3,
          changes: { name: 'oat milk', crossedOff: true },
        },
        blocked: { reason, status, serverItemRevision: 9, details },
      });
      return item.id;
    };

    it('shows nothing when no change needs review', async () => {
      await seed({ name: 'milk' });
      renderPage();
      await screen.findByRole('button', { name: 'Cross off milk' });

      expect(
        screen.queryByRole('heading', { name: 'Changes to review' }),
      ).not.toBeInTheDocument();
    });

    it('shows the current and attempted values of a conflict after a reload', async () => {
      await seedConflict();
      renderPage();

      const section = await screen.findByRole('region', {
        name: 'Changes to review',
      });

      expect(section).toHaveTextContent('Current value: Online name');
      expect(section).toHaveTextContent('Your value: Offline name');
    });

    it('forgets the attempted value when the member keeps the current one', async () => {
      await seedConflict();
      const user = userEvent.setup();
      renderPage();

      await user.click(
        await screen.findByRole('button', {
          name: 'Keep current value of Online name',
        }),
      );

      await vi.waitFor(async () =>
        expect(await db.itemConflicts.count()).toBe(0),
      );
      expect(await outbox()).toEqual([]);
      await vi.waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: 'Changes to review' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('queues the attempted value as a new mutation based on the refreshed revision', async () => {
      const itemId = await seedConflict();
      const user = userEvent.setup();
      renderPage();

      await user.click(
        await screen.findByRole('button', {
          name: 'Use my value for Online name',
        }),
      );

      await vi.waitFor(async () => expect(await outbox()).toHaveLength(1));
      expect((await outbox())[0]).toMatchObject({
        kind: 'updateItem',
        itemId,
        baseItemRevision: 16,
        changes: { name: 'Offline name' },
      });
      expect(await db.itemConflicts.count()).toBe(0);
    });

    it('shows an edit blocked by an expired base with its complete patch', async () => {
      await seedBlocked('BASE_VERSION_EXPIRED');
      renderPage();

      const section = await screen.findByRole('region', {
        name: 'Changes to review',
      });

      expect(section).toHaveTextContent('too old to merge automatically');
      expect(section).toHaveTextContent('Your value: oat milk');
      expect(section).toHaveTextContent('Your value: Yes');
    });

    it('shows an edit based on a future version with its complete patch and recovery actions, keeping it queued', async () => {
      await seedBlocked('BASE_VERSION_AHEAD');
      renderPage();

      const section = await screen.findByRole('region', {
        name: 'Changes to review',
      });

      expect(section).toHaveTextContent(
        'was based on a version the server does not have',
      );
      expect(section).toHaveTextContent('Your value: oat milk');
      expect(section).toHaveTextContent('Your value: Yes');
      expect(
        within(section).getByRole('button', {
          name: 'Discard my change to milk',
        }),
      ).toBeEnabled();
      expect(
        within(section).getByRole('button', {
          name: 'Apply my change again for milk',
        }),
      ).toBeEnabled();
      for (const action of within(section).getAllByRole('button')) {
        expect(action.getAttribute('aria-label')).toMatch(
          new RegExp(`^${action.textContent}`),
        );
      }
      expect(await db.outbox.toArray()).toMatchObject([
        {
          mutation: {
            id: 'old-id',
            changes: { name: 'oat milk', crossedOff: true },
          },
          blocked: { reason: 'BASE_VERSION_AHEAD' },
        },
      ]);
    });

    it('lists the validation problems of a rejected edit and ties them to its actions', async () => {
      await seedBlocked('rejected', 400, [
        { path: 'changes.name', message: 'Must be 1 to 200 characters.' },
        { path: '', message: 'Body must be valid JSON.' },
      ]);
      renderPage();

      const problems = await screen.findByRole('list', {
        name: 'Problems with your change to milk',
      });

      expect(within(problems).getAllByRole('listitem')).toHaveLength(2);
      expect(problems).toHaveTextContent('Name: Must be 1 to 200 characters.');
      expect(problems).toHaveTextContent('Body must be valid JSON.');
      expect(
        screen.getByRole('region', { name: 'Changes to review' }),
      ).toHaveTextContent('was not valid');
      for (const name of [
        'Discard my change to milk',
        'Apply my change again for milk',
      ]) {
        expect(
          screen.getByRole('button', { name }),
        ).toHaveAccessibleDescription(/Name: Must be 1 to 200 characters\./);
      }
      expect(await outbox()).toHaveLength(1);
    });

    it('shows no problems list when the server sent no details', async () => {
      await seedBlocked('rejected', 400);
      renderPage();
      await screen.findByRole('region', { name: 'Changes to review' });

      expect(
        screen.queryByRole('list', { name: /Problems with/ }),
      ).not.toBeInTheDocument();
    });

    it.each([
      [403, 'do not have access to the list'],
      [404, 'item was not found in this list'],
      [422, 'was not accepted (error 422)'],
    ])(
      'explains a %i rejection and keeps the patch',
      async (status, message) => {
        await seedBlocked('rejected', status);
        renderPage();

        const section = await screen.findByRole('region', {
          name: 'Changes to review',
        });

        expect(section).toHaveTextContent(message);
        expect(section).toHaveTextContent('Your value: oat milk');
        expect(await outbox()).toHaveLength(1);
      },
    );

    it('discards a blocked edit only when the member asks', async () => {
      await seedBlocked('BASE_VERSION_EXPIRED');
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('region', { name: 'Changes to review' });
      expect(await outbox()).toHaveLength(1);

      await user.click(
        screen.getByRole('button', { name: 'Discard my change to milk' }),
      );

      await vi.waitFor(async () => expect(await outbox()).toEqual([]));
    });

    it('resubmits a blocked edit as a new mutation on the server revision', async () => {
      await seedBlocked('rejected');
      const user = userEvent.setup();
      renderPage();

      await user.click(
        await screen.findByRole('button', {
          name: 'Apply my change again for milk',
        }),
      );

      await vi.waitFor(async () =>
        expect((await db.outbox.toArray())[0]).not.toHaveProperty('blocked'),
      );
      const [entry] = await db.outbox.toArray();
      expect(entry.mutation).toMatchObject({
        baseItemRevision: 9,
        changes: { name: 'oat milk', crossedOff: true },
      });
      expect(entry.mutation.id).not.toBe('old-id');
    });

    it('moves focus to the heading once an entry is resolved', async () => {
      await seedConflict();
      const user = userEvent.setup();
      renderPage();

      await user.click(
        await screen.findByRole('button', {
          name: 'Keep current value of Online name',
        }),
      );

      await vi.waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Market' })).toHaveFocus(),
      );
    });

    it('has no axe violations while changes need review', async () => {
      await seedConflict();
      await db.outbox.add({
        mutation: {
          id: 'y',
          kind: 'updateItem',
          listId: LIST,
          itemId: 'other-2',
          baseItemRevision: 1,
          changes: { name: 'x' },
        },
        blocked: {
          reason: 'rejected',
          status: 400,
          details: [{ path: 'changes.name', message: 'Bad.' }],
        },
      });
      await db.outbox.add({
        mutation: {
          id: 'x',
          kind: 'updateItem',
          listId: LIST,
          itemId: 'other',
          baseItemRevision: 1,
          changes: { crossedOff: true },
        },
        blocked: { reason: 'BASE_VERSION_AHEAD', status: 409 },
      });
      const { container } = renderPage();
      await screen.findByRole('region', { name: 'Changes to review' });

      const results = await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      });

      expect(results.violations).toEqual([]);
    });
  });
});
