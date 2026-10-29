import { defineConfig, devices } from '@playwright/test';

const reuse = !process.env.CI;
const env = { ...process.env, ESTIMATE_ORDERS: 'allow-dev', MOCK_PROVIDER_LATENCY_MS: '300-800' } as Record<string, string>;

/**
 * End-to-end journeys (build prompt 13). Starts the API, worker, forge runtime, and web app
 * unless they are already running (`pnpm dev`).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: 'pnpm --filter @sw/api dev', url: 'http://localhost:4000/v1/health', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/worker dev', url: 'http://localhost:4100/', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/forge-runtime dev', url: 'http://localhost:3002/', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/web dev', url: 'http://localhost:3000/', reuseExistingServer: reuse, timeout: 180_000, cwd: '..', env },
  ],
});
