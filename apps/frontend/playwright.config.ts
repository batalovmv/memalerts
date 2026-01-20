import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const isCI = !!process.env.CI;
const isLocalE2E = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'overlay/e2e/**/*.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: isLocalE2E
    ? [
        {
          command: 'pnpm dev:web --host 127.0.0.1 --port 5173 --strictPort',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'pnpm dev:overlay --host 127.0.0.1 --port 5174 --strictPort',
          url: 'http://localhost:5174',
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'guest',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'logged-in',
      testIgnore: ['overlay/e2e/**', 'e2e/public-channel.guest.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/storageState.json',
      },
    },
  ],
});


