import { defineConfig, devices } from '@playwright/test';

const port = 5199;
const origin = `http://127.0.0.1:${port}`;

// `server/start.mjs` starts the real API on a temporary SQLite database with seeded personas and
// serves the built frontend (run `npm run build` first). Specs that use src/fixtures.ts still mock
// `/api` in the browser; the journey specs (src/journeys.ts) talk to the real API.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
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
    env: { E2E_ORIGIN: origin },
    url: `${origin}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
