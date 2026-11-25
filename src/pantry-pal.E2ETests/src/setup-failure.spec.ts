import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const startScript = fileURLToPath(
  new URL('../server/start.mjs', import.meta.url),
);

/** Runs the E2E server script with a build directory that does not exist. */
function startWithMissingBuild(override: 'E2E_API_DIST' | 'E2E_FRONTEND_DIST') {
  return spawnSync(process.execPath, [startScript], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      // A port the real E2E server does not use, so a wrongly started server cannot clash with it.
      E2E_ORIGIN: 'http://127.0.0.1:5198',
      [override]: join(tmpdir(), 'pantry-pal-e2e-no-such-build'),
    },
  });
}

test.describe('E2E server setup failure @TEST', () => {
  // A Node child process only: no browser is involved, so it runs once, on the chromium project.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'no browser involved',
  );

  test('a missing API build stops the setup with a clear message', () => {
    // Given
    const override = 'E2E_API_DIST';

    // When
    const result = startWithMissingBuild(override);

    // Then
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'E2E server setup failed: the API is not built. Run "npm run build" first.',
    );
    expect(result.stdout).not.toContain('listening');
  });

  test('a missing frontend build stops the setup with a clear message', () => {
    // Given
    const override = 'E2E_FRONTEND_DIST';

    // When
    const result = startWithMissingBuild(override);

    // Then
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'E2E server setup failed: the frontend is not built. Run "npm run build" first.',
    );
    expect(result.stdout).not.toContain('listening');
  });
});
