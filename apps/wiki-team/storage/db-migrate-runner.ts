/**
 * db-migrate-runner.ts — custom migration runner for wiki-team
 *
 * Applies SQL migration files in order:
 *   1. drizzle/0000-init-extensions.sql  (always first — CREATE EXTENSION)
 *   2. drizzle/0001-init-core.up.sql
 *   3. drizzle/0002-init-content.up.sql
 *   4. drizzle/0003-init-rbac-jobs.up.sql
 *
 * Why custom runner (not `drizzle-kit migrate`)?
 *   Drizzle Kit does not emit CREATE EXTENSION statements. The 0000 file must
 *   run before any migration that uses the vector type.
 *
 * Usage:
 *   bun run db:migrate          → apply all up migrations
 *   bun run db:migrate --reset  → rollback all (runs down.sql in reverse), then re-apply up
 *
 * Called by: root package.json scripts db:migrate and db:reset
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://wiki:devonly@localhost:5432/wiki_team_dev';

// Paths relative to repo root (this script is run from repo root via bun)
const REPO_ROOT = resolve(import.meta.dir, '../../../');

const EXTENSIONS_FILE = resolve(REPO_ROOT, 'drizzle/0000-init-extensions.sql');

const UP_FILES = [
  resolve(REPO_ROOT, 'drizzle/0001-init-core.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0002-init-content.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0003-init-rbac-jobs.up.sql'),
];

const DOWN_FILES = [
  resolve(REPO_ROOT, 'drizzle/0003-init-rbac-jobs.down.sql'),
  resolve(REPO_ROOT, 'drizzle/0002-init-content.down.sql'),
  resolve(REPO_ROOT, 'drizzle/0001-init-core.down.sql'),
];

// ---------------------------------------------------------------------------
// Helpers

function readSql(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function log(msg: string): void {
  console.log(`[db:migrate] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  const isReset = process.argv.includes('--reset');
  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    if (isReset) {
      log('Running RESET: applying down migrations in reverse order...');
      for (const filePath of DOWN_FILES) {
        const fileName = filePath.split('/').pop()!;
        log(`  ↓ ${fileName}`);
        await sql.unsafe(readSql(filePath));
      }
      log('Reset complete. Re-applying up migrations...');
    }

    // Always apply extensions first
    log(`  → 0000-init-extensions.sql`);
    await sql.unsafe(readSql(EXTENSIONS_FILE));

    for (const filePath of UP_FILES) {
      const fileName = filePath.split('/').pop()!;
      log(`  ↑ ${fileName}`);
      await sql.unsafe(readSql(filePath));
    }

    log('All migrations applied successfully.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[db:migrate] FATAL:', err);
  process.exit(1);
});
