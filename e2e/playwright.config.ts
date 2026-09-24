import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { API_PORT, API_URL, WEB_PORT, WEB_URL } from './support/env.ts'

const root = path.resolve(import.meta.dirname, '..')

/**
 * Gene Board end-to-end suite. Always runs against its own stack, never a developer's:
 *  - API on :8491 serving the database geneboard_e2e, which is dropped, migrated and seeded
 *    at every start (scripts/start-api.mjs),
 *  - Vite dev server on :5174 proxying /api (REST + websocket) to that API.
 *
 * Projects: `visual` takes the screenshots in screenshots/ on the pristine seed, then `e2e`
 * runs the user flows. Tests create their own uniquely named users/projects, so they can run
 * in parallel and re-run against the same database.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  retries: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './support/global-setup.ts',
  globalTeardown: './support/global-teardown.ts',
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    colorScheme: 'light',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'visual',
      testMatch: /visual\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'e2e',
      testMatch: /flows\/.*\.spec\.ts/,
      dependencies: ['visual'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node scripts/start-api.mjs',
      cwd: import.meta.dirname,
      url: `${API_URL}/api/health`,
      env: {
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_ORIGIN: WEB_URL,
      },
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      name: 'web',
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: path.join(root, 'frontend'),
      url: WEB_URL,
      env: {
        GB_API_URL: API_URL,
        GB_VITE_CACHE_DIR: 'node_modules/.vite-e2e',
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
})
