import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function stubServiceWorker() {
  const register = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register },
    configurable: true,
  });
  return register;
}

/** Runs registerServiceWorker and returns the `load` handler it installed, if any. */
function installLoadHandler(): (() => void) | undefined {
  const add = vi.spyOn(window, 'addEventListener');
  registerServiceWorker();
  const call = add.mock.calls.find(([type]) => type === 'load');
  return call?.[1] as (() => void) | undefined;
}

describe('registerServiceWorker', () => {
  it('registers /sw.js on load in production', () => {
    vi.stubEnv('PROD', true);
    const register = stubServiceWorker();
    const onLoad = installLoadHandler();
    expect(register).not.toHaveBeenCalled();
    onLoad?.();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('does nothing outside production', () => {
    vi.stubEnv('PROD', false);
    const register = stubServiceWorker();
    expect(installLoadHandler()).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when registration fails', async () => {
    vi.stubEnv('PROD', true);
    stubServiceWorker().mockRejectedValue(new Error('nope'));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    installLoadHandler()?.();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });
});
