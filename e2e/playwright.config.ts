import { defineConfig, devices } from '@playwright/test';

const reuse = !process.env.CI;
const env = { ...process.env, ESTIMATE_ORDERS: 'allow-dev', MOCK_PROVIDER_LATENCY_MS: '300-800', GEN_SERVER_URL: 'http://localhost:8100', GEN_SERVER_TOKEN: 'dev-gen-server-token', COMMUNITY_REVIEW: 'auto' } as Record<string, string>;
const genEnv = { ...env, GEN_ENGINE: 'test', GEN_TEST_DELAY_S: '1', GEN_ALLOWED_IMAGE_HOSTS: 'localhost', GEN_DATA_DIR: '../../var/gen' } as Record<string, string>;

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
    { command: 'test -x .venv/bin/uvicorn || (python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt); .venv/bin/uvicorn app.main:app --port 8100', url: 'http://localhost:8100/health', reuseExistingServer: reuse, timeout: 300_000, cwd: '../apps/gen-server', env: genEnv },
    { command: 'pnpm --filter @sw/api dev', url: 'http://localhost:4000/v1/health', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/worker dev', url: 'http://localhost:4100/', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/forge-runtime dev', url: 'http://localhost:3002/', reuseExistingServer: reuse, timeout: 120_000, cwd: '..', env },
    { command: 'pnpm --filter @sw/web dev', url: 'http://localhost:3000/', reuseExistingServer: reuse, timeout: 180_000, cwd: '..', env },
  ],
});
