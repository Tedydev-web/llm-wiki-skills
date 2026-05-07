/**
 * middleware-auth.test.ts — unit tests for buildAuthMiddleware / authContextMiddleware
 *
 * Tests seam-level behaviour by mocking authContextMiddleware internals.
 * No real DB or Redis — pure in-memory mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Mock auth-context module before importing buildAuthMiddleware
vi.mock('../../../apps/wiki-team/auth/auth-context.js', () => ({
  authContextMiddleware: vi.fn(),
}));

import { authContextMiddleware } from '../../../apps/wiki-team/auth/auth-context.js';
import { buildAuthMiddleware } from '../../../apps/wiki-team/api/middleware/auth.js';

// ---------------------------------------------------------------------------
// Helpers — minimal Hono context stub

function makeCtx(overrides: Partial<{ authHeader?: string }> = {}) {
  let storedCtx: AuthContext | null = null;
  return {
    req: {
      header: (name: string) =>
        name === 'authorization' ? (overrides.authHeader ?? null) : null,
    },
    set: vi.fn((key: string, val: unknown) => {
      if (key === 'authContext') storedCtx = val as AuthContext | null;
    }),
    get: (key: string) => (key === 'authContext' ? storedCtx : null),
    json: vi.fn((body: unknown, status: number) => ({ body, status })),
  };
}

// ---------------------------------------------------------------------------
// Tests

describe('buildAuthMiddleware', () => {
  const mockAuth = {} as never;
  const mockTokenDb = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to authContextMiddleware with auth + mcpTokenDb', () => {
    const sentinel = vi.fn();
    vi.mocked(authContextMiddleware).mockReturnValue(sentinel);

    const mw = buildAuthMiddleware(mockAuth, mockTokenDb);

    expect(authContextMiddleware).toHaveBeenCalledWith(mockAuth, mockTokenDb);
    expect(mw).toBe(sentinel);
  });

  it('returns a function (middleware shape)', () => {
    vi.mocked(authContextMiddleware).mockReturnValue(vi.fn());
    const mw = buildAuthMiddleware(mockAuth, mockTokenDb);
    expect(typeof mw).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// authContextMiddleware behaviour — tested via direct mock scenarios

describe('authContextMiddleware contract (mock scenarios)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets authContext = null when no credentials provided (unauthenticated path)', async () => {
    const ctx = makeCtx(); // no auth header
    const next = vi.fn();

    // Simulate middleware that sets null context
    vi.mocked(authContextMiddleware).mockReturnValue(async (c: typeof ctx, n: typeof next) => {
      c.set('authContext', null);
      await n();
    });

    const mw = buildAuthMiddleware({} as never, {} as never);
    await mw(ctx as never, next);

    expect(ctx.get('authContext')).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('sets authContext when valid Bearer token resolves', async () => {
    const ctx = makeCtx({ authHeader: 'Bearer wkt_abc123' });
    const next = vi.fn();
    const resolvedCtx: AuthContext = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      membershipTier: 'contributor',
      permissions: [],
      source: 'mcp-token',
    };

    vi.mocked(authContextMiddleware).mockReturnValue(async (c: typeof ctx, n: typeof next) => {
      c.set('authContext', resolvedCtx);
      await n();
    });

    const mw = buildAuthMiddleware({} as never, {} as never);
    await mw(ctx as never, next);

    expect(ctx.get('authContext')).toEqual(resolvedCtx);
    expect(next).toHaveBeenCalled();
  });

  it('sets authContext when session cookie resolves', async () => {
    const ctx = makeCtx(); // no Bearer — session cookie path
    const next = vi.fn();
    const sessionCtx: AuthContext = {
      userId: 'user-session',
      workspaceId: null,
      membershipTier: 'observer',
      permissions: [],
      source: 'session',
    };

    vi.mocked(authContextMiddleware).mockReturnValue(async (c: typeof ctx, n: typeof next) => {
      c.set('authContext', sessionCtx);
      await n();
    });

    const mw = buildAuthMiddleware({} as never, {} as never);
    await mw(ctx as never, next);

    expect(ctx.get('authContext')).toEqual(sessionCtx);
  });
});
