import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import * as localData from './services/localData';

const ME = {
  user: { id: 'u1', name: 'Sam', email: 'sam@example.com' },
  household: { id: 'h1', name: 'The Smiths' },
};

interface Server {
  signedIn: boolean;
  meStatus?: number;
  signInStatus: number;
  signOutStatus: number;
}

let server: Server;

function json(status: number, body: unknown = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const path = String(input);
  const method = init?.method ?? 'GET';
  if (path === '/api/me') {
    if (server.meStatus) return json(server.meStatus);
    return server.signedIn ? json(200, ME) : json(401);
  }
  if (path === '/api/auth/sign-in/email' && method === 'POST') {
    if (server.signInStatus === 200) server.signedIn = true;
    return json(server.signInStatus);
  }
  if (path === '/api/auth/sign-out' && method === 'POST') {
    if (server.signOutStatus === 200) server.signedIn = false;
    return json(server.signOutStatus);
  }
  return json(404);
}

function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'sam@example.com');
  await user.type(screen.getByLabelText('Password'), 'secret');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  server = { signedIn: false, signInStatus: 200, signOutStatus: 200 };
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('routing and session guard', () => {
  it('shows a loading state while the session is checked', () => {
    renderApp('/lists');
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it.each(['/lists', '/', '/anything-else'])(
    'sends a signed-out visitor from %s to the sign-in screen',
    async (path) => {
      renderApp(path);
      expect(
        await screen.findByRole('heading', { name: 'Sign in' }),
      ).toBeInTheDocument();
    },
  );

  it('shows the lists screen to a signed-in user, also from /', async () => {
    server.signedIn = true;
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Lists' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as Sam (The Smiths).')).toBeVisible();
  });

  it('shows a not-found page inside the shell for unknown paths when signed in', async () => {
    server.signedIn = true;
    renderApp('/nope');
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to lists' })).toHaveAttribute(
      'href',
      '/lists',
    );
  });

  it('does not redirect when the session check fails with a non-401 error, and can retry', async () => {
    server.meStatus = 500;
    const user = renderApp('/lists');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not check your sign-in status',
    );
    expect(
      screen.queryByRole('heading', { name: 'Sign in' }),
    ).not.toBeInTheDocument();

    server.meStatus = undefined;
    server.signedIn = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Lists' }),
    ).toBeInTheDocument();
  });
});

describe('sign in', () => {
  it('lands on the lists screen with valid credentials', async () => {
    const user = renderApp('/sign-in');
    await signIn(user);
    expect(
      await screen.findByRole('heading', { name: 'Lists' }),
    ).toBeInTheDocument();
  });

  it('labels the form fields and marks them required', async () => {
    renderApp('/sign-in');
    expect(await screen.findByLabelText('Email')).toBeRequired();
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it.each([
    [401, 'Email or password is incorrect'],
    [429, 'Too many attempts, try again in a minute'],
    [503, 'Something went wrong. Please try again.'],
  ])('shows the right message for status %i', async (status, message) => {
    server.signInStatus = status;
    const user = renderApp('/sign-in');
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(
      screen.queryByRole('heading', { name: 'Lists' }),
    ).not.toBeInTheDocument();
  });

  it('disables the button and shows progress while signing in', async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const user = renderApp('/sign-in');
    await signIn(user);
    expect(
      await screen.findByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    release(new Response('{}', { status: 401 }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  });
});

describe('sign out', () => {
  it('clears local data and returns to the sign-in screen', async () => {
    server.signedIn = true;
    const clear = vi.spyOn(localData, 'clearLocalData').mockResolvedValue();
    const user = renderApp('/lists');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('stays on the lists screen with an error when clearing local data fails', async () => {
    server.signedIn = true;
    vi.spyOn(localData, 'clearLocalData').mockRejectedValue(new Error('boom'));
    const user = renderApp('/lists');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Local data was not cleared',
    );
    expect(screen.getByRole('heading', { name: 'Lists' })).toBeInTheDocument();
  });

  it('does not clear local data when the server sign-out fails', async () => {
    server.signedIn = true;
    server.signOutStatus = 500;
    const clear = vi.spyOn(localData, 'clearLocalData').mockResolvedValue();
    const user = renderApp('/lists');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Lists' })).toBeInTheDocument();
  });
});
