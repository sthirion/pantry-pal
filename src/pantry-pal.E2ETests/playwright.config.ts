import { defineConfig, devices } from '@playwright/test';

const port = 5199;

// The frontend dev server serves the app; every `/api` call is mocked in the specs
// (see src/fixtures.ts), so no backend or WireMock container is needed.
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev --workspace=@pantry-pal/frontend -- --port ${port} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${port}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
