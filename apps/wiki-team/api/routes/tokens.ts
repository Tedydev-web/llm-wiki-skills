/**
 * tokens.ts — /api/me/tokens MCP token lifecycle (ADR 012)
 *
 * GET    /api/me/tokens              — list caller's tokens (metadata only, no plaintext)
 * POST   /api/me/tokens              — issue new token (rate-limited + step-up reauth)
 * DELETE /api/me/tokens/:tid         — revoke single token
 * POST   /api/me/tokens/:tid/rotate  — revoke + reissue atomically
 * POST   /api/me/tokens/revoke-all   — incident-response kill-switch
 *
 * Rate limit: max 10 tokens / user / UTC calendar day (Redis INCR key).
 * Step-up: session must be ≤ 15 min old at issuance time.
 * Plaintext returned ONCE at POST — never logged, never re-fetchable.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { getDb, schema } from '../../storage/db.js';
import {
  issueMcpToken,
  revokeMcpToken,
  rotateMcpToken,
  revokeAllMcpTokens,
  type McpTokenDb,
  type McpTokenRedis,
} from '../../auth/mcp-token-service.js';

// ---------------------------------------------------------------------------
// McpTokenDb adapter — Drizzle-backed (shared by this router + mcp-host)

export function buildMcpTokenDbAdapter(db: ReturnType<typeof getDb>): McpTokenDb {
  return {
    async insertMcpToken(row) {
      await db.insert(schema.mcpTokens).values({
        id: row.id,
        prefixLookup: row.prefixLookup,
        tokenHash: row.tokenHash,
        userId: row.userId,
        workspaceId: row.workspaceId ?? '00000000-0000-0000-0000-000000000000',
        scopes: row.scopes,
        grantedKbIds: [],
        grantedPageTypes: [],
        expiresAt: row.expiresAt ?? undefined,
        revokedAt: row.revokedAt ?? undefined,
        createdAt: new Date(),
      });
      return row.id;
    },

    async findMcpTokenByPrefixLookup(prefixLookup) {
      const [row] = await db
        .select()
        .from(schema.mcpTokens)
        .where(eq(schema.mcpTokens.prefixLookup, prefixLookup))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        prefixLookup: row.prefixLookup,
        tokenHash: row.tokenHash,
        userId: row.userId,
        workspaceId: row.workspaceId ?? null,
        scopes: (row.scopes as import('@wiki-team/schema').PermissionGrant[]) ?? [],
        expiresAt: row.expiresAt ?? null,
        revokedAt: row.revokedAt ?? null,
        createdAt: row.createdAt,
      };
    },

    async findMcpTokenById(id) {
      const [row] = await db
        .select()
        .from(schema.mcpTokens)
        .where(eq(schema.mcpTokens.id, id))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        prefixLookup: row.prefixLookup,
        tokenHash: row.tokenHash,
        userId: row.userId,
        workspaceId: row.workspaceId ?? null,
        scopes: (row.scopes as import('@wiki-team/schema').PermissionGrant[]) ?? [],
        expiresAt: row.expiresAt ?? null,
        revokedAt: row.revokedAt ?? null,
        createdAt: row.createdAt,
      };
    },

    async revokeMcpTokenById(id) {
      await db
        .update(schema.mcpTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcpTokens.id, id));
    },

    async revokeAllMcpTokensByUserId(userId) {
      const rows = await db
        .update(schema.mcpTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcpTokens.userId, userId))
        .returning({ id: schema.mcpTokens.id });
      return rows.length;
    },

    async countMcpTokensIssuedToday(_userId, _dateKey) {
      // Rate limiting is enforced via Redis INCR; DB count is fallback only
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// McpTokenRedis adapter

function buildMcpTokenRedisAdapter(redis: Redis): McpTokenRedis {
  return {
    async incrIssuanceCounter(userId, dateKey) {
      const key = `token-issue-rate:${userId}:${dateKey}`;
      return redis.incr(key);
    },
    async expireIssuanceCounter(userId, dateKey, ttlSeconds) {
      const key = `token-issue-rate:${userId}:${dateKey}`;
      await redis.expire(key, ttlSeconds);
    },
  };
}

// ---------------------------------------------------------------------------
// Seconds until UTC midnight (for Retry-After header)

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

// ---------------------------------------------------------------------------

export function buildTokensRouter(redis: Redis): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();
  const mcpTokenRedis = buildMcpTokenRedisAdapter(redis);

  // GET /api/me/tokens — list caller's tokens (no plaintext)
  app.get('/me/tokens', async (c) => {
    const ctx = requireAuth(c);
    const db = getDb();
    const rows = await db
      .select({
        id: schema.mcpTokens.id,
        workspaceId: schema.mcpTokens.workspaceId,
        expiresAt: schema.mcpTokens.expiresAt,
        revokedAt: schema.mcpTokens.revokedAt,
        createdAt: schema.mcpTokens.createdAt,
        scopes: schema.mcpTokens.scopes,
      })
      .from(schema.mcpTokens)
      .where(eq(schema.mcpTokens.userId, ctx.userId));

    return c.json({ tokens: rows });
  });

  // POST /api/me/tokens — issue (rate-limited + step-up reauth)
  app.post(
    '/me/tokens',
    auditLog('mcp_token.issued', 'mcp_token', (c) => c.get('newTokenId' as never) as string | null),
    async (c) => {
      const ctx = requireAuth(c);

      // Step-up: need session source + session age check
      if (ctx.source !== 'session') {
        return errorResponse(c, 401, 'unauthorized', 'Token issuance requires a browser session, not a bearer token');
      }

      type IssueBody = {
        workspaceId?: string;
        scopes?: import('@wiki-team/schema').PermissionGrant[];
        expiresAt?: string;
        sessionCreatedAt?: string; // ISO timestamp from client (Better Auth session.createdAt)
      };
      const body: IssueBody = await c.req.json<IssueBody>().catch(() => ({} as IssueBody));

      // sessionCreatedAt must be supplied by client (from Better Auth session object)
      const sessionCreatedAt = body.sessionCreatedAt
        ? new Date(body.sessionCreatedAt)
        : new Date(0); // force step-up failure if not supplied

      const db = getDb();
      const mcpTokenDb = buildMcpTokenDbAdapter(db);

      try {
        const result = await issueMcpToken(
          {
            userId: ctx.userId,
            workspaceId: body.workspaceId ?? ctx.workspaceId ?? null,
            scopes: body.scopes ?? [],
            expiresAt: body.expiresAt ?? null,
            sessionCreatedAt,
          },
          mcpTokenDb,
          mcpTokenRedis,
        );

        c.set('newTokenId' as never, result.tokenId as never);

        // Plaintext returned ONCE — never log this value
        return c.json({ tokenId: result.tokenId, token: result.plaintext }, 201);
      } catch (err) {
        const e = err as { status?: number; message?: string; retryAfterKey?: string };

        if (e.status === 401) {
          return errorResponse(c, 401, 'step_up_required', e.message ?? 'Session too old — re-authenticate to issue tokens');
        }

        if (e.status === 429) {
          const retryAfter = secondsUntilUtcMidnight();
          c.header('Retry-After', String(retryAfter));
          return errorResponse(c, 429, 'too_many_requests', e.message ?? 'Token issuance rate limit exceeded', { retryAfterSeconds: retryAfter });
        }

        throw err; // re-throw unexpected errors → global error handler
      }
    },
  );

  // DELETE /api/me/tokens/:tid — revoke single token
  app.delete(
    '/me/tokens/:tid',
    auditLog('mcp_token.revoked', 'mcp_token', (c) => c.req.param('tid')),
    async (c) => {
      const ctx = requireAuth(c);
      const db = getDb();
      const mcpTokenDb = buildMcpTokenDbAdapter(db);

      try {
        await revokeMcpToken(c.req.param('tid'), ctx.userId, mcpTokenDb);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) return errorResponse(c, 404, 'not_found', e.message ?? 'Token not found');
        if (e.status === 403) return errorResponse(c, 403, 'forbidden', e.message ?? 'Not your token');
        throw err;
      }

      return c.json({ revoked: true, tokenId: c.req.param('tid') });
    },
  );

  // POST /api/me/tokens/:tid/rotate — revoke + reissue atomically
  app.post(
    '/me/tokens/:tid/rotate',
    auditLog('mcp_token.rotated', 'mcp_token', (c) => c.req.param('tid')),
    async (c) => {
      const ctx = requireAuth(c);
      type RotateBody = { sessionCreatedAt?: string };
      const body: RotateBody = await c.req.json<RotateBody>().catch(() => ({} as RotateBody));
      const sessionCreatedAt = body.sessionCreatedAt ? new Date(body.sessionCreatedAt) : new Date(0);

      const db = getDb();
      const mcpTokenDb = buildMcpTokenDbAdapter(db);

      try {
        const result = await rotateMcpToken(
          c.req.param('tid'),
          ctx.userId,
          sessionCreatedAt,
          mcpTokenDb,
          mcpTokenRedis,
        );
        // Plaintext returned ONCE
        return c.json({ newTokenId: result.newTokenId, token: result.plaintext }, 201);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 401) return errorResponse(c, 401, 'step_up_required', e.message ?? 'Session too old');
        if (e.status === 404) return errorResponse(c, 404, 'not_found', e.message ?? 'Token not found');
        if (e.status === 403) return errorResponse(c, 403, 'forbidden', e.message ?? 'Not your token');
        if (e.status === 429) {
          const retryAfter = secondsUntilUtcMidnight();
          c.header('Retry-After', String(retryAfter));
          return errorResponse(c, 429, 'too_many_requests', e.message ?? 'Rate limit exceeded', { retryAfterSeconds: retryAfter });
        }
        throw err;
      }
    },
  );

  // POST /api/me/tokens/revoke-all — incident-response kill-switch
  app.post(
    '/me/tokens/revoke-all',
    auditLog('mcp_token.revoke_all', 'mcp_token', (c) => c.get('authContext')?.userId ?? null),
    async (c) => {
      const authCtx = requireAuth(c);
      const db = getDb();
      const mcpTokenDb = buildMcpTokenDbAdapter(db);
      const count = await revokeAllMcpTokens(authCtx.userId, mcpTokenDb);
      return c.json({ revokedCount: count });
    },
  );

  return app;
}
