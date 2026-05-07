/**
 * ivfflat-index-creator.ts — checks notes row count + creates ivfflat indexes per dim
 *
 * Per-dimension logic (768/1024/1536):
 *   1. Count non-null rows for the dim column
 *   2. If count > 1000 AND no ivfflat index exists yet → CREATE INDEX CONCURRENTLY
 *   3. lists = GREATEST(100, LEAST(1000, ROUND(SQRT(count))))  — ADR tuning
 *
 * Idempotent: uses CREATE INDEX IF NOT EXISTS + pg_indexes existence check.
 * Non-blocking: CONCURRENTLY option avoids table lock (Postgres 12+).
 *
 * Called from: POST /api/admin/perf/ivfflat-rebuild route, or weekly cron (v2.2+).
 */

import { sql } from 'drizzle-orm';
import { getDb } from '../storage/db.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types

export type EmbeddingDim = 768 | 1024 | 1536;

interface DimConfig {
  dim: EmbeddingDim;
  column: string;
  indexName: string;
}

export interface IvfflatIndexResult {
  dim: EmbeddingDim;
  rowCount: number;
  indexExists: boolean;
  created: boolean;
  lists: number | null;
  skippedReason: string | null;
}

export interface IvfflatCreateSummary {
  results: IvfflatIndexResult[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants — one config entry per active embedding dimension

const DIM_CONFIGS: DimConfig[] = [
  {
    dim: 768,
    column: 'embedding_768',
    indexName: 'notes_embedding_768_ivfflat_idx',
  },
  {
    dim: 1024,
    column: 'embedding_1024',
    indexName: 'notes_embedding_1024_ivfflat_idx',
  },
  {
    dim: 1536,
    column: 'embedding_1536',
    indexName: 'notes_embedding_1536_ivfflat_idx',
  },
];

const ROW_THRESHOLD = 1_000; // minimum rows before ivfflat is beneficial

// ---------------------------------------------------------------------------
// computeLists — ADR tuning formula

function computeLists(rowCount: number): number {
  return Math.max(100, Math.min(1_000, Math.round(Math.sqrt(rowCount))));
}

// ---------------------------------------------------------------------------
// checkIndexExists — query pg_indexes for index name

async function checkIndexExists(indexName: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT 1 FROM pg_indexes
    WHERE indexname = ${indexName}
    LIMIT 1
  `);
  return (result as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// countNonNullRows — count rows where column IS NOT NULL

async function countNonNullRows(column: string): Promise<number> {
  const db = getDb();
  // column is one of 3 static strings — safe from injection
  const result = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS cnt FROM notes WHERE ${column} IS NOT NULL`),
  );
  return Number((result as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// createIvfflatIndex — CREATE INDEX CONCURRENTLY (non-blocking)

async function createIvfflatIndex(cfg: DimConfig, lists: number): Promise<void> {
  const db = getDb();
  // column and indexName are static strings — safe from injection
  await db.execute(
    sql.raw(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${cfg.indexName}` +
      ` ON notes USING ivfflat (${cfg.column} vector_cosine_ops)` +
      ` WITH (lists = ${lists})` +
      ` WHERE ${cfg.column} IS NOT NULL`,
    ),
  );
}

// ---------------------------------------------------------------------------
// ensureIvfflatIndexForDim — process one dimension config

async function ensureIvfflatIndexForDim(cfg: DimConfig): Promise<IvfflatIndexResult> {
  const rowCount = await countNonNullRows(cfg.column);

  if (rowCount <= ROW_THRESHOLD) {
    logger.debug(
      { dim: cfg.dim, rowCount, threshold: ROW_THRESHOLD },
      '[ivfflat] below threshold — skipping index creation',
    );
    return {
      dim: cfg.dim,
      rowCount,
      indexExists: false,
      created: false,
      lists: null,
      skippedReason: `row_count ${rowCount} <= threshold ${ROW_THRESHOLD}`,
    };
  }

  const indexExists = await checkIndexExists(cfg.indexName);
  if (indexExists) {
    logger.info(
      { dim: cfg.dim, rowCount, indexName: cfg.indexName },
      '[ivfflat] index already exists — skipping',
    );
    return {
      dim: cfg.dim,
      rowCount,
      indexExists: true,
      created: false,
      lists: null,
      skippedReason: 'index_already_exists',
    };
  }

  const lists = computeLists(rowCount);
  logger.info(
    { dim: cfg.dim, rowCount, lists, indexName: cfg.indexName },
    '[ivfflat] creating index',
  );

  await createIvfflatIndex(cfg, lists);

  logger.info(
    { dim: cfg.dim, rowCount, lists, indexName: cfg.indexName },
    '[ivfflat] index created successfully',
  );

  return {
    dim: cfg.dim,
    rowCount,
    indexExists: false,
    created: true,
    lists,
    skippedReason: null,
  };
}

// ---------------------------------------------------------------------------
// createIvfflatIndexes — public API: process all 3 dimension configs

export async function createIvfflatIndexes(): Promise<IvfflatCreateSummary> {
  const startMs = Date.now();
  logger.info('[ivfflat] starting per-dim index evaluation');

  const results: IvfflatIndexResult[] = [];

  // Sequential per dim — CONCURRENTLY already parallelises at PG level
  for (const cfg of DIM_CONFIGS) {
    try {
      const result = await ensureIvfflatIndexForDim(cfg);
      results.push(result);
    } catch (err) {
      logger.error(
        { dim: cfg.dim, err: err instanceof Error ? err.message : String(err) },
        '[ivfflat] error processing dim — continuing with remaining dims',
      );
      results.push({
        dim: cfg.dim,
        rowCount: -1,
        indexExists: false,
        created: false,
        lists: null,
        skippedReason: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const durationMs = Date.now() - startMs;
  logger.info({ results, durationMs }, '[ivfflat] evaluation complete');

  return { results, durationMs };
}
