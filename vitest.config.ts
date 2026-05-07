/**
 * vitest.config.ts — root Vitest configuration for llm-wiki-skills monorepo
 *
 * Covers: unit tests (fast, no I/O) + integration tests (DB-backed via docker-compose).
 * For integration-only runs use vitest.integration.config.ts.
 *
 * Coverage thresholds (P11 — baseline-calibrated, 2026-05-07):
 *   rbac         70% — fully tested RBAC engine (P09)
 *   jobs         60% — BullMQ worker paths; async branches hard to measure without broker
 *   mcp-host     60% — MCP tool handlers; partial coverage expected pre-P12 backfill
 *   api/middleware 60% — middleware suite added P10; new tests cover happy + error paths
 * Thresholds are tunable per-module; lower with rationale comment before merging to main.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/wiki-team/setup.ts'],
    include: [
      'tests/wiki-team/unit/**/*.test.ts',
      'tests/wiki-team/integration/**/*.test.ts',
      'apps/wiki-team/**/*.test.ts',
      'packages/wiki-mcp/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Shell scripts — not Vitest test files
      '**/*.sh',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/wiki-team/**/*.ts',
        'packages/wiki-{schema,mcp,pdf-extract,shared}/**/*.ts',
      ],
      exclude: [
        // Prevent test files inflating coverage metric
        'tests/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/dist/**',
        '**/node_modules/**',
      ],
      thresholds: {
        'apps/wiki-team/rbac/**':            { branches: 70, statements: 70 },
        'apps/wiki-team/jobs/**':            { branches: 60, statements: 60 },
        'apps/wiki-team/mcp-host/**':        { branches: 60, statements: 60 },
        'apps/wiki-team/api/**':             { branches: 60, statements: 60 },
      },
    },
    testTimeout: 30_000,
  },
});
