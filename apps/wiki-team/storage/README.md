# storage/ — P03 spike findings and usage notes

## Spike outcome (P03 MUST-PASS gate) — PASS

Tested on `pgvector/pgvector:pg16` via `docker compose up -d`.

### vector(768) round-trip — CONFIRMED

```sql
-- Insert 768-dim unit vector via generate_series CTE (reliable pattern):
WITH vec_str AS (
  SELECT '[' || string_agg(v::text, ',' ORDER BY i) || ']' AS vec
  FROM (SELECT i, CASE WHEN i=1 THEN 1.0 ELSE 0.0 END AS v FROM generate_series(1,768) i) s
)
INSERT INTO notes (..., embedding) SELECT ..., vec::vector FROM vec_str;

-- cosine_distance query (<=> operator):
SELECT id, embedding <=> $query_vec::vector AS dist
FROM notes
WHERE embedding IS NOT NULL
ORDER BY dist ASC LIMIT 10;
-- Self-distance = exactly 0. NULL rows correctly excluded by IS NOT NULL filter.
```

### JSONB array overlap for tags — CONFIRMED PATTERN (P05 gate)

**`jsonb::text[] && ARRAY[...]::text[]` FAILS** — Postgres cannot cast jsonb to text[].

**Correct patterns (both confirmed working):**

**Pattern A — recommended for P05 `compileScopeFilter`:**
```sql
-- tags column is JSONB; ?| checks if any element matches
SELECT notes.* FROM notes WHERE tags ?| ARRAY['fact', 'analysis'];
```

In Drizzle (P05 must use `sql`` escape hatch`):
```typescript
import { sql } from 'drizzle-orm';
db.select().from(notes).where(
  sql`${notes.tags} ?| ${sql.array(allowedTags)}`
)
```

**Pattern B — fallback:**
```sql
SELECT notes.* FROM notes
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(tags) t
  WHERE t.value = ANY(ARRAY['fact', 'analysis'])
);
```

### IVFFlat vector index

NOT created automatically. Create manually after >1000 rows:
```sql
CREATE INDEX notes_embedding_ivfflat_idx
  ON notes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

For dev/smoke test: exact scan (no index) is sufficient and correct.

### Redis port

`docker-compose.yml` maps Redis to host port **6380** (not 6379) to avoid conflict
with other Redis instances. Set `REDIS_URL=redis://localhost:6380` in `.env`.

## Files

| File | Purpose |
|---|---|
| `db.ts` | Drizzle + postgres-js singleton client factory |
| `object-store.ts` | MinIO/S3 client wrapper (`@aws-sdk/client-s3`) |
| `embedding.ts` | Gemini text-embedding-004 helper (768-dim output) |
| `db-migrate-runner.ts` | Custom migration runner (applies 0000 extensions first) |
