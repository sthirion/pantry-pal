import { randomBytes } from 'node:crypto';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 5199;
const origin = `http://127.0.0.1:${port}`;
// The server's database file. Workers inherit it.
const dbPath = (process.env.E2E_DB_PATH ??= join(
  tmpdir(),
  `pantry-pal-e2e-${port}.db`,
));
// Loopback control endpoint of the E2E server for history only its hourly pruning creates (src/server-database.ts). Workers inherit the token.
const controlPort = (process.env.E2E_CONTROL_PORT ??= '5197');
const controlToken = (process.env.E2E_CONTROL_TOKEN ??=
  randomBytes(24).toString('hex'));
// Playwright's default (half the cores), fixed here so the server can seed one sync household per worker.
const workers = Math.max(1, Math.floor(availableParallelism() / 2));

// `server/start.mjs` starts the real API on a temporary SQLite database with seeded personas and
// serves the built frontend (run `npm run build` first). Specs that use src/fixtures.ts still mock
// `/api` in the browser; the journey specs (src/journeys.ts) talk to the real API.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'node server/start.mjs',
    cwd: '.',
    env: {
      E2E_ORIGIN: origin,
      E2E_WORKERS: String(workers),
      E2E_DB_PATH: dbPath,
      E2E_CONTROL_PORT: controlPort,
      E2E_CONTROL_TOKEN: controlToken,
    },
    url: `${origin}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
