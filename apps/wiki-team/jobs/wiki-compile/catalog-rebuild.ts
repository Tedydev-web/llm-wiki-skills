/**
 * catalog-rebuild.ts — __catalog sentinel page rebuild under Redis SETNX mutex
 *
 * Extracted from job-handler.ts to keep that file under 200 LOC.
 *
 * rebuildCatalog — anti-trace rename per phase-06 map.
 * __catalog mutex — Redis SETNX per workspaceId; concurrent jobs skip rebuild.
 *
 * Design:
 *   - Only one worker rebuilds __catalog per workspaceId at a time
 *   - Mutex TTL = 30s (longer than longest expected rebuild)
 *   - On mutex miss: log and skip — the winner's catalog covers all upserts
 *     from the same batch since agent upserts are committed before rebuild
 */

import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { getDb, schema } from '../../storage/db.js';
import { SENTINEL_CATALOG } from './slug-rules.js';

// ---------------------------------------------------------------------------
// Constants

const CATALOG_MUTEX_TTL_SECONDS = 30;
const CATALOG_MUTEX_KEY_PREFIX = 'catalog-rebuild';

// ---------------------------------------------------------------------------
// rebuildCatalogWithMutex — public entry point (called by job-handler)

/**
 * Rebuild the __catalog sentinel page under a Redis SETNX mutex.
 * Concurrent callers for the same workspaceId skip rebuild (mutex already held).
 */
export async function rebuildCatalogWithMutex(
  workspaceId: string,
  kbId: string,
  redis: Redis,
): Promise<void> {
  const mutexKey = `${CATALOG_MUTEX_KEY_PREFIX}:${workspaceId}`;
  const acquired = await redis.set(mutexKey, '1', 'EX', CATALOG_MUTEX_TTL_SECONDS, 'NX');

  if (!acquired) {
    console.info(`[catalog-rebuild] mutex held for workspace ${workspaceId} — skipping`);
    return;
  }

  try {
    await rebuildCatalog(workspaceId, kbId);
  } finally {
    await redis.del(mutexKey);
  }
}

// ---------------------------------------------------------------------------
// rebuildCatalog — inner rebuild (anti-trace rename per phase-06 map)

/**
 * Scan all non-deleted notes in the KB and write a markdown table to __catalog.
 * Idempotent: safe to call multiple times; version increments on each rebuild.
 */
async function rebuildCatalog(workspaceId: string, kbId: string): Promise<void> {
  const db = getDb();

  const notes = await db
    .select({
      slug: schema.notes.slug,
      title: schema.notes.title,
      taxonomy: schema.notes.taxonomy,
      updatedAt: schema.notes.updatedAt,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, workspaceId),
        eq(schema.notes.kbId, kbId),
      ),
    )
    .orderBy(schema.notes.slug);

  const lines: string[] = [
    `# Catalog`,
    ``,
    `_Auto-generated index. Updated after each compile run._`,
    ``,
    `| Slug | Title | Taxonomy | Updated |`,
    `|------|-------|----------|---------|`,
  ];

  for (const note of notes) {
    if (note.slug === SENTINEL_CATALOG) continue; // skip self-reference
    const updated = note.updatedAt instanceof Date
      ? note.updatedAt.toISOString().slice(0, 10)
      : String(note.updatedAt);
    lines.push(`| ${note.slug} | ${note.title} | ${note.taxonomy} | ${updated} |`);
  }

  const content = lines.join('\n');

  const existing = await db
    .select({ id: schema.notes.id, version: schema.notes.version })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, workspaceId),
        eq(schema.notes.kbId, kbId),
        eq(schema.notes.slug, SENTINEL_CATALOG),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.notes).values({
      workspaceId,
      kbId,
      slug: SENTINEL_CATALOG,
      title: 'Catalog',
      content,
      taxonomy: 'reference',
      tags: ['__system'],
      links: [],
      version: 1,
    });
  } else {
    const { id, version } = existing[0]!;
    await db
      .update(schema.notes)
      .set({ content, version: version + 1, updatedAt: new Date() })
      .where(eq(schema.notes.id, id));
  }
}
