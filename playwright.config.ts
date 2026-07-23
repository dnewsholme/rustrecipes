import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: process.env.CI ? 30000 : 30000,
  expect: {
    timeout: process.env.CI ? 10000 : 10000
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: process.env.CI ? 30000 : 15000,
    actionTimeout: process.env.CI ? 15000 : 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Skip Firefox/Webkit in CI to save time, unless specifically needed */
    ...(!process.env.CI ? [
      {
        name: 'firefox',
        use: { ...devices['Desktop Firefox'] },
      },
      {
        name: 'webkit',
        use: { ...devices['Desktop Safari'] },
      },
    ] : []),

    /* Test against mobile viewports in both environments */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 9'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: (process.env.CI || process.env.USE_BINARY) ? (process.env.BINARY_PATH || './target/debug/recipemanager') : 'cargo run --bin recipemanager',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
    env: {
      COOKIE_SECURE: 'false',
    },
  },
});
