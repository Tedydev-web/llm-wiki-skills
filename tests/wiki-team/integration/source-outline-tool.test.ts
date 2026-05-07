/**
 * source-outline-tool.test.ts — Integration tests for material.get_source_outline MCP tool (P07)
 *
 * Mocks: MinIO (object-store), DB, RBAC scope filter, pdf-extract.
 * Uses real defineTool + real evaluatePolicy for RBAC denial path.
 *
 * Covers:
 *   - Input validation (non-UUID, missing fields)
 *   - RBAC denial (cross-workspace context)
 *   - MATERIAL_NOT_FOUND error
 *   - MATERIAL_NOT_READY error
 *   - Happy path: markdown text → outline tree returned
 *   - Output shape: outline array, materialId, fileName
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Constants shared across mocks

const TEST_WID = '00000000-0000-0000-0000-000000000001';
const TEST_MID = '00000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// vi.hoisted — mockLimit + fixtures must be created inside hoisted callback
// because vi.mock factories are hoisted above all top-level const declarations.

// All hoisted values must live in vi.hoisted() — vi.mock factories are
// moved to the top of the file by Vitest's transformer, so top-level consts
// are NOT yet initialized when mock factories run.
const { mockLimit, COMPLETED_MATERIAL, PENDING_MATERIAL, mockDownload } = vi.hoisted(() => {
  const MID = '00000000-0000-0000-0000-000000000002';
  const WID = '00000000-0000-0000-0000-000000000001';
  const base = {
    id: MID,
    workspaceId: WID,
    fileName: 'report.md',
    mimeType: 'text/markdown',
    status: 'completed',
    storageKey: 'materials/test/report.md',
    pageCount: 1,
  };
  const markdownText = [
    '# Annual Report',
    '',
    '## Executive Summary',
    '',
    'This section covers the highlights.',
    '',
    '## Financial Overview',
    '',
    '### Revenue',
    '',
    'Details here.',
  ].join('\n');
  return {
    mockLimit: vi.fn().mockResolvedValue([base]),
    COMPLETED_MATERIAL: base,
    PENDING_MATERIAL: { ...base, status: 'pending' },
    mockDownload: vi.fn().mockResolvedValue(Buffer.from(markdownText, 'utf-8')),
  };
});

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from:   vi.fn().mockReturnThis(),
    where:  vi.fn().mockReturnThis(),
    limit:  mockLimit,
  };
  return {
    getDb: () => chain,
    schema: {
      materials: {
        id: 'materials.id',
        workspaceId: 'materials.workspace_id',
        storageKey: 'materials.storage_key',
        status: 'materials.status',
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Object-store mock — download returns markdown text with headings

vi.mock('../../../apps/wiki-team/storage/object-store.js', () => ({
  getObjectStore: () => ({
    download: mockDownload,
  }),
}));

// ---------------------------------------------------------------------------
// pdf-extract mock — not needed for markdown but must not throw if imported

vi.mock('@wiki-team/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue('PDF text'),
}));

// ---------------------------------------------------------------------------
// RBAC — real evaluatePolicy; stub compileScopeFilter to return undefined (no-op SQL fragment)

vi.mock('../../../apps/wiki-team/rbac/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/wiki-team/rbac/index.js')>();
  return {
    ...original,
    compileScopeFilter: vi.fn().mockReturnValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// error-mapper — rethrow so tests can inspect errors

vi.mock('@wiki-team/mcp/error-mapper', async (importOriginal) => {
  const original = await importOriginal<typeof import('@wiki-team/mcp/error-mapper')>();
  return {
    ...original,
    wrapToolError: vi.fn().mockImplementation((err: unknown) => { throw err; }),
  };
});

// ---------------------------------------------------------------------------
// Imports AFTER mocks

import { buildGetSourceOutlineTool } from '../../../apps/wiki-team/mcp-host/tools/get-source-outline.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Context factories

function makeViewerCtx(): AuthContext {
  return {
    userId: 'viewer-001',
    workspaceId: TEST_WID,
    membershipTier: 'observer',
    permissions: [{ resource: 'kb', verb: 'view', scope: 'own' }],
    source: 'mcp-token',
  } as unknown as AuthContext;
}

function makeCrossWorkspaceCtx(): AuthContext {
  return {
    userId: 'outsider-001',
    workspaceId: '00000000-0000-0000-0000-000000000099',
    membershipTier: 'observer',
    permissions: [],
    source: 'mcp-token',
  } as unknown as AuthContext;
}

// ---------------------------------------------------------------------------
// Result helpers

interface McpOkResult { content: Array<{ type: string; text: string }> }
interface McpErrorResult { isError: true; content: Array<{ type: string; text: string }> }

function parseOk(r: McpOkResult): unknown {
  return JSON.parse(r.content[0]!.text);
}

function isErrorResult(r: unknown): r is McpErrorResult {
  return typeof r === 'object' && r !== null && 'isError' in r && (r as McpErrorResult).isError === true;
}

// ---------------------------------------------------------------------------
// Tests

describe('material.get_source_outline', () => {
  it('input: non-UUID materialId → isError result', async () => {
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const result = await tool.mcpHandler({ materialId: 'not-a-uuid', workspaceId: TEST_WID });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: non-UUID workspaceId → isError result', async () => {
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const result = await tool.mcpHandler({ materialId: TEST_MID, workspaceId: 'bad' });
    expect(isErrorResult(result)).toBe(true);
  });

  it('input: missing materialId → isError result', async () => {
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const result = await tool.mcpHandler({ workspaceId: TEST_WID });
    expect(isErrorResult(result)).toBe(true);
  });

  it('rbac: cross-workspace ctx → throws permission denied', async () => {
    const tool = buildGetSourceOutlineTool(makeCrossWorkspaceCtx());
    await expect(
      tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }),
    ).rejects.toThrow();
  });

  it('MATERIAL_NOT_FOUND: DB returns empty → throws McpError', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    await expect(
      tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }),
    ).rejects.toThrow('MATERIAL_NOT_FOUND');
  });

  it('MATERIAL_NOT_READY: pending status → throws McpError', async () => {
    mockLimit.mockResolvedValueOnce([PENDING_MATERIAL]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    await expect(
      tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }),
    ).rejects.toThrow('MATERIAL_NOT_READY');
  });

  it('happy path: markdown text returns outline array', async () => {
    mockLimit.mockResolvedValueOnce([COMPLETED_MATERIAL]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }) as McpOkResult;
    expect(isErrorResult(raw)).toBe(false);
    const result = parseOk(raw) as { outline: unknown[]; materialId: string; fileName: string };
    expect(Array.isArray(result.outline)).toBe(true);
    expect(result.materialId).toBe(TEST_MID);
    expect(result.fileName).toBe('report.md');
  });

  it('happy path: outline tree has correct root heading (h1 = Annual Report)', async () => {
    mockLimit.mockResolvedValueOnce([COMPLETED_MATERIAL]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }) as McpOkResult;
    const result = parseOk(raw) as {
      outline: Array<{ level: number; text: string; children: unknown[] }>;
    };
    const root = result.outline[0]!;
    expect(root.level).toBe(1);
    expect(root.text).toBe('Annual Report');
    // h2s nested under h1
    expect(root.children.length).toBeGreaterThanOrEqual(2);
  });

  it('happy path: h3 Revenue is nested under h2 Financial Overview', async () => {
    mockLimit.mockResolvedValueOnce([COMPLETED_MATERIAL]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }) as McpOkResult;
    const result = parseOk(raw) as {
      outline: Array<{
        level: number; text: string;
        children: Array<{ level: number; text: string; children: Array<{ level: number; text: string }> }>;
      }>;
    };
    const root = result.outline[0]!;
    const financial = root.children.find((c) => c.text === 'Financial Overview');
    expect(financial).toBeDefined();
    const revenue = financial!.children.find((c) => c.text === 'Revenue');
    expect(revenue).toBeDefined();
    expect(revenue!.level).toBe(3);
  });

  it('output: each OutlineNode has level, text, charOffset, pageNumber, children', async () => {
    mockLimit.mockResolvedValueOnce([COMPLETED_MATERIAL]);
    const tool = buildGetSourceOutlineTool(makeViewerCtx());
    const raw = await tool.mcpHandler({ materialId: TEST_MID, workspaceId: TEST_WID }) as McpOkResult;
    const result = parseOk(raw) as {
      outline: Array<{ level: number; text: string; charOffset: number; pageNumber: number | null; children: unknown[] }>;
    };
    const node = result.outline[0]!;
    expect(typeof node.level).toBe('number');
    expect(typeof node.text).toBe('string');
    expect(typeof node.charOffset).toBe('number');
    expect(node.pageNumber === null || typeof node.pageNumber === 'number').toBe(true);
    expect(Array.isArray(node.children)).toBe(true);
  });
});
