import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncStatus } from './SyncStatus';
import { clearAllStores, db } from '../services/db';
import { saveList } from '../services/mutations';
import {
  reportDropped,
  requireAuth,
  resetNotices,
} from '../services/syncNotices';

beforeEach(async () => {
  await clearAllStores();
  resetNotices();
});
afterEach(() => resetNotices());

const renderStatus = () =>
  render(
    <MemoryRouter>
      <SyncStatus />
    </MemoryRouter>,
  );

describe('SyncStatus', () => {
  it('shows nothing alarming when online with an empty queue', () => {
    renderStatus();

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tells the user when they are offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    renderStatus();

    expect(screen.getByRole('status')).toHaveTextContent('You are offline');
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('status')).not.toHaveTextContent('offline');
  });

  it('shows how many changes are waiting to sync', async () => {
    renderStatus();

    await act(async () => {
      await saveList('Milk', 'l1');
    });

    expect(await screen.findByText('1 change waiting to sync')).toBeVisible();
  });

  it('tells the user how many changes need review', async () => {
    await db.itemConflicts.put({
      mutationId: 'm1',
      listId: 'l1',
      itemId: 'i1',
      conflicts: [
        { field: 'name', attemptedValue: 'Mine', serverValue: 'Theirs' },
      ],
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
    renderStatus();

    expect(await screen.findByText(/1 change needs your review/)).toBeVisible();
  });

  it('asks the user to sign in after a 401 and links to the sign-in screen', () => {
    renderStatus();

    act(() => requireAuth());

    expect(screen.getByRole('alert')).toHaveTextContent('session has expired');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('reports a dropped change and lets the user dismiss it', async () => {
    const user = userEvent.setup();
    renderStatus();

    act(() => reportDropped(409));
    expect(screen.getByRole('alert')).toHaveTextContent('error 409');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
