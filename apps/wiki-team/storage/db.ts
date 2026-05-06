/**
 * db.ts — Drizzle + postgres-js client factory
 *
 * Reads DATABASE_URL from environment. Validates at boot — never silently
 * connects to a wrong DB. Called once at app startup; singleton pattern.
 *
 * Usage:
 *   import { db } from './storage/db.js';
 *   const rows = await db.select().from(notes).where(...);
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@wiki-team/schema/db';

// ---------------------------------------------------------------------------
// assertEnv — reject placeholder values that signal unconfigured deployment

function assertEnv(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`[db] Required env var ${key} is missing or empty.`);
  }
  if (value.includes('CHANGE_ME_BEFORE_BOOT')) {
    throw new Error(
      `[db] Env var ${key} still contains placeholder "CHANGE_ME_BEFORE_BOOT". ` +
      'Set a real value before starting the server.',
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Singleton DB instance

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns the singleton Drizzle client, initialising it on first call.
 * Throws if DATABASE_URL is not set or contains placeholder value.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db;

  const url = assertEnv('DATABASE_URL', process.env['DATABASE_URL']);

  _sql = postgres(url, {
    max: 10,                 // connection pool size
    idle_timeout: 30,        // seconds before idle connection closed
    connect_timeout: 10,     // seconds before connection attempt times out
  });

  _db = drizzle(_sql, { schema });
  return _db;
}

/**
 * Close all connections — call during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}

// Re-export schema tables for convenient co-import
export { schema };

// Re-export Drizzle sql helper (used by P05 ARRAY && escape hatch)
export { sql } from 'drizzle-orm';
