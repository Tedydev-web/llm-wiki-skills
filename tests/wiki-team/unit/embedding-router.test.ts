/**
 * embedding-router.test.ts — unit tests for pure functions in embedding-router.
 *
 * Tests:
 *   1. escapeILike correctly escapes %, _, \ (injection guard)
 *   2. getDimColumn returns correct column name per dim
 *   3. embedNote throws EMBEDDING_PROVIDER_NOT_CONFIGURED when no provider row
 *   4. embedNote throws on unexpected dimension returned by provider
 *   5. embedNote returns correct EmbedResult shape when provider succeeds
 *
 * Tests 3–5 use vi.mock for DB and provider-key-encryption. ProviderFactory is
 * mocked via its resolved file path so Vitest can intercept it without needing
 * the @wiki-team/shared workspace alias in the test runner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any import resolution

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ..._v: unknown[]) => ({ text: String(strings) }),
    { raw: (s: string) => s },
  );
  return { getDb: vi.fn(), schema: { providerSettings: {} }, sql: sqlFn };
});

vi.mock('../../../apps/wiki-team/services/provider-key-encryption.js', () => ({
  decryptApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// Intercept ProviderFactory via file path (same module Vitest will cache after resolving
// @wiki-team/shared/providers → packages/wiki-shared/src/providers/index.ts)
vi.mock('../../../packages/wiki-shared/src/providers/provider-factory.js', () => ({
  ProviderFactory: { getEmbedding: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock hoisting)

import {
  escapeILike,
  getDimColumn,
  embedNote,
} from '../../../apps/wiki-team/services/embedding-router.js';
import { getDb } from '../../../apps/wiki-team/storage/db.js';

// ---------------------------------------------------------------------------
// 1. escapeILike — injection guard

describe('escapeILike', () => {
  it('escapes % to \\%', () => {
    expect(escapeILike('100%')).toBe('100\\%');
  });

  it('escapes _ to \\_', () => {
    expect(escapeILike('user_name')).toBe('user\\_name');
  });

  it('escapes \\ to \\\\', () => {
    expect(escapeILike('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes all three special chars in one string', () => {
    expect(escapeILike('50% off_sale\\')).toBe('50\\% off\\_sale\\\\');
  });

  it('passes through normal text unchanged', () => {
    expect(escapeILike('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeILike('')).toBe('');
  });

  it('handles string with only special chars', () => {
    expect(escapeILike('%_\\')).toBe('\\%\\_\\\\');
  });
});

// ---------------------------------------------------------------------------
// 2. getDimColumn

describe('getDimColumn', () => {
  it('returns embedding_768 for dim 768', () => {
    expect(getDimColumn(768)).toBe('embedding_768');
  });

  it('returns embedding_1024 for dim 1024', () => {
    expect(getDimColumn(1024)).toBe('embedding_1024');
  });

  it('returns embedding_1536 for dim 1536', () => {
    expect(getDimColumn(1536)).toBe('embedding_1536');
  });
});

// ---------------------------------------------------------------------------
// 3. embedNote — EMBEDDING_PROVIDER_NOT_CONFIGURED

describe('embedNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws EMBEDDING_PROVIDER_NOT_CONFIGURED when no provider row exists', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    await expect(embedNote('ws-id', 'test text')).rejects.toMatchObject({
      message: 'EMBEDDING_PROVIDER_NOT_CONFIGURED',
    });
  });

  // -------------------------------------------------------------------------
  // 4 & 5. embedNote with ProviderFactory mocked via file-path mock

  it('calls ProviderFactory.getEmbedding and returns correct EmbedResult shape', async () => {
    const fakeRow = {
      vendor: 'google',
      model: 'text-embedding-004',
      apiKeyEncrypted: 'enc-hex',
      encryptionMetadata: { saltHex: '', ivHex: '', rotationEpoch: 0, info: '' },
      updatedAt: new Date(),
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([fakeRow]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    // Import the mocked ProviderFactory via the resolved file path
    const { ProviderFactory: MockFactory } = await import(
      '../../../packages/wiki-shared/src/providers/provider-factory.js'
    );
    vi.mocked(MockFactory.getEmbedding).mockReturnValue({
      embed: vi.fn().mockResolvedValue({
        vectors: [Array(768).fill(0.1)],
        dimensions: 768,
        costUsd: 0,
      }),
    } as never);

    const result = await embedNote('ws-id', 'test text');

    expect(MockFactory.getEmbedding).toHaveBeenCalledWith('google', {
      apiKey: 'test-api-key',
      model: 'text-embedding-004',
    });
    expect(result.dim).toBe(768);
    expect(result.provider).toBe('google');
    expect(result.vector).toHaveLength(768);
  });

  it('throws when provider returns unexpected dimension (not 768|1024|1536)', async () => {
    const fakeRow = {
      vendor: 'openai',
      model: 'text-embedding-3-small',
      apiKeyEncrypted: 'enc-hex',
      encryptionMetadata: { saltHex: '', ivHex: '', rotationEpoch: 0, info: '' },
      updatedAt: new Date(),
    };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([fakeRow]),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { ProviderFactory: MockFactory } = await import(
      '../../../packages/wiki-shared/src/providers/provider-factory.js'
    );
    vi.mocked(MockFactory.getEmbedding).mockReturnValue({
      embed: vi.fn().mockResolvedValue({
        vectors: [Array(512).fill(0.1)],  // invalid dim
        dimensions: 512,
        costUsd: 0,
      }),
    } as never);

    await expect(embedNote('ws-id', 'test')).rejects.toThrow('Unexpected dimension 512');
  });
});
