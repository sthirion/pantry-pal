import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListItem } from '@pantry-pal/shared';
import { AddItemForm } from './AddItemForm';
import { clearAllStores, db } from '../services/db';

const NOW = '2026-11-01T00:00:00.000Z';

const listItem = (
  name: string,
  overrides: Partial<ListItem> = {},
): ListItem => ({
  id: `id-${name}`,
  listId: 'list-1',
  name,
  crossedOffAt: null,
  version: 1,
  itemRevision: 1,
  updatedAt: NOW,
  deletedAt: null,
  ...overrides,
});

const seed = (...rows: [name: string, useCount: number][]) =>
  db.suggestions.bulkPut(
    rows.map(([name, useCount]) => ({
      name,
      useCount,
      lastUsedAt: NOW,
      nameKey: name.toLowerCase(),
    })),
  );

const onAdd = vi.fn();
const onRestore = vi.fn();
const onHighlight = vi.fn();

const renderForm = (items: ListItem[] = []) =>
  render(
    <AddItemForm
      items={items}
      onAdd={onAdd}
      onRestore={onRestore}
      onHighlight={onHighlight}
    />,
  );

const field = () => screen.getByRole('combobox', { name: 'Add an item' });
const optionNames = () =>
  screen.queryAllByRole('option').map((option) => option.textContent);
const selectedOptions = () =>
  screen
    .queryAllByRole('option')
    .filter((option) => option.getAttribute('aria-selected') === 'true')
    .map((option) => option.textContent);

beforeEach(async () => {
  onAdd.mockReset().mockResolvedValue(undefined);
  onRestore.mockReset().mockResolvedValue(undefined);
  onHighlight.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await clearAllStores();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddItemForm suggestions', () => {
  it('shows names that start a word with the typed text and leaves out the rest', async () => {
    await seed(['ice cream', 5], ['iced tea', 3], ['rice', 9]);
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'ic');

    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(optionNames()).toEqual(['ice cream', 'iced tea']);
  });

  it('matches the start of a later word', async () => {
    await seed(['ice cream', 5], ['rice', 9]);
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'cre');

    expect(
      await screen.findByRole('option', { name: 'ice cream' }),
    ).toBeVisible();
    expect(optionNames()).toEqual(['ice cream']);
  });

  it('shows at most 8 suggestions, highest use count first', async () => {
    await seed(
      ...Array.from({ length: 10 }, (_, i): [string, number] => [
        `ch${i + 1}`,
        i + 1,
      ]),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'ch');

    expect(await screen.findAllByRole('option')).toHaveLength(8);
    expect(optionNames()[0]).toBe('ch10');
    expect(optionNames()[7]).toBe('ch3');
  });

  it('does not suggest an item that is already active on the list', async () => {
    await seed(['ice cream', 5], ['iced tea', 3]);
    const user = userEvent.setup();
    renderForm([listItem('Ice Cream')]);

    await user.type(field(), 'ice');

    expect(
      await screen.findByRole('option', { name: 'iced tea' }),
    ).toBeVisible();
    expect(optionNames()).toEqual(['iced tea']);
  });

  it('shows no suggestions for blank text', async () => {
    await seed(['ice cream', 5]);
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), '   ');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('suggests a name added offline that the cache does not have', async () => {
    await db.items.put(
      listItem('Oat milk', { id: 'offline', listId: 'other' }),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'oat');

    expect(
      await screen.findByRole('option', { name: 'Oat milk' }),
    ).toBeVisible();
  });

  it('shows the server suggestions and keeps them cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            suggestions: [{ name: 'Tea bags', useCount: 2, lastUsedAt: NOW }],
          }),
          { status: 200 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'tea');

    expect(
      await screen.findByRole('option', { name: 'Tea bags' }),
    ).toBeVisible();
    expect((await db.suggestions.toArray()).map((s) => s.name)).toEqual([
      'Tea bags',
    ]);
  });
});

describe('AddItemForm choosing a suggestion', () => {
  it('adds the item when the suggestion is tapped, then empties and refocuses the field', async () => {
    await seed(['ice cream', 5]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');

    await user.click(await screen.findByRole('option', { name: 'ice cream' }));

    await waitFor(() => expect(field()).toHaveValue(''));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('ice cream');
    expect(field()).toHaveFocus();
  });

  it('adds the highlighted suggestion when Enter is pressed', async () => {
    await seed(['ice cream', 5], ['iced tea', 3]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');
    await screen.findAllByRole('option');

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith('iced tea');
    await waitFor(() => expect(field()).toHaveValue(''));
  });

  it('adds the typed text on Enter when no suggestion is highlighted', async () => {
    await seed(['ice cream', 5]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ice');
    await screen.findByRole('option', { name: 'ice cream' });

    await user.keyboard('{Enter}');

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith('ice');
  });

  it('restores a crossed-off item instead of adding a duplicate', async () => {
    await seed(['milk', 5]);
    const crossedOff = listItem('Milk', {
      crossedOffAt: '2026-11-02T00:00:00.000Z',
    });
    const user = userEvent.setup();
    renderForm([crossedOff]);
    await user.type(field(), 'mi');

    await user.click(await screen.findByRole('option', { name: 'milk' }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(crossedOff));
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('AddItemForm keyboard and combobox semantics', () => {
  it('is a labelled, collapsed combobox before anything is typed', () => {
    renderForm();

    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAttribute('aria-autocomplete', 'list');
    expect(field()).not.toHaveAttribute('aria-controls');
    expect(field()).not.toHaveAttribute('aria-activedescendant');
  });

  it('exposes a named listbox, its options, and the active option to assistive technology', async () => {
    await seed(['ice cream', 5], ['iced tea', 3]);
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'ic');

    const listbox = await screen.findByRole('listbox', { name: 'Suggestions' });
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', listbox.id);
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 suggestions available',
    );

    await user.keyboard('{ArrowDown}');
    const first = screen.getByRole('option', { name: 'ice cream' });
    expect(field()).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'iced tea' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('moves the highlight with the arrow keys and wraps at both ends', async () => {
    await seed(['ice cream', 5], ['iced tea', 3]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');
    await screen.findAllByRole('option');

    await user.keyboard('{ArrowUp}');
    expect(selectedOptions()).toEqual(['iced tea']);
    await user.keyboard('{ArrowDown}');
    expect(selectedOptions()).toEqual(['ice cream']);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selectedOptions()).toEqual(['ice cream']);
  });

  it('moves the highlight up one option at a time and wraps from the first option to the last', async () => {
    await seed(['ice cream', 5], ['iced tea', 3], ['ice cubes', 1]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(selectedOptions()).toEqual(['ice cubes']);

    await user.keyboard('{ArrowUp}');
    expect(selectedOptions()).toEqual(['iced tea']);
    await user.keyboard('{ArrowUp}');
    expect(selectedOptions()).toEqual(['ice cream']);
    await user.keyboard('{ArrowUp}');
    expect(selectedOptions()).toEqual(['ice cubes']);
  });

  it('clears the highlight when typing continues, so Enter adds the typed text', async () => {
    await seed(['ice cream', 5]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');
    await screen.findByRole('option', { name: 'ice cream' });
    await user.keyboard('{ArrowDown}');
    expect(selectedOptions()).toEqual(['ice cream']);

    await user.type(field(), 'e');

    expect(selectedOptions()).toEqual([]);
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith('ice');
  });

  it('closes on Escape without clearing the text, and reopens when typing continues', async () => {
    await seed(['ice cream', 5]);
    const user = userEvent.setup();
    renderForm();
    await user.type(field(), 'ic');
    await screen.findByRole('listbox');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveValue('ic');

    await user.type(field(), 'e');

    expect(await screen.findByRole('listbox')).toBeVisible();
  });
});
