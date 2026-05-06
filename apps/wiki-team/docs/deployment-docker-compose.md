# Self-host with Docker Compose

Step-by-step guide for running `wiki-team` on your own server.

**Supported:** Linux (amd64, arm64), macOS (Apple Silicon + Intel) for local dev.
**Not covered in v2.0:** Kubernetes manifests, Helm chart (community contribution welcome).

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Docker Engine | 24.0 | `docker --version` |
| Docker Compose | v2.20 (Compose v2) | `docker compose version` — note: NOT `docker-compose` v1 |
| Bun | 1.1 | `bun --version` — for running migrations + dev server |
| Git | any | |

---

## Step 1 — Clone the repo

```sh
git clone https://github.com/Tedydev-web/llm-wiki-skills
cd llm-wiki-skills
bun install
```

---

## Step 2 — Configure environment

Copy the example env file:

```sh
cp apps/wiki-team/.env.example apps/wiki-team/.env
```

Edit `apps/wiki-team/.env`. Full variable reference:

### Database

```sh
DATABASE_URL=postgresql://wiki:wiki@localhost:5432/wiki_team
# For production: use a strong password and restrict pg_hba.conf
```

### Redis

```sh
REDIS_URL=redis://localhost:6379
# For production with auth: redis://:password@host:6379
```

### MinIO (object storage)

```sh
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin        # Change in production
MINIO_BUCKET=wiki-materials        # Created automatically on first run
MINIO_USE_SSL=false                # Set true if MinIO behind TLS
```

### Auth (Better Auth)

```sh
BETTER_AUTH_SECRET=<random 32+ char string>
# Generate: openssl rand -base64 32

BETTER_AUTH_URL=https://your-domain.example.com
# For local dev: http://localhost:3333
```

### OAuth providers (at least one required)

**Google:**
1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Authorized redirect URI: `https://your-domain.example.com/api/auth/callback/google`

```sh
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
```

**GitHub:**
1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://your-domain.example.com/api/auth/callback/github`

```sh
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
```

### LLM provider (required for wiki-compile worker)

```sh
ANTHROPIC_API_KEY=sk-ant-...
# Or: OPENAI_API_KEY=sk-... (configure model in apps/wiki-team/jobs/wiki-compile/worker.ts)

WIKI_COMPILE_DAILY_COST_CAP_USD=5.00   # Per-workspace daily spend cap
```

### Server ports

```sh
API_PORT=3333       # Hono REST API
MCP_PORT=3334       # MCP HTTP server
```

---

## Step 3 — Start infrastructure

```sh
docker compose up -d
```

This starts three services defined in `docker-compose.yml`:

| Service | Image | Port | Notes |
|---|---|---|---|
| `wiki-postgres` | `pgvector/pgvector:pg16` | 5432 | Postgres 16 + pgvector |
| `wiki-redis` | `redis:7-alpine` | 6379 | BullMQ + rate limiting |
| `wiki-minio` | `minio/minio:latest` | 9000, 9001 | Object storage; UI at :9001 |

Verify healthy:

```sh
docker compose ps
# All three should show (healthy)
```

### MinIO bucket setup

On first run, create the materials bucket:

```sh
docker compose exec wiki-minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec wiki-minio mc mb local/wiki-materials
```

Or use the MinIO web UI at `http://localhost:9001` (user: `minioadmin`, password: `minioadmin`).

---

## Step 4 — Run migrations

```sh
bun run db:migrate
```

This applies the three migration pairs (0001 init-extensions, 0002 core-tables, 0003 indexes). Idempotent — safe to re-run.

Verify:

```sh
# Quick schema check
docker compose exec wiki-postgres psql -U wiki -d wiki_team -c "\dt"
# Should list: users, workspaces, members, notes, materials, mcp_tokens, jobs, audit_events, ...
```

---

## Step 5 — Start the application

**Development (hot reload):**

```sh
# Terminal 1: API + MCP
bun run team:dev

# Terminal 2: Admin frontend
bun run --cwd apps/wiki-team/frontend-admin dev
```

**Production (Docker — v2.1 target; see note):**

> Note: A production Docker image for `apps/wiki-team/` is planned for v2.1. For v2.0, the recommended production path is: run `bun run team:build && bun run team:start` on your server alongside the Docker Compose infra above, behind a TLS reverse proxy.

```sh
bun run team:build
bun run team:start
```

---

## Step 6 — TLS / reverse proxy

`wiki-team` does not handle TLS directly. Put it behind [Caddy](https://caddyserver.com) or Nginx.

**Caddy example (`Caddyfile`):**

```
your-domain.example.com {
    reverse_proxy /mcp* localhost:3334
    reverse_proxy * localhost:3333
}

admin.your-domain.example.com {
    reverse_proxy localhost:3000
}
```

**Nginx example (excerpt):**

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    location /mcp {
        proxy_pass http://127.0.0.1:3334;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Required for Streamable HTTP (MCP transport)
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Backup strategy

### Postgres (primary data)

```sh
# Daily dump (add to cron)
docker compose exec wiki-postgres pg_dump -U wiki wiki_team | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup-20260506.sql.gz | docker compose exec -T wiki-postgres psql -U wiki wiki_team
```

### MinIO (material files)

```sh
# Mirror to a local backup directory
docker compose exec wiki-minio mc mirror local/wiki-materials /backup/minio/wiki-materials

# Or sync to a remote S3 bucket
mc mirror local/wiki-materials s3/your-backup-bucket/wiki-materials
```

### Redis

Redis data is ephemeral (job queues, rate limit counters, cache). No backup required — queued jobs resume on restart; rate limit counters reset (acceptable).

---

## Postgres tuning (production)

For teams > 10 users or heavy compile workloads, adjust `postgresql.conf`:

```
shared_buffers = 256MB          # ~25% of available RAM
work_mem = 16MB                 # Per-sort operation
max_connections = 50            # wiki-team uses connection pooling
maintenance_work_mem = 64MB
random_page_cost = 1.1          # If using SSD
effective_cache_size = 1GB
```

Apply via `docker compose exec wiki-postgres psql -U wiki -c "SELECT pg_reload_conf();"` after editing.

---

## Upgrading

```sh
git pull origin main
bun install
bun run db:migrate          # Apply any new migrations
bun run team:build          # Rebuild if running production
# Restart server process
```

Down migrations are available if rollback is needed:

```sh
bun run db:migrate:down     # Rolls back one migration step
```

---

## Out of scope for v2.0

- Kubernetes manifests / Helm chart — community contribution welcome
- Single-binary `bun build --compile` distribution — experimental path; AGPL boundary complicates bundling (see [LICENSE-NOTICE.md §3](../../LICENSE-NOTICE.md))
- Multi-region / HA Postgres — use managed Postgres (Neon, Supabase, RDS) with standard `DATABASE_URL`
