/**
 * api-rbac-403-paths.test.ts — RBAC enforcement: viewer attempts admin actions → 403
 *
 * Proves rbacGuard() correctly denies underprivileged callers.
 * Uses two session tokens: admin (owner tier) + viewer (observer tier).
 *
 * Skipped unless INTEGRATION_TEST=1.
 */

import { describe, it, expect } from 'vitest';

const SKIP = process.env['INTEGRATION_TEST'] !== '1';
const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3333';

// Admin session (owner tier) — can do everything
function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env['TEST_ADMIN_SESSION_TOKEN'] ?? 'admin-session-token';
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `wiki-team.session_token=${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

// Viewer session (observer tier) — read-only
function viewerFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env['TEST_VIEWER_SESSION_TOKEN'] ?? 'viewer-session-token';
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `wiki-team.session_token=${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe.skipIf(SKIP)('RBAC 403 paths — observer cannot perform steward/owner actions', () => {
  const workspaceId = process.env['TEST_WORKSPACE_ID'] ?? 'test-workspace-id';

  it('viewer: PATCH /api/workspaces/:id returns 403', async () => {
    const res = await viewerFetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Hacked Name' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('viewer: DELETE /api/workspaces/:id returns 403', async () => {
    const res = await viewerFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('viewer: POST /api/workspaces/:id/members returns 403', async () => {
    const res = await viewerFetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000099', tier: 'contributor' }),
    });
    expect(res.status).toBe(403);
  });

  it('viewer: PATCH /api/workspaces/:id/members/:uid returns 403', async () => {
    const fakeUid = '00000000-0000-0000-0000-000000000099';
    const res = await viewerFetch(`/api/workspaces/${workspaceId}/members/${fakeUid}`, {
      method: 'PATCH',
      body: JSON.stringify({ tier: 'owner' }),
    });
    expect(res.status).toBe(403);
  });

  it('viewer: POST /api/workspaces/:id/materials (upload) returns 403', async () => {
    const file = new File(['data'], 'test.md', { type: 'text/markdown' });
    const form = new FormData();
    form.append('file', file);

    const res = await viewerFetch(`/api/workspaces/${workspaceId}/materials`, {
      method: 'POST',
      body: form,
      headers: {
        // Override content-type to be set by FormData automatically (don't set manually)
        Cookie: `wiki-team.session_token=${process.env['TEST_VIEWER_SESSION_TOKEN'] ?? 'viewer-session-token'}`,
      } as HeadersInit,
    });
    expect(res.status).toBe(403);
  });

  it('viewer: PATCH /api/workspaces/:id/notes/:slug returns 403', async () => {
    const res = await viewerFetch(`/api/workspaces/${workspaceId}/notes/some-note`, {
      method: 'PATCH',
      headers: { 'If-Match': '"1"' },
      body: JSON.stringify({ title: 'Unauthorized edit' }),
    });
    // 403 from rbacGuard (before If-Match parsing)
    expect(res.status).toBe(403);
  });

  it('unauthenticated: GET /api/me returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/me`);
    expect(res.status).toBe(401);
  });

  it('unauthenticated: GET /healthz returns 200 (no auth required)', async () => {
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
  });

  it('admin: GET /api/workspaces succeeds (sanity check)', async () => {
    const res = await adminFetch('/api/workspaces');
    expect(res.status).toBe(200);
  });
});
