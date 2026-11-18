import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorScreen } from './ErrorScreen';
import { LoadingScreen } from './LoadingScreen';

describe('LoadingScreen', () => {
  it('announces loading to assistive technology and marks the region busy', () => {
    render(<LoadingScreen />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ErrorScreen', () => {
  it('announces the message as an alert', () => {
    render(<ErrorScreen message="Nope" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
  });

  it('offers no retry button without a retry handler', () => {
    render(<ErrorScreen message="Nope" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls the retry handler when the user asks to try again', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorScreen message="Nope" onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('lets a keyboard user reach and activate the retry button', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorScreen message="Nope" onRetry={onRetry} />);

    await user.tab();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
