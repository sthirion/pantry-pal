import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

function Screen() {
  useWakeLock();
  return null;
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const installWakeLock = () => {
  const release = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue({ release });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
  return { request, release };
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
  setVisibility('visible');
});

describe('useWakeLock', () => {
  it('requests a screen wake lock when the screen opens', async () => {
    const { request } = installWakeLock();

    render(<Screen />);

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
  });

  it('releases the lock when the screen is left', async () => {
    const { request, release } = installWakeLock();
    const { unmount } = render(<Screen />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    unmount();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('requests the lock again when the app becomes visible', async () => {
    const { request } = installWakeLock();
    render(<Screen />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    setVisibility('hidden');
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('releases a lock that arrives after the screen was left', async () => {
    const { request, release } = installWakeLock();
    const { unmount } = render(<Screen />);
    unmount();

    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does nothing in a browser without Wake Lock', () => {
    expect(() => render(<Screen />).unmount()).not.toThrow();
  });

  it('carries on when the browser refuses the lock', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    });

    const { unmount } = render(<Screen />);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());

    expect(() => unmount()).not.toThrow();
  });
});
