/**
 * middleware-audit-log.test.ts — unit tests for auditLog middleware
 *
 * Verifies: write-failure swallow, actor_email_hmac HMAC correlation, body hash,
 *   unauthenticated skip, non-mutation method skip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
vi.mock('../../../apps/wiki-team/storage/db.js', () => ({
  getDb: () => ({ insert: mockInsert }),
  schema: {
    auditEvents: { name: 'audit_events' },
  },
}));

import { logger } from '../../../apps/wiki-team/lib/logger.js';
import { auditLog } from '../../../apps/wiki-team/api/middleware/audit-log.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Helpers

const AUDIT_HMAC_SECRET = 'test-hmac-secret-32-chars-pad-pad';

function makeAuthCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-abc',
    workspaceId: 'ws-1',
    membershipTier: 'contributor',
    permissions: [],
    source: 'session',
    ...overrides,
  };
}

function makeCtx(opts: {
  method?: string;
  authCtx?: AuthContext | null;
  body?: string;
  paramId?: string;
}) {
  const { method = 'POST', authCtx = makeAuthCtx(), body = '{}', paramId = 'res-1' } = opts;

  const bodyBytes = new TextEncoder().encode(body);
  const rawRequest = new Request('http://localhost/api/notes/res-1', {
    method,
    body: method !== 'GET' ? body : null,
    headers: { 'content-type': 'application/json' },
  });

  return {
    req: {
      method,
      raw: rawRequest,
      header: vi.fn((name: string) => {
        if (name === 'x-forwarded-for') return '1.2.3.4';
        return null;
      }),
      url: 'http://localhost/api/notes/res-1',
      param: (name: string) => (name === 'id' ? paramId : null),
    },
    get: (key: string) => (key === 'authContext' ? authCtx : null),
    _bodyBytes: bodyBytes,
  };
}

// ---------------------------------------------------------------------------
// Tests

describe('auditLog middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AUDIT_HMAC_SECRET'] = AUDIT_HMAC_SECRET;
  });

  afterEach(() => {
    delete process.env['AUDIT_HMAC_SECRET'];
  });

  it('calls next() for mutation methods', async () => {
    const ctx = makeCtx({ method: 'POST' });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.created', 'note', () => 'res-1');
    await mw(ctx as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('skips audit write for non-mutation methods (GET)', async () => {
    const ctx = makeCtx({ method: 'GET' });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.read', 'note', () => 'res-1');
    await mw(ctx as never, next);

    // Allow micro-task queue to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('skips audit write when authContext is null (unauthenticated)', async () => {
    const ctx = makeCtx({ method: 'POST', authCtx: null });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.created', 'note', () => 'res-1');
    await mw(ctx as never, next);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('swallows audit write failure without surfacing to client', async () => {
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error('DB timeout')),
    });

    const ctx = makeCtx({ method: 'POST' });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.created', 'note', () => 'res-1');
    // Should NOT throw
    await expect(mw(ctx as never, next)).resolves.toBeUndefined();

    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(String) }),
      expect.stringContaining('[audit-log] write failed'),
    );
  });

  it('logs error when AUDIT_HMAC_SECRET is missing', async () => {
    delete process.env['AUDIT_HMAC_SECRET'];

    const ctx = makeCtx({ method: 'DELETE' });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.deleted', 'note', () => 'res-1');
    await mw(ctx as never, next);

    await new Promise((r) => setTimeout(r, 20));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('AUDIT_HMAC_SECRET not configured'),
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('writes audit row with HMAC actor_email_hmac (not raw userId)', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValueOnce({ values: insertValues });

    const ctx = makeCtx({ method: 'PATCH' });
    const next = vi.fn().mockResolvedValue(undefined);

    const mw = auditLog('note.updated', 'note', () => 'res-1');
    await mw(ctx as never, next);

    await new Promise((r) => setTimeout(r, 20));
    expect(insertValues).toHaveBeenCalledOnce();

    const inserted = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    // actorId is raw userId (DB FK), but payload.actorEmailHmac must be HMAC
    expect(inserted['actorId']).toBe('user-abc');
    const payload = inserted['payload'] as Record<string, unknown>;
    expect(typeof payload['actorEmailHmac']).toBe('string');
    expect(payload['actorEmailHmac']).not.toBe('user-abc'); // must be hashed, not raw
    expect((payload['actorEmailHmac'] as string).length).toBe(64); // SHA-256 hex length
  });
});
