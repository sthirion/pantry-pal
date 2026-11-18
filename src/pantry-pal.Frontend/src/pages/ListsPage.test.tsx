import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsPage } from './ListsPage';
import { clearAllStores, db } from '../services/db';
import { saveItem, saveList } from '../services/mutations';

vi.mock('../services/sync-engine', () => ({
  syncEngine: { flush: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../hooks/useSession', () => ({
  useSession: () => ({
    status: 'signedIn',
    me: {
      user: { id: 'u1', name: 'Sam', email: 's@example.com' },
      household: { id: 'h1', name: 'The Smiths' },
    },
  }),
}));

beforeEach(async () => {
  await clearAllStores();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ListsPage />
    </MemoryRouter>,
  );

const seed = async (...names: string[]) => {
  for (const name of names) await saveList(name, `id-${name}`);
  await db.outbox.clear();
};

const outbox = async () => (await db.outbox.toArray()).map((e) => e.mutation);

describe('ListsPage', () => {
  it('shows an empty state that invites creating a list', async () => {
    renderPage();

    expect(await screen.findByText(/No lists yet/)).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('orders lists case-insensitively and counts items not crossed off', async () => {
    await seed('pharmacy', 'Garden Center', 'Market');
    await saveItem('id-Market', { name: 'milk', crossedOff: false });
    await saveItem('id-Market', { name: 'eggs', crossedOff: false });
    await saveItem('id-Market', { name: 'bread', crossedOff: true });
    renderPage();

    const rows = await screen.findAllByRole('listitem');

    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual([
      'Garden Center0 items left',
      'Market2 items left',
      'pharmacy0 items left',
    ]);
  });

  it('uses the singular for one remaining item and ignores deleted items', async () => {
    await seed('Market');
    const kept = await saveItem('id-Market', {
      name: 'milk',
      crossedOff: false,
    });
    expect(kept).toBeTruthy();
    const gone = await saveItem('id-Market', {
      name: 'eggs',
      crossedOff: false,
    });
    await db.items.update(gone, { deletedAt: new Date().toISOString() });
    renderPage();

    expect(await screen.findByText('1 item left')).toBeVisible();
  });

  it('links each list to its list screen', async () => {
    await seed('Market');
    renderPage();

    expect(await screen.findByRole('link', { name: /Market/ })).toHaveAttribute(
      'href',
      '/lists/id-Market',
    );
  });

  it('creates a list at once, queues it, and clears the field', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No lists yet/);

    await user.type(
      screen.getByLabelText('New list name'),
      '  Hardware   Store ',
    );
    await user.click(screen.getByRole('button', { name: 'Create list' }));

    expect(
      await screen.findByRole('link', { name: /Hardware Store/ }),
    ).toBeVisible();
    expect(screen.getByLabelText('New list name')).toHaveValue('');
    expect(await outbox()).toMatchObject([
      { kind: 'putList', body: { name: 'Hardware Store' } },
    ]);
  });

  it.each([
    ['an empty name', '   ', 'Enter a list name.'],
    ['a name over 100 characters', 'a'.repeat(101), 'at most 100 characters'],
    [
      'a duplicate ignoring case and spacing',
      '  market ',
      'already have a list',
    ],
  ])(
    'shows an inline error and creates nothing for %s',
    async (_c, text, message) => {
      await seed('Market');
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('link', { name: /Market/ });

      await user.type(screen.getByLabelText('New list name'), text);
      await user.click(screen.getByRole('button', { name: 'Create list' }));

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.getByLabelText('New list name')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(await db.lists.count()).toBe(1);
      expect(await outbox()).toEqual([]);
    },
  );

  it('accepts a 100-character name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No lists yet/);

    await user.type(screen.getByLabelText('New list name'), 'a'.repeat(100));
    await user.click(screen.getByRole('button', { name: 'Create list' }));

    expect(await db.lists.count()).toBe(1);
  });

  it('renames a list and re-sorts it', async () => {
    await seed('Market', 'Zoo');
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Rename Market' }),
    );
    const input = screen.getByLabelText('New name for Market');
    await user.clear(input);
    await user.type(input, 'Farm');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const rows = await screen.findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Farm');
    expect(await outbox()).toMatchObject([
      { kind: 'putList', listId: 'id-Market', body: { name: 'Farm' } },
    ]);
  });

  it('allows keeping the same name when renaming but rejects another list’s name', async () => {
    await seed('Market', 'Zoo');
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Rename Market' }),
    );
    const input = screen.getByLabelText('New name for Market');
    await user.clear(input);
    await user.type(input, 'ZOO');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already have a list');

    await user.clear(input);
    await user.type(input, 'MARKET');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /MARKET/ })).toBeVisible();
  });

  it('cancels a rename without changes', async () => {
    await seed('Market');
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Rename Market' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('link', { name: /Market/ })).toBeVisible();
    expect(await outbox()).toEqual([]);
  });

  it('deletes a list only after confirming', async () => {
    await seed('Market');
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Delete Market' }),
    );
    expect(screen.getByText(/Delete "Market"/)).toBeVisible();
    expect(await db.lists.get('id-Market')).toMatchObject({ deletedAt: null });

    await user.click(screen.getByRole('button', { name: 'Delete list' }));

    expect(await screen.findByText(/No lists yet/)).toBeVisible();
    expect(await outbox()).toMatchObject([
      { kind: 'deleteList', listId: 'id-Market' },
    ]);
  });

  it('keeps the list when the delete is cancelled', async () => {
    await seed('Market');
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Delete Market' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('link', { name: /Market/ })).toBeVisible();
    expect(await outbox()).toEqual([]);
  });

  it('updates live when the local store changes', async () => {
    renderPage();
    await screen.findByText(/No lists yet/);

    await act(async () => {
      await saveList('Market', 'x');
    });

    expect(await screen.findByRole('link', { name: /Market/ })).toBeVisible();
  });

  it('shows an error when the local store cannot be read', async () => {
    const spy = vi
      .spyOn(db.lists, 'toArray')
      .mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load your lists',
    );
    spy.mockRestore();
  });
});
