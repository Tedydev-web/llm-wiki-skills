/**
 * vitest.integration.config.ts — integration-only Vitest config
 *
 * Use with: bun run test:wiki-team:integration
 * Requires: docker-compose postgres + redis + minio up (TEST_DATABASE_URL set).
 * Higher timeout for DB-backed tests.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/wiki-team/setup.ts'],
    include: [
      'tests/wiki-team/integration/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.sh',
    ],
    testTimeout: 60_000,
    // Run integration tests serially to avoid DB state collisions
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
