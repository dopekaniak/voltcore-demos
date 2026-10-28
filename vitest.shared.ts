import { defineConfig } from 'vitest/config';

/** Shared Vitest settings; each package's vitest.config.ts re-exports this. */
export default defineConfig({
  test: {
    setupFiles: [new URL('./packages/config/src/vitest-setup.ts', import.meta.url).pathname],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
