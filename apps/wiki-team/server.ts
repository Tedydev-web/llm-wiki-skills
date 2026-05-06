/**
 * server.ts — wiki-team HTTP API server entry point (Hono on Bun.serve)
 *
 * Boot sequence:
 *   1. Assert required env vars (DB, auth, audit)
 *   2. Init DB singleton (getDb)
 *   3. Init Redis (ioredis) for BullMQ producer + token rate-limiting
 *   4. Build Better Auth instance
 *   5. Build McpTokenDb adapter (shared with mcp-host)
 *   6. Mount auth middleware (global /api/*)
 *   7. Mount API router (all routes)
 *   8. Attach error handler
 *   9. Bun.serve on API_PORT
 *
 * Ports:
 *   API_PORT  (default 3333) — this server
 *   MCP_PORT  (default 3334) — mcp-host/server.ts (separate process)
 *
 * Anti-trace: uses our names only (rbacGuard, authContextMiddleware, etc.)
 */

import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { getDb } from './storage/db.js';
import { assertAuthEnv, createAuthInstance } from './auth/better-auth.js';
import { buildAuthMiddleware } from './api/middleware/auth.js';
import { globalErrorHandler } from './api/middleware/error-handler.js';
import { buildApiRouter } from './api/index.js';
import { buildMcpTokenDbAdapter } from './api/routes/tokens.js';

// ---------------------------------------------------------------------------
// Environment validation

function assertServerEnv(): void {
  assertAuthEnv(); // BETTER_AUTH_SECRET

  const auditSecret = process.env['AUDIT_HMAC_SECRET'];
  if (!auditSecret || auditSecret.trim() === '') {
    throw new Error('[server] AUDIT_HMAC_SECRET is required. Set it before starting.');
  }
  if (auditSecret.includes('CHANGE_ME_BEFORE_BOOT')) {
    throw new Error('[server] AUDIT_HMAC_SECRET still has placeholder value. Replace it.');
  }

  if (!process.env['DATABASE_URL']) {
    throw new Error('[server] DATABASE_URL is required.');
  }
  if (!process.env['REDIS_URL']) {
    throw new Error('[server] REDIS_URL is required.');
  }
}

// ---------------------------------------------------------------------------
// Boot

assertServerEnv();

const API_PORT = parseInt(process.env['API_PORT'] ?? '3333', 10);
const REDIS_URL = process.env['REDIS_URL']!;

// DB singleton (validates DATABASE_URL + CHANGE_ME_BEFORE_BOOT on first call)
const db = getDb();

// Redis client (shared by BullMQ producer + token rate-limit adapter)
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[server] Redis error:', err.message);
});

// Better Auth instance
const authInstance = createAuthInstance(db);

// McpTokenDb adapter (Drizzle-backed — shared with mcp-host after P08)
const mcpTokenDb = buildMcpTokenDbAdapter(db);

// ---------------------------------------------------------------------------
// Hono app assembly

const app = new Hono();

// Global auth middleware — populates c.var.authContext for all /api/* routes
app.use('/api/*', buildAuthMiddleware(authInstance, mcpTokenDb));

// Better Auth handles its own routes under /auth/*
app.on(['GET', 'POST'], '/auth/*', (c) => {
  return authInstance.handler(c.req.raw);
});

// Mount API router (all routes including /healthz, /openapi.json, /docs, /api/*)
const apiRouter = buildApiRouter(redis, REDIS_URL);
app.route('/', apiRouter);

// Global error handler (must be last)
app.onError(globalErrorHandler);

// 404 fallback
app.notFound((c) =>
  c.json({ error: 'not_found', message: `No route matched ${c.req.method} ${new URL(c.req.url).pathname}` }, 404),
);

// ---------------------------------------------------------------------------
// Bun.serve

Bun.serve({
  port: API_PORT,
  fetch: app.fetch,
  error(err: Error): Response {
    console.error('[server] unhandled error:', err.message);
    return new Response(
      JSON.stringify({ error: 'internal_server_error', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  },
});

console.log(`[server] wiki-team HTTP API listening on port ${API_PORT}`);
console.log(`[server] Health:   GET  http://localhost:${API_PORT}/healthz`);
console.log(`[server] OpenAPI:  GET  http://localhost:${API_PORT}/openapi.json`);
console.log(`[server] Swagger:  GET  http://localhost:${API_PORT}/docs`);
