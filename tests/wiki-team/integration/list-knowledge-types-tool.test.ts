/**
 * list-knowledge-types-tool.test.ts — MCP tool contract tests for P02 tools (ADR 014)
 *
 * Covers:
 *   - wiki.list_knowledge_types: input validation, RBAC denial, output shape
 *   - wiki.get_knowledge_type_docs: input validation, RBAC denial, output fields
 *
 * Uses real defineTool (mcpHandler returns { isError, content } for Zod fails,
 * throws for runtime/RBAC errors). DB mocked, real evaluatePolicy used.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — execute() returns RowList (plain array); ORM chain terminates at limit()

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const kindRows = [
    { slug: 'analysis', display_name: 'Analysis', color: '#3b82f6', description: null },
    { slug: 'fact',     display_name: 'Fact',     color: '#ef4444', description: 'Core facts' },
    { slug: 'procedure', display_name: 'Procedure', color: '#22c55e', description: null },
    { slug: 'reference', display_name: 'Reference', color: '#a855f7', description: null },
  ];

  // ORM chain for get_knowledge_type_docs:
  //   page query:  .select().from().where().orderBy().limit().offset() → []
  //   count query: .select().from().where() — chain is thenable (resolves to [])
  // Chain must be thenable so Promise.all([pageQuery, countQuery]) resolves both branches.
  const baseChain = Promise.resolve([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = baseChain as any;
  const ret = () => chain;
  chain['select']  = vi.fn(ret);
  chain['from']    = vi.fn(ret);
  chain['where']   = vi.fn(ret);
  chain['orderBy'] = vi.fn(ret);
  chain['limit']   = vi.fn(ret);
  chain['offset']  = vi.fn().mockResolvedValue([]);
  // execute() — called by list_knowledge_types via raw db.execute(sql`...`)
  chain['execute'] = vi.fn().mockResolvedValue(kindRows);

  return {
    getDb: () => chain,
    schema: {
      notes: {
        id: 'notes.id', workspaceId: 'notes.workspace_id',
        taxonomy: 'notes.taxonomy', deletedAt: 'notes.deleted_at',
        slug: 'notes.slug', title: 'notes.title',
        content: 'notes.content', updatedAt: 'notes.updated_at',
      },
    },
    sql: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// RBAC — use real evaluatePolicy (deny = empty permissions); stub compileScopeFilter

vi.mock('../../../apps/wiki-team/rbac/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/wiki-team/rbac/index.js')>();
  return {
    ...original,
    compileScopeFilter: vi.fn().mockReturnValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// error-mapper — stub only wrapToolError (throwIfDenied stays real via rbac mock)

vi.mock('@wiki-team/mcp/error-mapper', async (importOriginal) => {
  const original = await importOriginal<typeof import('@wiki-team/mcp/error-mapper')>();
  return {
    ...original,
    // wrapToolError: rethrow so tests can inspect
    wrapToolError: vi.fn().mockImplementation((err: unknown) => { throw err; }),
  };
});

// ---------------------------------------------------------------------------
// Import tools AFTER mocks (no defineTool mock — use real implementation)

import { buildListKnowledgeTypesTool } from '../../../apps/wiki-team/mcp-host/tools/list-knowledge-types.js';
import { buildGetKnowledgeTypeDocsTool } from '../../../apps/wiki-team/mcp-host/tools/get-knowledge-type-docs.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Context factories

const TEST_WID = '00000000-0000-0000-0000-000000000001';

function makeViewerCtx(): AuthContext {
  return {
    userId: 'viewer-001',
    workspaceId: TEST_WID,
    membershipTier: 'observer',
    permissions: [{ resource: 'kb', verb: 'view', scope: 'own' }],
    source: 'mcp-token',
  } as unknown as AuthContext;
}

/** Ctx bound to a DIFFERENT workspace — triggers workspace-mismatch deny in evaluatePolicy Realm 2 */
function makeCrossWorkspaceCtx(): AuthContext {
  return {
    userId: 'outsider-001',
    workspaceId: '00000000-0000-0000-0000-000000000099',  // different workspace
    membershipTier: 'observer',
    permissions: [],
    source: 'mcp-token',
  } as unknown as AuthContext;
}

// ---------------------------------------------------------------------------
// Helpers: decode mcpHandler CallToolResult

interface MpcErrorResult { isError: true; content: Array<{ type: string; text: string }> }
interface McpOkResult { content: Array<{ type: string; text: string }> }

function parseOkResult(result: McpOkResult): unknown {
  return JSON.parse(result.content[0]!.text);
}

function isErrorResult(r: unknown): r is MpcErrorResult {
  return typeof r === 'object' && r !== null && 'isError' in r && (r as MpcErrorResult).isError === true;
}

// ---------------------------------------------------------------------------
// wiki.list_knowledge_types

describe('wiki.list_knowledge_types', () => {
  it('input: non-UUID workspaceId → isError result', async () => {
    const tool = buildListKnowledgeTypesTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: 'not-a-uuid' });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: missing workspaceId → isError result', async () => {
    const tool = buildListKnowledgeTypesTool(makeViewerCtx());
    const result = await tool.mcpHandler({});
    expect(isErrorResult(result)).toBe(true);
  });

  it('rbac: no-grants ctx → throws (permission denied)', async () => {
    const tool = buildListKnowledgeTypesTool(makeCrossWorkspaceCtx());
    await expect(tool.mcpHandler({ workspaceId: TEST_WID })).rejects.toThrow();
  });

  it('output: returns kinds array and total for viewer', async () => {
    const tool = buildListKnowledgeTypesTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ workspaceId: TEST_WID }) as McpOkResult;
    expect(isErrorResult(raw)).toBe(false);
    const result = parseOkResult(raw) as { kinds: unknown[]; total: number };
    expect(Array.isArray(result.kinds)).toBe(true);
    expect(typeof result.total).toBe('number');
    expect(result.total).toBe(result.kinds.length);
  });

  it('output: each kind has slug, label, color (#rrggbb), description', async () => {
    const tool = buildListKnowledgeTypesTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ workspaceId: TEST_WID }) as McpOkResult;
    const result = parseOkResult(raw) as {
      kinds: Array<{ slug: string; label: string; color: string; description: string | null }>;
    };
    // Mocked DB returns 4 rows
    expect(result.kinds.length).toBe(4);
    for (const k of result.kinds) {
      expect(typeof k.slug).toBe('string');
      expect(typeof k.label).toBe('string');
      expect(k.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// wiki.get_knowledge_type_docs

describe('wiki.get_knowledge_type_docs', () => {
  it('input: empty kindSlug → isError result', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: '' });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: kindSlug > 32 chars → isError result', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: 'a'.repeat(33) });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: limit > 50 → isError result', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: 'fact', limit: 51 });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: negative offset → isError result', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: 'fact', offset: -1 });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: non-UUID workspaceId → isError result', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: 'bad-id', kindSlug: 'fact' });
    expect(isErrorResult(result)).toBe(true);
  });

  it('rbac: no-grants ctx → throws (permission denied)', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeCrossWorkspaceCtx());
    await expect(
      tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: 'fact' }),
    ).rejects.toThrow();
  });

  it('output: valid input returns docs/total/kindSlug/hasMore fields', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const raw = await tool.mcpHandler({
      workspaceId: TEST_WID, kindSlug: 'fact', limit: 10, offset: 0,
    }) as McpOkResult;
    expect(isErrorResult(raw)).toBe(false);
    const result = parseOkResult(raw) as {
      docs: unknown[]; total: number; kindSlug: string; hasMore: boolean;
    };
    expect(result.kindSlug).toBe('fact');
    expect(Array.isArray(result.docs)).toBe(true);
    expect(typeof result.total).toBe('number');
    expect(typeof result.hasMore).toBe('boolean');
  });

  it('pagination: Zod defaults (limit=25, offset=0) applied without error', async () => {
    const tool = buildGetKnowledgeTypeDocsTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ workspaceId: TEST_WID, kindSlug: 'fact' }) as McpOkResult;
    expect(isErrorResult(raw)).toBe(false);
    const result = parseOkResult(raw) as { kindSlug: string };
    expect(result.kindSlug).toBe('fact');
  });
});
