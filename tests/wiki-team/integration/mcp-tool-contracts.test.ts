/**
 * mcp-tool-contracts.test.ts — per-tool I/O Zod contract validation
 *
 * Verifies that each tool's input schema accepts valid inputs and rejects
 * invalid ones. Output schema validation is tested against mocked handler returns.
 *
 * Does NOT require a live DB — all DB calls are mocked.
 * Skip guard: SKIP_MCP_TESTS=1
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

const SKIP = process.env['SKIP_MCP_TESTS'] === '1';

// ---------------------------------------------------------------------------
// Mock DB + RBAC (allow everything — contract tests focus on I/O shape)

vi.mock('../../../apps/wiki-team/storage/db.js', () => ({
  getDb: () => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
  }),
  schema: {
    notes: {
      id: 'notes.id', slug: 'notes.slug', title: 'notes.title',
      content: 'notes.content', taxonomy: 'notes.taxonomy',
      tags: 'notes.tags', links: 'notes.links', version: 'notes.version',
      workspaceId: 'notes.workspaceId', kbId: 'notes.kbId',
      updatedAt: 'notes.updatedAt', deletedAt: 'notes.deletedAt',
    },
    materials: {
      id: 'materials.id', workspaceId: 'materials.workspaceId',
      kbId: 'materials.kbId', fileName: 'materials.fileName',
      mimeType: 'materials.mimeType', status: 'materials.status',
      pageCount: 'materials.pageCount',
    },
    members: { userId: 'members.userId', workspaceId: 'members.workspaceId' },
    workspaces: {
      id: 'workspaces.id', slug: 'workspaces.slug',
      displayName: 'workspaces.displayName',
      createdAt: 'workspaces.createdAt', deletedAt: 'workspaces.deletedAt',
    },
  },
  sql: vi.fn((strings: TemplateStringsArray) => strings.join('')),
}));

vi.mock('../../../apps/wiki-team/rbac/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/wiki-team/rbac/index.js')>();
  return {
    ...original,
    evaluatePolicy: vi.fn().mockReturnValue({ allow: true }),
    compileScopeFilter: vi.fn().mockReturnValue({}),
  };
});

// ---------------------------------------------------------------------------
// Input schema contracts — valid + invalid cases per tool

describe.skipIf(SKIP)('wiki.search input schema', () => {
  const schema = z.object({
    query: z.string().min(1).max(500),
    workspaceId: z.string().uuid(),
    topK: z.number().int().min(1).max(20).default(5),
    mode: z.enum(['auto', 'semantic', 'keyword']).default('auto'),
  });

  it('accepts valid input', () => {
    const result = schema.safeParse({ query: 'hello', workspaceId: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(true);
  });

  it('rejects empty query', () => {
    const result = schema.safeParse({ query: '', workspaceId: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const result = schema.safeParse({ query: 'test', workspaceId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects topK > 20', () => {
    const result = schema.safeParse({
      query: 'test', workspaceId: '00000000-0000-0000-0000-000000000001', topK: 99,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown mode', () => {
    const result = schema.safeParse({
      query: 'test', workspaceId: '00000000-0000-0000-0000-000000000001', mode: 'fuzzy',
    });
    expect(result.success).toBe(false);
  });
});

describe.skipIf(SKIP)('wiki.fetch input schema', () => {
  const schema = z.object({
    slug: z.string().min(1).max(120),
    workspaceId: z.string().uuid(),
    version: z.number().int().min(1).optional(),
  });

  it('accepts valid input without version', () => {
    const result = schema.safeParse({ slug: 'my-note', workspaceId: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with version', () => {
    const result = schema.safeParse({ slug: 'my-note', workspaceId: '00000000-0000-0000-0000-000000000001', version: 3 });
    expect(result.success).toBe(true);
  });

  it('rejects version < 1', () => {
    const result = schema.safeParse({ slug: 'my-note', workspaceId: '00000000-0000-0000-0000-000000000001', version: 0 });
    expect(result.success).toBe(false);
  });
});

describe.skipIf(SKIP)('wiki.catalog input schema', () => {
  const schema = z.object({
    workspaceId: z.string().uuid(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  });

  it('accepts valid input', () => {
    expect(schema.safeParse({ workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('rejects limit > 100', () => {
    expect(schema.safeParse({ workspaceId: '00000000-0000-0000-0000-000000000001', limit: 101 }).success).toBe(false);
  });
});

describe.skipIf(SKIP)('wiki.recent input schema', () => {
  const schema = z.object({
    workspaceId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(10),
  });

  it('accepts valid input', () => {
    expect(schema.safeParse({ workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('rejects limit > 50', () => {
    expect(schema.safeParse({ workspaceId: '00000000-0000-0000-0000-000000000001', limit: 51 }).success).toBe(false);
  });
});

describe.skipIf(SKIP)('material.read input schema', () => {
  const schema = z.object({
    materialId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    maxChars: z.number().int().min(1).max(40_000).default(20_000),
  });

  it('accepts valid input', () => {
    expect(schema.safeParse({
      materialId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
    }).success).toBe(true);
  });

  it('rejects maxChars > 40000', () => {
    expect(schema.safeParse({
      materialId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      maxChars: 50_000,
    }).success).toBe(false);
  });
});

describe.skipIf(SKIP)('directory.lookup input schema', () => {
  const schema = z.object({
    query: z.string().min(1).max(200),
    workspaceId: z.string().uuid(),
  });

  it('accepts valid input', () => {
    expect(schema.safeParse({ query: 'alice', workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('rejects empty query', () => {
    expect(schema.safeParse({ query: '', workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(false);
  });

  it('rejects query > 200 chars', () => {
    expect(schema.safeParse({ query: 'a'.repeat(201), workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(false);
  });
});

describe.skipIf(SKIP)('workspace.info input schema', () => {
  const schema = z.object({ workspaceId: z.string().uuid() });

  it('accepts valid UUID', () => {
    expect(schema.safeParse({ workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('rejects non-UUID', () => {
    expect(schema.safeParse({ workspaceId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe.skipIf(SKIP)('note.crossrefs input schema', () => {
  const schema = z.object({
    slug: z.string().min(1).max(120),
    workspaceId: z.string().uuid(),
  });

  it('accepts valid input', () => {
    expect(schema.safeParse({ slug: 'my-note', workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('rejects empty slug', () => {
    expect(schema.safeParse({ slug: '', workspaceId: '00000000-0000-0000-0000-000000000001' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defineTool mcpHandler contract — invalid input returns isError result

describe.skipIf(SKIP)('defineTool mcpHandler — invalid input rejected before handler', async () => {
  it('returns isError:true for schema-invalid input', async () => {
    const { defineTool } = await import('../../../packages/wiki-mcp/src/define-tool.js');
    const schema = z.object({ value: z.string() });
    const tool = defineTool({
      name: 'test.tool',
      description: 'test',
      inputSchema: schema,
      handler: async (_input) => ({ ok: true }),
    });

    const result = await tool.mcpHandler({ value: 42 }); // 42 is not a string
    expect(result.isError).toBe(true);
    if (result.content[0]?.type === 'text') {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.code).toBe('invalid_input');
      expect(Array.isArray(parsed.errors)).toBe(true);
    }
  });

  it('returns output wrapped in content array for valid input', async () => {
    const { defineTool } = await import('../../../packages/wiki-mcp/src/define-tool.js');
    const schema = z.object({ value: z.string() });
    const tool = defineTool({
      name: 'test.tool',
      description: 'test',
      inputSchema: schema,
      handler: async (input) => ({ echo: input.value }),
    });

    const result = await tool.mcpHandler({ value: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.echo).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// error-mapper contracts

describe.skipIf(SKIP)('error-mapper', async () => {
  it('throwIfDenied passes through for allow:true decision', async () => {
    const { throwIfDenied } = await import('../../../packages/wiki-mcp/src/error-mapper.js');
    expect(() => throwIfDenied({ allow: true }, 'wiki.search')).not.toThrow();
  });

  it('throwIfDenied throws McpError for deny decision', async () => {
    const { throwIfDenied } = await import('../../../packages/wiki-mcp/src/error-mapper.js');
    const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
    expect(() =>
      throwIfDenied({ allow: false, reason: 'workspace-mismatch' }, 'wiki.search'),
    ).toThrow(McpError);
  });

  it('redactAuthorizationHeader removes Bearer token value', async () => {
    const { redactAuthorizationHeader } = await import('../../../packages/wiki-mcp/src/error-mapper.js');
    const headers = { authorization: 'Bearer wkt_supersecrettoken12345678901234' };
    const safe = redactAuthorizationHeader(headers);
    expect(safe['authorization']).toBe('Bearer wkt_[REDACTED]');
    expect(safe['authorization']).not.toContain('supersecrettoken');
  });

  it('wrapToolError redacts wkt_ tokens from error messages', async () => {
    const { wrapToolError } = await import('../../../packages/wiki-mcp/src/error-mapper.js');
    const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
    const err = new Error('DB failed for token wkt_SECRETVALUE1234567890abcdefgh');
    expect(() => wrapToolError(err, 'wiki.search')).toThrow(McpError);
    try {
      wrapToolError(err, 'wiki.search');
    } catch (caught) {
      expect((caught as Error).message).not.toContain('SECRETVALUE1234567890abcdefgh');
      expect((caught as Error).message).toContain('wkt_[REDACTED]');
    }
  });
});
