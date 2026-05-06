/**
 * drizzle.config.ts — Drizzle Kit configuration (repo root)
 *
 * Used by: bun run db:generate (generate migrations from schema)
 *          bun run db:migrate  (apply migrations via custom script)
 *
 * NOTE: db:migrate does NOT use Drizzle Kit's push/migrate command directly —
 * it runs apps/wiki-team/storage/db-migrate-runner.ts which applies
 * 0000-init-extensions.sql first, then the numbered up.sql files in order.
 * This is required because Drizzle Kit does not emit CREATE EXTENSION statements.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/wiki-schema/src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://wiki:devonly@localhost:5432/wiki_team_dev',
  },
  // Drizzle Kit verbose output for CI diff visibility
  verbose: true,
  strict: true,
});
