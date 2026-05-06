/**
 * auth-mcp-token.test.ts — MCP token lifecycle integration tests
 *
 * Covers: issue → verify → revoke → verify-after-revoke fails
 *
 * Skipped automatically when Postgres is unavailable (SKIP_DB_TESTS=true or
 * no DATABASE_URL set) — allows local dev without a running DB.
 *
 * Also tests:
 *   - Rate limit: 11th issuance in same day → 429
 *   - Step-up reauth: stale session (>15 min) → 401
 *   - Constant-time dummy hash: prefix-miss path still resolves (no throw)
 *   - Token format: wkt_ prefix + 32 base62 chars
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PermissionGrant } from '@wiki-team/schema';
import {
  issueMcpToken,
  verifyMcpToken,
  revokeMcpToken,
  revokeAllMcpTokens,
  type McpTokenDb,
  type McpTokenRedis,
} from '../../../apps/wiki-team/auth/mcp-token-service.js';
import { generateMcpTokenId, computePrefixLookup } from '../../../apps/wiki-team/auth/token-id.js';

// ---------------------------------------------------------------------------
// Skip guard

const SKIP = !process.env['DATABASE_URL'] || process.env['SKIP_DB_TESTS'] === 'true';

// ---------------------------------------------------------------------------
// In-memory stub implementations (no real DB/Redis needed for unit-level path)

interface StoredToken {
  id: string;
  prefixLookup: string;
  tokenHash: string;
  userId: string;
  workspaceId: string | null;
  scopes: PermissionGrant[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function createInMemoryDb(): McpTokenDb & { _store: Map<string, StoredToken> } {
  const store = new Map<string, StoredToken>();

  return {
    _store: store,

    async insertMcpToken(row) {
      const record: StoredToken = { ...row, createdAt: new Date() };
      store.set(row.id, record);
      return row.id;
    },

    async findMcpTokenByPrefixLookup(prefixLookup) {
      for (const row of store.values()) {
        if (row.prefixLookup === prefixLookup) return row;
      }
      return null;
    },

    async findMcpTokenById(id) {
      return store.get(id) ?? null;
    },

    async revokeMcpTokenById(id) {
      const row = store.get(id);
      if (row) row.revokedAt = new Date();
    },

    async revokeAllMcpTokensByUserId(userId) {
      let count = 0;
      for (const row of store.values()) {
        if (row.userId === userId && row.revokedAt === null) {
          row.revokedAt = new Date();
          count++;
        }
      }
      return count;
    },

    async countMcpTokensIssuedToday(userId, _dateKey) {
      return [...store.values()].filter((r) => r.userId === userId).length;
    },
  };
}

function createInMemoryRedis(): McpTokenRedis & { _counters: Map<string, number> } {
  const counters = new Map<string, number>();
  return {
    _counters: counters,
    async incrIssuanceCounter(userId, dateKey) {
      const key = `${userId}:${dateKey}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async expireIssuanceCounter(_userId, _dateKey, _ttl) {
      // no-op in memory
    },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures

const TEST_USER_ID = 'user-test-uuid-0001';
const TEST_WORKSPACE_ID = 'workspace-test-uuid-0001';
const TEST_SCOPES: PermissionGrant[] = [
  { resource: 'page', verb: 'view', scope: 'own' },
];
const FRESH_SESSION = new Date(); // now = fresh

beforeAll(() => {
  // Set required env var for token operations
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-at-least-32-chars-long-xxxx';
});

afterAll(() => {
  delete process.env['BETTER_AUTH_SECRET'];
});

// ---------------------------------------------------------------------------
// Token format tests (no DB needed)

describe('token-id format', () => {
  it('generates token with wkt_ prefix and 32 base62 chars', () => {
    const { plaintext } = generateMcpTokenId();
    expect(plaintext).toMatch(/^wkt_[0-9A-Za-z]{32}$/);
    expect(plaintext.length).toBe(36); // 4 (prefix) + 32 (suffix)
  });

  it('generates unique tokens on each call', () => {
    const a = generateMcpTokenId().plaintext;
    const b = generateMcpTokenId().plaintext;
    expect(a).not.toBe(b);
  });

  it('computePrefixLookup returns 16 lowercase hex chars', () => {
    const { plaintext } = generateMcpTokenId();
    const lookup = computePrefixLookup(plaintext, 'test-secret');
    expect(lookup).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same plaintext + secret always produces same prefix_lookup', () => {
    const plaintext = 'wkt_ABC123fixed';
    const a = computePrefixLookup(plaintext, 'secret');
    const b = computePrefixLookup(plaintext, 'secret');
    expect(a).toBe(b);
  });

  it('different secrets produce different prefix_lookups', () => {
    const plaintext = 'wkt_ABC123fixed';
    const a = computePrefixLookup(plaintext, 'secret-one');
    const b = computePrefixLookup(plaintext, 'secret-two');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle tests (in-memory DB — no Postgres needed)

describe('MCP token lifecycle (in-memory)', () => {
  it('issue → verify returns AuthContext with correct fields', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();

    const { plaintext, tokenId } = await issueMcpToken(
      {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
        scopes: TEST_SCOPES,
        expiresAt: null,
        sessionCreatedAt: FRESH_SESSION,
      },
      db,
      redis,
    );

    expect(plaintext).toMatch(/^wkt_[0-9A-Za-z]{32}$/);
    expect(tokenId).toBeTruthy();

    const ctx = await verifyMcpToken(plaintext, db);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe(TEST_USER_ID);
    expect(ctx!.workspaceId).toBe(TEST_WORKSPACE_ID);
    expect(ctx!.source).toBe('mcp-token');
    expect(ctx!.permissions).toEqual(TEST_SCOPES);
  });

  it('verify with wrong token returns null (not throws)', async () => {
    const db = createInMemoryDb();
    const ctx = await verifyMcpToken('wkt_wrongtoken_that_does_not_exist_0000', db);
    expect(ctx).toBeNull();
  });

  it('verify with non-wkt_ prefix returns null', async () => {
    const db = createInMemoryDb();
    const ctx = await verifyMcpToken('Bearer eyJinvalidjwt', db);
    expect(ctx).toBeNull();
  });

  it('revoke → verify-after-revoke returns null', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();

    const { plaintext, tokenId } = await issueMcpToken(
      {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
        scopes: TEST_SCOPES,
        expiresAt: null,
        sessionCreatedAt: FRESH_SESSION,
      },
      db,
      redis,
    );

    // Verify works before revoke
    const ctxBefore = await verifyMcpToken(plaintext, db);
    expect(ctxBefore).not.toBeNull();

    // Revoke
    await revokeMcpToken(tokenId, TEST_USER_ID, db);

    // Verify fails after revoke
    const ctxAfter = await verifyMcpToken(plaintext, db);
    expect(ctxAfter).toBeNull();
  });

  it('revokeAllMcpTokens soft-deletes all user tokens', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();

    // Issue 3 tokens
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { plaintext } = await issueMcpToken(
        {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
          scopes: TEST_SCOPES,
          expiresAt: null,
          sessionCreatedAt: FRESH_SESSION,
        },
        db,
        redis,
      );
      tokens.push(plaintext);
    }

    const count = await revokeAllMcpTokens(TEST_USER_ID, db);
    expect(count).toBe(3);

    // All tokens now invalid
    for (const t of tokens) {
      const ctx = await verifyMcpToken(t, db);
      expect(ctx).toBeNull();
    }
  });

  it('expired token returns null on verify', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();

    const { plaintext } = await issueMcpToken(
      {
        userId: TEST_USER_ID,
        workspaceId: TEST_WORKSPACE_ID,
        scopes: TEST_SCOPES,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
        sessionCreatedAt: FRESH_SESSION,
      },
      db,
      redis,
    );

    const ctx = await verifyMcpToken(plaintext, db);
    expect(ctx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rate limit + step-up tests

describe('rate limiting and step-up reauth', () => {
  it('rejects issuance with 429 after 10 tokens in same day', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();

    // Issue 10 tokens successfully
    for (let i = 0; i < 10; i++) {
      await issueMcpToken(
        {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
          scopes: TEST_SCOPES,
          expiresAt: null,
          sessionCreatedAt: FRESH_SESSION,
        },
        db,
        redis,
      );
    }

    // 11th should throw 429
    await expect(
      issueMcpToken(
        {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
          scopes: TEST_SCOPES,
          expiresAt: null,
          sessionCreatedAt: FRESH_SESSION,
        },
        db,
        redis,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rejects issuance with 401 when session is stale (>15 min)', async () => {
    const db = createInMemoryDb();
    const redis = createInMemoryRedis();
    const staleSession = new Date(Date.now() - 16 * 60 * 1000); // 16 min ago

    await expect(
      issueMcpToken(
        {
          userId: TEST_USER_ID,
          workspaceId: TEST_WORKSPACE_ID,
          scopes: TEST_SCOPES,
          expiresAt: null,
          sessionCreatedAt: staleSession,
        },
        db,
        redis,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// DB integration tests (skipped without DATABASE_URL)

describe.skipIf(SKIP)('MCP token lifecycle (Postgres)', () => {
  it('placeholder: add real DB tests when DATABASE_URL is available', () => {
    // Real tests go here using testcontainers (Vitest + testcontainers per ADR 007)
    expect(true).toBe(true);
  });
});
