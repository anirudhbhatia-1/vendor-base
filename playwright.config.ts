import { defineConfig, devices } from '@playwright/test';

/**
 * The PWA builds under test.
 *
 * Empty Supabase values are not a harmless default: with them the proxy takes
 * its "not configured" branch and redirects every route to /login, so an
 * auth-gate assertion passes without any authentication happening. Runs that
 * leave them empty are therefore explicitly marked, and the gate specs assert
 * the behaviour that matches the mode they are running in.
 */
const publicEnvironment = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
};

export const supabaseConfigured = Boolean(
  publicEnvironment.NEXT_PUBLIC_SUPABASE_URL && publicEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'customer-pwa', use: { baseURL: 'http://localhost:3100' } },
    { name: 'vendor-pwa', use: { baseURL: 'http://localhost:3101' } },
    { name: 'partner-pwa', use: { baseURL: 'http://localhost:3102' } },
    { name: 'admin-pwa', use: { baseURL: 'http://localhost:3103' } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @neighbourhood-store/customer-pwa dev',
      env: publicEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3100',
    },
    {
      command: 'pnpm --filter @neighbourhood-store/vendor-pwa dev',
      env: publicEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3101/login',
    },
    {
      command: 'pnpm --filter @neighbourhood-store/partner-pwa dev',
      env: publicEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3102/login',
    },
    {
      command: 'pnpm --filter @neighbourhood-store/admin-pwa dev',
      env: publicEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3103/login',
    },
  ],
});
