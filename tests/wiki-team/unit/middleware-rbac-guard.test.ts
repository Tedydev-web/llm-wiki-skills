/**
 * middleware-rbac-guard.test.ts — unit tests for rbacGuard middleware
 *
 * Mocks: requireAuth, evaluatePolicy, errorResponse
 * No DB / Redis I/O — pure function testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import of the module under test

vi.mock('../../../apps/wiki-team/auth/auth-context.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../../../apps/wiki-team/rbac/index.js', () => ({
  evaluatePolicy: vi.fn(),
}));

vi.mock('../../../apps/wiki-team/api/middleware/error-handler.js', () => ({
  errorResponse: vi.fn((c: unknown, status: number, error: string, message: string, details?: unknown) => ({
    _isErrorResponse: true,
    status,
    error,
    message,
    details,
  })),
}));

import { requireAuth } from '../../../apps/wiki-team/auth/auth-context.js';
import { evaluatePolicy } from '../../../apps/wiki-team/rbac/index.js';
import { errorResponse } from '../../../apps/wiki-team/api/middleware/error-handler.js';
import { rbacGuard } from '../../../apps/wiki-team/api/middleware/rbac-guard.js';

// ---------------------------------------------------------------------------
// Helpers

function makeAuthCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    workspaceId: 'ws-1',
    membershipTier: 'contributor',
    permissions: [],
    source: 'session',
    ...overrides,
  };
}

function makeCtx(paramOverrides: Record<string, string> = {}) {
  return {
    req: {
      param: (name: string) => paramOverrides[name] ?? null,
    },
    json: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests

describe('rbacGuard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls next() when evaluatePolicy returns allow=true', async () => {
    const ctx = makeAuthCtx();
    vi.mocked(requireAuth).mockReturnValue(ctx);
    vi.mocked(evaluatePolicy).mockReturnValue({ allow: true });

    const next = vi.fn();
    const mw = rbacGuard('kb', 'view');
    await mw(makeCtx({ id: 'ws-1' }) as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(errorResponse).not.toHaveBeenCalled();
  });

  it('returns 403 when evaluatePolicy returns allow=false', async () => {
    const ctx = makeAuthCtx({ membershipTier: 'observer' });
    vi.mocked(requireAuth).mockReturnValue(ctx);
    vi.mocked(evaluatePolicy).mockReturnValue({ allow: false, reason: 'tier_too_low' });

    const next = vi.fn();
    const c = makeCtx({ id: 'ws-1' });
    const mw = rbacGuard('kb', 'manage');
    const result = await mw(c as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(errorResponse).toHaveBeenCalledWith(
      expect.anything(),
      403,
      'forbidden',
      expect.stringContaining('tier_too_low'),
      expect.objectContaining({ resource: 'kb', verb: 'manage' }),
    );
    expect((result as Record<string, unknown>)?.status).toBe(403);
  });

  it('throws 401 Response when requireAuth throws (unauthenticated)', async () => {
    vi.mocked(requireAuth).mockImplementation(() => {
      throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    });

    const next = vi.fn();
    await expect(
      rbacGuard('kb', 'edit')(makeCtx() as never, next),
    ).rejects.toBeInstanceOf(Response);

    expect(next).not.toHaveBeenCalled();
  });

  it('resolves workspaceId from :wid param when :id is absent', async () => {
    const ctx = makeAuthCtx({ workspaceId: 'ws-from-wid' });
    vi.mocked(requireAuth).mockReturnValue(ctx);
    vi.mocked(evaluatePolicy).mockReturnValue({ allow: true });

    const next = vi.fn();
    const mw = rbacGuard('kb', 'view');
    await mw(makeCtx({ wid: 'ws-from-wid' }) as never, next);

    expect(evaluatePolicy).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ workspaceId: 'ws-from-wid' }),
      expect.objectContaining({ verb: 'view' }),
    );
  });

  it('global-admin tier context passes evaluatePolicy with allow', async () => {
    const ctx = makeAuthCtx({ membershipTier: 'global-admin', workspaceId: null });
    vi.mocked(requireAuth).mockReturnValue(ctx);
    vi.mocked(evaluatePolicy).mockReturnValue({ allow: true });

    const next = vi.fn();
    await rbacGuard('tenant', 'manage')(makeCtx() as never, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('403 response includes resource, verb, workspaceId in details', async () => {
    const ctx = makeAuthCtx({ membershipTier: 'observer' });
    vi.mocked(requireAuth).mockReturnValue(ctx);
    vi.mocked(evaluatePolicy).mockReturnValue({ allow: false, reason: 'scope_mismatch' });

    const next = vi.fn();
    await rbacGuard('page', 'delete')(makeCtx({ id: 'ws-99' }) as never, next);

    expect(errorResponse).toHaveBeenCalledWith(
      expect.anything(),
      403,
      'forbidden',
      expect.any(String),
      { resource: 'page', verb: 'delete', workspaceId: 'ws-99' },
    );
  });
});
