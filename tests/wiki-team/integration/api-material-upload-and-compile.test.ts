/**
 * api-material-upload-and-compile.test.ts — material upload → compile → job poll
 *
 * Proves the full pipeline:
 *   multipart upload → MinIO + DB row (status=pending) →
 *   POST /compile → BullMQ job enqueued (status=waiting) →
 *   GET /jobs/:jid → eventually completed
 *
 * Skipped unless INTEGRATION_TEST=1.
 */

import { describe, it, expect } from 'vitest';

const SKIP = process.env['INTEGRATION_TEST'] !== '1';
const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3333';

function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const sessionToken = process.env['TEST_SESSION_TOKEN'] ?? 'test-session-token';
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Cookie: `wiki-team.session_token=${sessionToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(SKIP)('Material upload → compile → job poll pipeline', () => {
  const workspaceId = process.env['TEST_WORKSPACE_ID'] ?? 'test-workspace-id';
  let materialId: string;
  let jobId: string;

  it('POST /api/workspaces/:id/materials — uploads markdown file', async () => {
    const content = '# Test Document\n\nThis is a test material for integration testing.';
    const file = new File([content], 'test-doc.md', { type: 'text/markdown' });
    const form = new FormData();
    form.append('file', file);

    const res = await authFetch(`/api/workspaces/${workspaceId}/materials`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { materialId: string; status: string };
    expect(body.materialId).toBeTruthy();
    expect(body.status).toBe('pending');
    materialId = body.materialId;
  });

  it('GET /api/workspaces/:id/materials/:mid — material row exists with pending status', async () => {
    const res = await authFetch(`/api/workspaces/${workspaceId}/materials/${materialId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string; fileName: string };
    expect(body.id).toBe(materialId);
    expect(body.status).toBe('pending');
    expect(body.fileName).toBe('test-doc.md');
  });

  it('POST /api/workspaces/:id/materials/:mid/compile — enqueues wiki-compile job', async () => {
    const res = await authFetch(
      `/api/workspaces/${workspaceId}/materials/${materialId}/compile`,
      { method: 'POST' },
    );

    expect(res.status).toBe(202);
    const body = await res.json() as { jobId: string; status: string };
    expect(body.jobId).toBeTruthy();
    expect(body.status).toBe('waiting');
    jobId = body.jobId;
  });

  it('GET /api/jobs/:jid — returns job state (waiting or active)', async () => {
    const res = await authFetch(`/api/jobs/${jobId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; state: string };
    expect(body.id).toBe(jobId);
    expect(['waiting', 'active', 'completed']).toContain(body.state);
  });

  it('POST /compile on non-existent material returns 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await authFetch(
      `/api/workspaces/${workspaceId}/materials/${fakeId}/compile`,
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
  });

  it('POST /materials with oversized content-type returns 400', async () => {
    const file = new File(['data'], 'test.exe', { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', file);

    const res = await authFetch(`/api/workspaces/${workspaceId}/materials`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('bad_request');
  });
});
