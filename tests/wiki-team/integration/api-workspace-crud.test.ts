/**
 * api-workspace-crud.test.ts — workspace CRUD round-trip integration test
 *
 * Skipped unless INTEGRATION_TEST=1 (requires live DB + Redis + MinIO).
 * Tests: create → get → patch → delete workspace via HTTP API.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SKIP = process.env['INTEGRATION_TEST'] !== '1';
const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3333';

// Helper: make authenticated request (uses test session token from env)
function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const sessionToken = process.env['TEST_SESSION_TOKEN'] ?? 'test-session-token';
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `wiki-team.session_token=${sessionToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe.skipIf(SKIP)('Workspace CRUD round-trip', () => {
  let workspaceId: string;
  const slug = `test-ws-${Date.now()}`;

  it('POST /api/workspaces — creates workspace', async () => {
    const res = await authFetch('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ slug, displayName: 'Test Workspace' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; slug: string };
    expect(body.slug).toBe(slug);
    expect(body.id).toBeTruthy();
    workspaceId = body.id;
  });

  it('GET /api/workspaces — includes created workspace', async () => {
    const res = await authFetch('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaces: Array<{ id: string }> };
    expect(body.workspaces.some((w) => w.id === workspaceId)).toBe(true);
  });

  it('GET /api/workspaces/:id — returns workspace', async () => {
    const res = await authFetch(`/api/workspaces/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; slug: string };
    expect(body.id).toBe(workspaceId);
    expect(body.slug).toBe(slug);
  });

  it('PATCH /api/workspaces/:id — updates displayName', async () => {
    const res = await authFetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Updated Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: boolean };
    expect(body.updated).toBe(true);
  });

  it('DELETE /api/workspaces/:id — soft-deletes workspace', async () => {
    const res = await authFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it('GET /api/workspaces/:id — returns 404 after delete', async () => {
    const res = await authFetch(`/api/workspaces/${workspaceId}`);
    expect(res.status).toBe(404);
  });
});
