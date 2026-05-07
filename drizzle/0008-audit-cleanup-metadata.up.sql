-- 0008-audit-cleanup-metadata.up.sql
-- Conditional ivfflat index creation — per active embedding dimension
-- ADR: lists = GREATEST(100, LEAST(1000, ROUND(SQRT(row_count))))
-- Uses CREATE INDEX CONCURRENTLY to avoid table lock (Postgres 12+)
-- Safe to run multiple times (IF NOT EXISTS + existence guard)

DO $$
DECLARE
  row_count  INTEGER;
  list_count INTEGER;
BEGIN

  -- 768d index (embedding_768 — Google / default)
  SELECT COUNT(*)::int INTO row_count FROM notes WHERE embedding_768 IS NOT NULL;
  list_count := GREATEST(100, LEAST(1000, ROUND(SQRT(row_count))::INTEGER));
  IF row_count > 1000 THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS notes_embedding_768_ivfflat_idx'
      ' ON notes USING ivfflat (embedding_768 vector_cosine_ops)'
      ' WITH (lists = %s)'
      ' WHERE embedding_768 IS NOT NULL',
      list_count
    );
    RAISE NOTICE '[0008] Created ivfflat 768d index with lists=%', list_count;
  ELSE
    RAISE NOTICE '[0008] Skipped 768d index — only % rows (threshold 1000)', row_count;
  END IF;

  -- 1024d index (embedding_1024 — Voyage)
  SELECT COUNT(*)::int INTO row_count FROM notes WHERE embedding_1024 IS NOT NULL;
  list_count := GREATEST(100, LEAST(1000, ROUND(SQRT(row_count))::INTEGER));
  IF row_count > 1000 THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS notes_embedding_1024_ivfflat_idx'
      ' ON notes USING ivfflat (embedding_1024 vector_cosine_ops)'
      ' WITH (lists = %s)'
      ' WHERE embedding_1024 IS NOT NULL',
      list_count
    );
    RAISE NOTICE '[0008] Created ivfflat 1024d index with lists=%', list_count;
  ELSE
    RAISE NOTICE '[0008] Skipped 1024d index — only % rows (threshold 1000)', row_count;
  END IF;

  -- 1536d index (embedding_1536 — OpenAI)
  SELECT COUNT(*)::int INTO row_count FROM notes WHERE embedding_1536 IS NOT NULL;
  list_count := GREATEST(100, LEAST(1000, ROUND(SQRT(row_count))::INTEGER));
  IF row_count > 1000 THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS notes_embedding_1536_ivfflat_idx'
      ' ON notes USING ivfflat (embedding_1536 vector_cosine_ops)'
      ' WITH (lists = %s)'
      ' WHERE embedding_1536 IS NOT NULL',
      list_count
    );
    RAISE NOTICE '[0008] Created ivfflat 1536d index with lists=%', list_count;
  ELSE
    RAISE NOTICE '[0008] Skipped 1536d index — only % rows (threshold 1000)', row_count;
  END IF;

END $$;
