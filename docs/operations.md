# Operations Runbook — wiki-team v2.1

This document covers operational procedures for running wiki-team in production.

---

## 1. Initial Admin Setup

First-boot admin creation is automated via environment variables.

**Steps:**

1. Set environment variables before first start:
   ```
   DEFAULT_ADMIN_EMAIL=admin@yourdomain.com
   DEFAULT_ADMIN_PASSWORD=<strong-password-min-32-chars>
   ```
2. Start the server: `bun run apps/wiki-team/server.ts`
3. Server logs confirm: `[admin-bootstrap] Admin user created`
4. Sign in at `http://localhost:3333/signin` with the credentials above
5. **Remove** `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` from your environment immediately after first login — server rejects them on restart if still set (security posture check)

**Notes:**
- Idempotent: re-running with same email does nothing (returns `idempotent-ok`)
- OAuth email collision: server refuses to escalate existing OAuth-only user to admin — use a separate admin email
- Race-safe: multi-worker race conditions handled via Postgres unique constraint + re-grant path

---

## 2. Secret Rotation

### 2.1 Rotating `BETTER_AUTH_SECRET` (every 90 days)

`BETTER_AUTH_SECRET` signs MCP tokens (HMAC prefix lookups) and Better Auth sessions.

**Impact of rotation:** All existing MCP tokens and sessions are immediately invalidated. Users must re-authenticate; API consumers must re-issue tokens via `POST /api/me/tokens`.

**Zero-downtime rotation procedure:**

1. Generate new secret: `openssl rand -hex 32`
2. Set `BETTER_AUTH_SECRET_PREVIOUS=<current-value>` and `BETTER_AUTH_SECRET=<new-value>` simultaneously
3. Deploy/restart all server processes (rolling deploy if clustered)
4. During the dual-key window, existing tokens validated against `BETTER_AUTH_SECRET_PREVIOUS` remain valid
5. After all clients have re-authenticated (24–48h window), remove `BETTER_AUTH_SECRET_PREVIOUS`
6. Audit: check `audit_events` table for any `token.verify-failed` entries after rotation

**Minimum secret strength:** 32 bytes (64 hex chars). Server refuses to start if value contains `CHANGE_ME_BEFORE_BOOT`.

---

### 2.2 Rotating `AUDIT_HMAC_SECRET` (every 180 days)

`AUDIT_HMAC_SECRET` computes `actor_email_hmac = HMAC-SHA256(email, secret)` stored in `audit_events`.

**Impact of rotation:** Historical audit log searchability degrades — old HMAC values no longer match the current secret. The audit trail itself remains intact (rows are not deleted). Cross-period correlation requires access to the previous secret.

**Rotation procedure:**

1. Generate new secret: `openssl rand -hex 32`
2. Record rotation date in your secrets vault alongside the old value (needed for historical correlation)
3. Update `AUDIT_HMAC_SECRET` in environment and restart
4. Optionally: run a background job to re-HMAC historical rows using the new secret (requires old secret temporarily)

**Key versioning:** The `audit_events` table includes a `createdAt` timestamp. Rotation epochs are tracked in your secrets vault. To correlate an email against historical rows: apply HMAC with the key that was active at `createdAt`.

---

### 2.3 Rotating Provider API Keys

Provider API keys (Anthropic, Google, OpenAI, etc.) are stored encrypted in the database (`providers.encryptedApiKey`). The encryption key is derived from `BETTER_AUTH_SECRET`.

**Rotation procedure (no downtime):**

1. Obtain a new API key from the provider's dashboard
2. Call `PATCH /api/workspaces/:id/providers/:providerId` with the new key — the server re-encrypts using the current `BETTER_AUTH_SECRET`
3. Verify the provider is functional: trigger a small test compilation
4. Revoke the old key in the provider's dashboard
5. No restart required — encryption happens per-request

**If `BETTER_AUTH_SECRET` is rotated while provider keys exist:**
- Old encrypted keys become unreadable
- Re-enter provider keys via API after rotating `BETTER_AUTH_SECRET`
- This is why the dual-key window (§2.1) must overlap key re-entry

---

## 3. Structured Logging

wiki-team uses **pino** for structured JSON logging.

### Log Levels

| Level | When to use |
|-------|-------------|
| `fatal` | Process cannot continue; imminent crash |
| `error` | Request/job failed; requires operator attention |
| `warn` | Degraded state; non-fatal but worth investigating |
| `info` | Normal operation milestones (boot, job start/end) |
| `debug` | Verbose operational detail (disabled in production) |
| `trace` | Per-frame tracing (local dev only) |

**Configuration:** Set `LOG_LEVEL` environment variable (default: `info`).

**Development pretty-print:** Set `NODE_ENV=development` for colorized output via `pino-pretty`.

**Production:** JSON lines on stdout — pipe to your log aggregator (Loki, Datadog, CloudWatch, etc.).

### Redacted Fields

The following fields are **always** replaced with `[REDACTED]` in log output, regardless of nesting level:

- `req.headers.authorization`, `authorization` — HTTP Bearer tokens
- `*.api_key`, `*.api_key_plaintext` — provider API keys
- `password`, `passwordHash`, `password_hash` — user credentials
- `token`, `plaintext` — MCP token plaintext values
- `*.secret`, `*.token`, `*.password`, `*.dsn` — generic secret subfields

**Verify redaction:** Run `LOG_LEVEL=debug bun run server.ts` and inspect output — no raw secrets should appear.

---

## 4. Sentry Error Reporting (Optional)

Sentry integration is **opt-in**. The server runs normally without it.

### Setup

1. Create a Sentry project at https://sentry.io
2. Copy the DSN from Project Settings → Client Keys
3. Set `SENTRY_DSN=<your-dsn>` in environment
4. Restart server — logs confirm: `[sentry] initialized (DSN configured)`

### Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `SENTRY_DSN` | (unset) | DSN string; empty = disabled |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Performance trace sampling (0–1). Keep at 0.1 for free tier (5k events/month limit) |

### What is captured

- Unhandled server errors (5xx)
- `captureException()` calls in error handlers

### What is redacted

Before sending to Sentry, the `beforeSend` hook removes:
- `request.headers.authorization`
- `request.headers.cookie`
- `request.headers.x-api-key`

---

## 5. Backup Strategy

### Database (Postgres)

Daily backups via `pg_dump` — store in MinIO with 30-day retention:

```bash
#!/usr/bin/env bash
# backup-db.sh — run daily via cron: 0 2 * * * /opt/wiki-team/backup-db.sh
set -euo pipefail

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/wiki_team_${DATE}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

# Upload to MinIO (mc must be configured: mc alias set minio $MINIO_ENDPOINT $MINIO_ACCESS_KEY $MINIO_SECRET_KEY)
mc cp "$BACKUP_FILE" "minio/wiki-team-backups/db/${DATE}.sql.gz"

# Prune backups older than 30 days
mc rm --recursive --force --older-than 30d "minio/wiki-team-backups/db/"

rm "$BACKUP_FILE"
echo "Backup complete: ${DATE}"
```

### Object Storage (MinIO)

Mirror MinIO buckets to an offsite bucket daily:

```bash
# mc mirror: sync wiki-team-files to offsite storage
mc mirror --remove --watch minio/wiki-team-files offsite/wiki-team-files-backup
```

### Restore procedure

```bash
# Restore from a specific backup
mc cp "minio/wiki-team-backups/db/20250101-020000.sql.gz" /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz
psql "$DATABASE_URL" < /tmp/restore.sql
```

---

## 6. TLS / Reverse Proxy

wiki-team binds HTTP only. TLS termination must be handled by a reverse proxy.

### Caddy (recommended)

```caddy
wiki.yourdomain.com {
  reverse_proxy localhost:3333
}

mcp.yourdomain.com {
  reverse_proxy localhost:3334
}
```

Caddy auto-provisions Let's Encrypt certificates. No additional config needed.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name wiki.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/wiki.crt;
    ssl_certificate_key /etc/ssl/private/wiki.key;

    location / {
        proxy_pass http://localhost:3333;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

---

## 7. Health Check & Monitoring

### Health endpoint

```bash
curl http://localhost:3333/healthz
# → {"status":"ok","uptime":12345}

curl http://localhost:3334/healthz
# → {"status":"ok","sessions":0}
```

Both servers expose `/healthz` — no authentication required. Use in container `HEALTHCHECK` directives and load balancer probes.

### Uptime monitoring

Configure your monitoring system to poll `/healthz` every 30 seconds. Alert if:
- Response code is not 200
- Response time exceeds 2 seconds
- No response for 3 consecutive checks

### Log-based alerts

Key log patterns to alert on:

| Pattern | Severity | Action |
|---------|----------|--------|
| `[server] Redis error` | High | Check Redis connectivity |
| `[server] unhandled error` | High | Check application logs |
| `[audit-log] AUDIT_HMAC_SECRET not configured` | Critical | Set env var immediately |
| `[worker] job failed` | Medium | Check job error details |
| `[embedding] Input truncated` | Low | Consider chunking strategy |
