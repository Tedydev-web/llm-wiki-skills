-- 0000-init-extensions.sql
-- Applied BEFORE Drizzle Kit migrations by db:migrate script.
-- Drizzle Kit does not emit extension statements — this file is manually managed.
-- MUST run first: creates pgvector extension required by notes.embedding column (vector(768)).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
