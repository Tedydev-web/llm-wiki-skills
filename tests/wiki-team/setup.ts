/**
 * setup.ts — global Vitest setup for wiki-team test suite
 *
 * Runs once before the test suite starts (setupFiles in vitest.config.ts).
 * Validates required env vars, optionally initialises DB pool for integration tests.
 * Sets SKIP_DB_TESTS=1 to bypass DB setup in unit-only runs.
 */

import { afterAll, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Environment validation

const INTEGRATION_TEST = process.env['INTEGRATION_TEST'] === '1';
const SKIP_DB_TESTS = process.env['SKIP_DB_TESTS'] === '1';

if (INTEGRATION_TEST && !SKIP_DB_TESTS) {
  const requiredEnv = ['TEST_DATABASE_URL', 'TEST_REDIS_URL'];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[test-setup] Missing required env vars for integration tests: ${missing.join(', ')}\n` +
        'Set SKIP_DB_TESTS=1 to run unit tests only.',
    );
  }
}

// ---------------------------------------------------------------------------
// Global hooks

beforeAll(async () => {
  if (!INTEGRATION_TEST || SKIP_DB_TESTS) return;

  // Integration: verify DB reachability (fail fast before tests run)
  const { TEST_DATABASE_URL } = process.env;
  if (TEST_DATABASE_URL) {
    // Dynamic import — only needed for integration; avoids pulling pg into unit runs
    const { Client } = await import('pg');
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
    } catch (err) {
      throw new Error(
        `[test-setup] Cannot connect to test database at ${TEST_DATABASE_URL}: ${String(err)}`,
      );
    }
  }
});

afterAll(async () => {
  // No-op for unit runs. Integration teardown is done per-suite via afterAll in each file.
});

// ---------------------------------------------------------------------------
// Expose globals for tests (available via vitest globals: true)

// Signal whether DB tests should run (tests can check this flag)
(globalThis as Record<string, unknown>).__INTEGRATION_TEST__ = INTEGRATION_TEST;
(globalThis as Record<string, unknown>).__SKIP_DB_TESTS__ = SKIP_DB_TESTS;
