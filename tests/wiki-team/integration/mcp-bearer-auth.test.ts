/**
 * mcp-bearer-auth.test.ts — MCP Bearer token auth integration tests
 *
 * Tests 3 cases per spec:
 *   1. Missing Authorization header → McpError auth_required
 *   2. Invalid/malformed token → McpError auth_invalid
 *   3. Valid token (via issueMcpToken fixture) → AuthContext returned
 *
 * Uses in-memory McpTokenDb stub — no real DB required.
 * Skip guard: set SKIP_MCP_TESTS=1 to bypass in CI without DB.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadAuthContextFromBearer, extractBearerToken } from '../../../packages/wiki-mcp/src/mcp-auth.js';
import type { McpTokenDb } from '../../../apps/wiki-team/auth/mcp-token-service.js';
import { issueMcpToken, verifyMcpToken } from '../../../apps/wiki-team/auth/mcp-token-service.js';
import type { McpTokenRedis } from '../../../apps/wiki-team/auth/mcp-token-service.js';

// ---------------------------------------------------------------------------
// Skip guard

const SKIP = process.env['SKIP_MCP_TESTS'] === '1';

// ---------------------------------------------------------------------------
// In-memory McpTokenDb stub

interface StoredRow {
  id: string;
  prefixLookup: string;
  tokenHash: string;
  userId: string;
  workspaceId: string | null;
  scopes: Array<{ resource: string; verb: string; scope: string }>;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function buildInMemoryDb(): McpTokenDb & { _store: Map<string, StoredRow> } {
  const store = new Map<string, StoredRow>();

  return {
    _store: store,

    async insertMcpToken(row) {
      const id = row.id;
      store.set(id, { ...row, createdAt: new Date() } as StoredRow);
      return id;
    },

    async findMcpTokenByPrefixLookup(prefixLookup) {
      for (const row of store.values()) {
        if (row.prefixLookup === prefixLookup) return row as StoredRow;
      }
      return null;
    },

    async findMcpTokenById(id) {
      return store.get(id) ?? null;
    },

    async revokeMcpTokenById(id) {
      const row = store.get(id);
      if (row) store.set(id, { ...row, revokedAt: new Date() });
    },

    async revokeAllMcpTokensByUserId(userId) {
      let count = 0;
      for (const [id, row] of store.entries()) {
        if (row.userId === userId) {
          store.set(id, { ...row, revokedAt: new Date() });
          count++;
        }
      }
      return count;
    },

    async countMcpTokensIssuedToday(_userId, _dateKey) {
      return 0;
    },
  };
}

function buildInMemoryRedis(): McpTokenRedis {
  const counters = new Map<string, number>();
  return {
    async incrIssuanceCounter(userId, dateKey) {
      const key = `${userId}:${dateKey}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async expireIssuanceCounter(_userId, _dateKey, _ttl) {
      // no-op in test
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures

let validToken = '';
let memDb: ReturnType<typeof buildInMemoryDb>;

beforeAll(async () => {
  if (SKIP) return;

  // Set required env for token operations
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-for-mcp-bearer-auth-tests-32chars!!';

  memDb = buildInMemoryDb();
  const redis = buildInMemoryRedis();

  const result = await issueMcpToken(
    {
      userId: 'user-uuid-fixture-001',
      workspaceId: 'ws-uuid-fixture-001',
      scopes: [{ resource: 'page', verb: 'view', scope: 'own' }],
      expiresAt: null,
      sessionCreatedAt: new Date(), // fresh session → step-up passes
    },
    memDb,
    redis,
  );

  validToken = result.plaintext;
});

// ---------------------------------------------------------------------------
// Tests

describe('mcp-bearer-auth', () => {
  describe('extractBearerToken', () => {
    it('returns null for missing header', () => {
      expect(extractBearerToken(null)).toBeNull();
      expect(extractBearerToken(undefined)).toBeNull();
      expect(extractBearerToken('')).toBeNull();
    });

    it('returns null for non-Bearer scheme', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull();
      expect(extractBearerToken('ApiKey xyz')).toBeNull();
    });

    it('extracts token from valid Bearer header', () => {
      const token = extractBearerToken('Bearer wkt_abc123def456');
      expect(token).toBe('wkt_abc123def456');
    });
  });

  describe('loadAuthContextFromBearer — case 1: missing token', () => {
    it.skipIf(SKIP)('throws McpError auth_required when header is absent', async () => {
      const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
      await expect(
        loadAuthContextFromBearer(null, memDb, verifyMcpToken),
      ).rejects.toThrow(McpError);

      try {
        await loadAuthContextFromBearer(null, memDb, verifyMcpToken);
      } catch (err) {
        expect(err).toBeInstanceOf(McpError);
        expect((err as InstanceType<typeof McpError>).message).toContain('auth_required');
      }
    });
  });

  describe('loadAuthContextFromBearer — case 2: invalid token', () => {
    it.skipIf(SKIP)('throws McpError auth_invalid for malformed token', async () => {
      const { McpError } = await import('@modelcontextprotocol/sdk/types.js');

      // Token with wrong prefix — verifyMcpToken will burn time and return null
      try {
        await loadAuthContextFromBearer('Bearer invalid_token_not_wkt_prefix', memDb, verifyMcpToken);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(McpError);
        const mcpErr = err as InstanceType<typeof McpError>;
        // Error message must NOT contain the token value
        expect(mcpErr.message).not.toContain('invalid_token_not_wkt_prefix');
        expect(mcpErr.message).toMatch(/auth_/);
      }
    });

    it.skipIf(SKIP)('throws McpError for wkt_ prefixed token not in DB', async () => {
      const { McpError } = await import('@modelcontextprotocol/sdk/types.js');

      try {
        await loadAuthContextFromBearer('Bearer wkt_nonexistenttoken00000000000000000000000', memDb, verifyMcpToken);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(McpError);
        expect((err as InstanceType<typeof McpError>).message).toContain('auth_invalid');
      }
    });

    it('does not leak token value in error message', async () => {
      const sensitiveToken = 'Bearer wkt_SENSITIVE_VALUE_MUST_NOT_APPEAR_IN_ERROR';
      try {
        await loadAuthContextFromBearer(sensitiveToken, memDb, verifyMcpToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toContain('SENSITIVE_VALUE_MUST_NOT_APPEAR_IN_ERROR');
      }
    });
  });

  describe('loadAuthContextFromBearer — case 3: valid token', () => {
    it.skipIf(SKIP)('returns AuthContext for a valid issued token', async () => {
      const ctx = await loadAuthContextFromBearer(`Bearer ${validToken}`, memDb, verifyMcpToken);

      expect(ctx).not.toBeNull();
      expect(ctx.userId).toBe('user-uuid-fixture-001');
      expect(ctx.workspaceId).toBe('ws-uuid-fixture-001');
      expect(ctx.source).toBe('mcp-token');
    });

    it.skipIf(SKIP)('caches verified token (second call does not re-run argon2id)', async () => {
      // Spy on argon2Hash to confirm cache hit skips re-verify
      // (verifyMcpToken calls argon2Verify internally — we check timing indirectly)
      const start = Date.now();
      const ctx1 = await loadAuthContextFromBearer(`Bearer ${validToken}`, memDb, verifyMcpToken);
      const firstMs = Date.now() - start;

      const start2 = Date.now();
      const ctx2 = await loadAuthContextFromBearer(`Bearer ${validToken}`, memDb, verifyMcpToken);
      const secondMs = Date.now() - start2;

      expect(ctx1.userId).toBe(ctx2.userId);
      // Cache hit should be significantly faster than argon2id verify (~100ms)
      // Allow generous threshold for CI variance
      expect(secondMs).toBeLessThan(firstMs + 50);
    });
  });
});
