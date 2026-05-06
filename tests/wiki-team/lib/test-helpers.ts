/**
 * test-helpers.ts — shared test utilities for wiki-team integration tests
 *
 * Provides: workspace/user/token seed helpers, mock LLM response builder,
 * and cleanup utilities. All functions are async + safe to call in beforeAll/afterAll.
 *
 * DB parameter type is `any` — avoids importing Drizzle in unit test contexts
 * where DB is never instantiated. Typed as unknown at call site.
 */

import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types

export interface TestWorkspace {
  id: string;
  name: string;
  ownerId: string;
  cleanup: () => Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
  cleanup: () => Promise<void>;
}

export interface TestMcpToken {
  /** Plaintext token — use this in test HTTP headers */
  plaintext: string;
  /** Row ID in the DB */
  tokenId: string;
  cleanup: () => Promise<void>;
}

export interface MockToolCall {
  name: string;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
}

// ---------------------------------------------------------------------------
// createTestUser — insert a deterministic test user row

export async function createTestUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  overrides: Partial<{ email: string; name: string }> = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = overrides.email ?? `test-${id.slice(0, 8)}@example.test`;
  const name = overrides.name ?? `Test User ${id.slice(0, 6)}`;

  await db.execute(
    `INSERT INTO users (id, email, name, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, email, name],
  );

  return {
    id,
    email,
    cleanup: async () => {
      await db.execute(`DELETE FROM users WHERE id = $1`, [id]);
    },
  };
}

// ---------------------------------------------------------------------------
// createTestWorkspace — insert workspace + membership row

export async function createTestWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  ownerId: string,
  overrides: Partial<{ name: string }> = {},
): Promise<TestWorkspace> {
  const id = randomUUID();
  const name = overrides.name ?? `Test Workspace ${id.slice(0, 6)}`;

  await db.execute(
    `INSERT INTO workspaces (id, name, owner_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, name, ownerId],
  );

  // Insert owner membership
  await db.execute(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, 'owner', NOW())
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [id, ownerId],
  );

  return {
    id,
    name,
    ownerId,
    cleanup: async () => {
      await db.execute(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [id]);
      await db.execute(`DELETE FROM workspaces WHERE id = $1`, [id]);
    },
  };
}

// ---------------------------------------------------------------------------
// createTestMcpToken — insert hashed token + return plaintext

export async function createTestMcpToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  scopes: string[] = ['kb:view', 'page:view'],
): Promise<TestMcpToken> {
  const tokenId = randomUUID();
  // Plaintext is random bytes — never stored
  const plaintext = `mcp_test_${randomUUID().replace(/-/g, '')}`;
  const hashed = createHash('sha256').update(plaintext).digest('hex');

  await db.execute(
    `INSERT INTO mcp_tokens (id, user_id, token_hash, scopes, created_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '24 hours')
     ON CONFLICT (id) DO NOTHING`,
    [tokenId, userId, hashed, JSON.stringify(scopes)],
  );

  return {
    plaintext,
    tokenId,
    cleanup: async () => {
      await db.execute(`DELETE FROM mcp_tokens WHERE id = $1`, [tokenId]);
    },
  };
}

// ---------------------------------------------------------------------------
// mockLlmResponse — build a canned Anthropic response for agent-loop tests

/**
 * Returns a vi.fn() that cycles through the supplied tool-call sequences,
 * returning each as a fake Anthropic messages.create response.
 *
 * Usage in test:
 *   const mockCreate = mockLlmResponse([
 *     [{ name: 'listCatalog', id: 'tc_001', input: { workspaceId: 'ws-1', kbId: 'kb-1' } }],
 *     [{ name: 'complete', id: 'tc_002', input: { summary: 'done', notesCreated: [] } }],
 *   ]);
 */
export function mockLlmResponse(turnsOfToolCalls: MockToolCall[][]): ReturnType<typeof vi.fn> {
  let callIndex = 0;

  return vi.fn().mockImplementation(async () => {
    const turn = turnsOfToolCalls[callIndex] ?? turnsOfToolCalls[turnsOfToolCalls.length - 1];
    callIndex++;

    return {
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: turn.map((tc) => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// cleanupAll — truncate test tables (call in afterAll for integration suites)

export async function cleanupAll(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tables: string[] = [
    'mcp_tokens',
    'workspace_memberships',
    'workspaces',
    'users',
  ],
): Promise<void> {
  for (const table of tables) {
    await db.execute(`TRUNCATE TABLE ${table} CASCADE`);
  }
}
