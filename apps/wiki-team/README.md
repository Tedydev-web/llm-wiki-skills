# wiki-team (v2.1)

Self-hosted multi-user team wiki server. Upload documents, compile them into a structured linked knowledge base, and query from Claude Desktop via MCP.

## What's new in v2.1

- **Multi-provider AI** — swap LLM (Anthropic / OpenAI / Google), embedding (OpenAI 1536d / Google 768d / Voyage 1024d), and vision (OpenAI / Google / Anthropic) providers from admin UI without code changes. 9-cell adapter matrix.
- **Provider Settings UI** — store provider API keys encrypted (HKDF + AES-GCM-256) in the database; rotate without redeploy.
- **Knowledge-type taxonomy** — admin CRUD for note kinds with color labels. 4 system defaults (fact / analysis / procedure / reference) preserved; add custom kinds freely. 2 new MCP tools: `list_knowledge_types`, `get_knowledge_type_docs`.
- **Image extraction + vision captions** — PDF images extracted during ingestion; vision captions generated via configured vision provider (async BullMQ sub-jobs; never blocks compile). Per-material cap ($0.50 default) + per-workspace daily cap. Opt-in per workspace (default OFF).
- **Semantic search** — embedding write-path wired; multi-dimension router (768d/1024d/1536d); ivfflat auto-created at ≥1000 rows per dimension. Embedding rebuild job with mid-switch abort + pre-flight cost estimate. Search UI in admin frontend.
- **Three-panel wiki browser** — page tree | content | backlinks/outlinks. Keyboard nav: `j`/`k` (prev/next), `b` (backlinks), `Esc` (close), `/` (search focus).
- **Department admin UI** — groups CRUD + `group_note_kinds` RBAC scope assignment. Scope-compiler extended; per-group note-kind visibility without code changes.
- **Admin bootstrap** — `DEFAULT_ADMIN_EMAIL` + `DEFAULT_ADMIN_PASSWORD` env vars create first admin on boot; password cleared from `process.env` after bootstrap; idempotent.
- **Email-password auth** — Better Auth email-password adapter (minPasswordLength 12; accountLinking off) complements existing Google + GitHub OAuth.
- **Source outline + page-range MCP tools** — hierarchical outline from PDF TOC / heading scan; extract specific page ranges. MCP tool count: 8 → 12 (full parity with reference implementation).
- **Structured logging** — pino replaces all `console.*` in server-side code (38 → 0). 14 redact paths for secrets/PII. Optional Sentry init.
- **Audit cleanup cron** — 12-month retention; small-batch DELETE; self-audit carve-out.
- **Test infrastructure** — 5 middleware unit tests; drizzle-zod single-source-of-truth CI assertion; `@vitest/coverage-v8` thresholds (rbac ≥ 70%, jobs/mcp-host/api ≥ 60%). 261 total tests.
- **7 new migrations** (0005–0011): taxonomy color, provider_settings, material_images, audit cleanup metadata, embedding multi-dim, group_note_kinds.

**License:** PolyForm Noncommercial 1.0.0 — non-commercial self-hosted use only. See [LICENSE-NOTICE.md](../../LICENSE-NOTICE.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| HTTP framework | [Hono](https://hono.dev) + `@hono/zod-openapi` |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Database | Postgres 16 + pgvector(768) |
| Job queue | [BullMQ](https://docs.bullmq.io) + Redis |
| Object storage | MinIO (S3-compatible) |
| PDF extraction | MuPDF.js (`mupdf` npm — AGPL-3.0; see AGPL note below) |
| Auth | [Better Auth](https://better-auth.com) (Google + GitHub OAuth) |
| Admin frontend | Next.js 15 + shadcn/ui + Tailwind CSS |
| Schema validation | Zod (via `packages/wiki-schema`) |
| Tests | Vitest |

---

## Quickstart

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://www.docker.com) ≥ 24 + Docker Compose v2
- Google or GitHub OAuth app credentials (for authentication)

### 1. Clone and install

```sh
git clone https://github.com/Tedydev-web/llm-wiki-skills
cd llm-wiki-skills
bun install
```

### 2. Configure environment

```sh
cp apps/wiki-team/.env.example apps/wiki-team/.env
```

Edit `apps/wiki-team/.env` — fill in at minimum:

```sh
DATABASE_URL=postgresql://wiki:wiki@localhost:5432/wiki_team
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
BETTER_AUTH_SECRET=<random 32+ char string>
GOOGLE_CLIENT_ID=<your Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
```

See [docs/deployment-docker-compose.md](docs/deployment-docker-compose.md) for full env var reference.

### 3. Start infrastructure

```sh
docker compose up -d
```

Verify all containers healthy:

```sh
docker compose ps
```

Expect: `wiki-postgres`, `wiki-redis`, `wiki-minio` all `healthy`.

### 4. Run database migrations

```sh
bun run db:migrate
```

### 5. Start the team server

```sh
# API server + MCP host (port 3333 API, port 3334 MCP)
bun run team:dev

# Admin frontend (port 3000) — separate terminal
bun run --cwd apps/wiki-team/frontend-admin dev
```

### 6. Open admin UI

Navigate to `http://localhost:3000` → sign in with Google or GitHub → create a workspace → upload a document → click Compile.

---

## MCP integration (Claude Desktop)

See [docs/mcp-client-setup.md](docs/mcp-client-setup.md) for step-by-step setup.

Short version:
1. Issue an MCP token from the admin UI (Account → API Tokens → New Token)
2. Copy the plaintext token (shown once)
3. Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "wiki-team": {
      "url": "http://localhost:3334/mcp",
      "headers": {
        "Authorization": "Bearer wkt_<your-token>"
      }
    }
  }
}
```

---

## Available scripts

```sh
bun run team:dev          # Start API + MCP server (dev mode, hot reload)
bun run team:build        # Production build
bun run db:migrate        # Apply Drizzle migrations
bun run db:generate       # Generate migration from schema changes
bun run db:studio         # Open Drizzle Studio (schema browser)
bun run test              # Run unit tests (Vitest)
bun run test:integration  # Run integration tests (requires running infra)
bun run typecheck         # TypeScript type check (tsc --noEmit)
```

---

## API documentation

Swagger UI: `http://localhost:3333/docs`
OpenAPI JSON: `http://localhost:3333/openapi.json`

---

## Self-hosting (production)

See [docs/deployment-docker-compose.md](docs/deployment-docker-compose.md) for:
- Environment variable reference
- OAuth provider setup (Google + GitHub)
- MinIO bucket creation
- TLS / reverse proxy (Caddy or Nginx)
- Backup strategy

---

## AGPL note

`packages/wiki-pdf-extract/` wraps the `mupdf` npm package (AGPL-3.0). When distributing a compiled binary of `apps/wiki-team/` that includes this package, AGPL-3.0 obligations apply — you must provide source code to binary recipients. Running the Docker Compose setup for your own team is not distribution. See [LICENSE-NOTICE.md §3](../../LICENSE-NOTICE.md) for full details.

---

## Architecture overview

```
apps/wiki-team/
├── server.ts              # Hono app entry point (API, port 3333)
├── mcp-host/              # MCP HTTP server (port 3334)
├── api/                   # Route handlers (workspaces, members, notes, ...)
├── auth/                  # Better Auth config + session middleware
├── rbac/                  # Dual-realm RBAC engine
├── jobs/wiki-compile/     # BullMQ worker + agent loop
│   └── prompts/v1.md      # System prompt (hash-pinned; change via plan cycle)
├── storage/               # Drizzle schema + MinIO client
├── frontend-admin/        # Next.js 15 admin UI (separate workspace)
packages/
├── wiki-schema/           # Shared Zod types + JSON Schema export
├── wiki-mcp/              # MCP tool definitions + auth middleware
├── wiki-shared/           # Shared utilities
└── wiki-pdf-extract/      # MuPDF.js typed API boundary (AGPL)
```
