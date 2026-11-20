import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      { kind: 'putItem', body: { name: 'milk', crossedOff: false } },
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
    expect(await outbox()).toMatchObject([
      { kind: 'putItem', body: { name: 'bread', crossedOff: true } },
    ]);

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
    expect(await outbox()).toMatchObject([
      { kind: 'putItem', body: { name: 'oat milk', crossedOff: true } },
    ]);
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
});
