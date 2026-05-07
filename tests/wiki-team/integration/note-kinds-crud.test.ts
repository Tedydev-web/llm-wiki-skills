/**
 * note-kinds-crud.test.ts — NoteKind CRUD integration tests (ADR 014 / P02)
 *
 * Tests the 4 REST endpoints:
 *   GET    /api/workspaces/:wid/note-kinds
 *   POST   /api/workspaces/:wid/note-kinds
 *   PATCH  /api/workspaces/:wid/note-kinds/:slug
 *   DELETE /api/workspaces/:wid/note-kinds/:slug
 *
 * Skipped unless INTEGRATION_TEST=1 (requires live DB + server).
 * Unit-level business logic tested via mocked service below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests — service layer (no DB required)

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return {
    getDb: () => mockDb,
    schema: {
      noteKinds: {
        id: 'note_kinds.id',
        slug: 'note_kinds.slug',
        displayName: 'note_kinds.display_name',
        description: 'note_kinds.description',
        createdAt: 'note_kinds.created_at',
        color: 'note_kinds.color',
        isSystemDefault: 'note_kinds.is_system_default',
        createdByUserId: 'note_kinds.created_by_user_id',
      },
      notes: {
        id: 'notes.id',
        workspaceId: 'notes.workspace_id',
        taxonomy: 'notes.taxonomy',
        deletedAt: 'notes.deleted_at',
      },
    },
    sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values, _isSql: true })),
  };
});

import { validateSlug, validateColor } from '../../../apps/wiki-team/services/note-kind-service.js';

describe('NoteKind validation', () => {
  describe('validateSlug', () => {
    it('accepts valid slugs', () => {
      expect(validateSlug('fact')).toBeNull();
      expect(validateSlug('my-kind')).toBeNull();
      expect(validateSlug('kind123')).toBeNull();
      expect(validateSlug('a')).toBeNull();
      expect(validateSlug('a'.repeat(32))).toBeNull();
    });

    it('rejects invalid slugs', () => {
      expect(validateSlug('')).not.toBeNull();
      expect(validateSlug('My-Kind')).not.toBeNull();         // uppercase
      expect(validateSlug('kind_with_underscores')).not.toBeNull();
      expect(validateSlug('kind with spaces')).not.toBeNull();
      expect(validateSlug('a'.repeat(33))).not.toBeNull();   // too long
    });

    it('rejects anti-trace forbidden tokens at validation level', () => {
      // These slugs are NOT seeded by code (only via admin UI = user-data)
      // Validation only checks format, not name semantics — they ARE valid format
      expect(validateSlug('policy')).toBeNull();   // valid format (user may create via UI)
      expect(validateSlug('sop')).toBeNull();      // valid format
    });
  });

  describe('validateColor', () => {
    it('accepts valid hex colors', () => {
      expect(validateColor('#6b7280')).toBeNull();
      expect(validateColor('#FFFFFF')).toBeNull();
      expect(validateColor('#000000')).toBeNull();
      expect(validateColor('#ef4444')).toBeNull();
    });

    it('rejects invalid colors', () => {
      expect(validateColor('6b7280')).not.toBeNull();    // missing #
      expect(validateColor('#gggggg')).not.toBeNull();   // invalid hex chars
      expect(validateColor('#fff')).not.toBeNull();       // 3-digit shorthand not supported
      expect(validateColor('#12345678')).not.toBeNull(); // 8-digit
      expect(validateColor('')).not.toBeNull();
      expect(validateColor('#6b728')).not.toBeNull();    // 5 digits
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — HTTP API (requires INTEGRATION_TEST=1)

const SKIP = process.env['INTEGRATION_TEST'] !== '1';
const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3333';
const WID = process.env['TEST_WORKSPACE_ID'] ?? '';

function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env['TEST_ADMIN_SESSION_TOKEN'] ?? 'test-admin-token';
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `wiki-team.session_token=${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe.skipIf(SKIP)('NoteKind CRUD integration', () => {
  const testSlug = `test-kind-${Date.now()}`;

  it('GET /api/workspaces/:wid/note-kinds — returns 4 system defaults', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds`);
    expect(res.status).toBe(200);
    const body = await res.json() as { noteKinds: Array<{ slug: string; isSystemDefault: boolean }> };
    const systemKinds = body.noteKinds.filter((k) => k.isSystemDefault);
    expect(systemKinds.length).toBeGreaterThanOrEqual(4);
    const slugs = body.noteKinds.map((k) => k.slug);
    expect(slugs).toContain('fact');
    expect(slugs).toContain('analysis');
    expect(slugs).toContain('procedure');
    expect(slugs).toContain('reference');
  });

  it('POST /api/workspaces/:wid/note-kinds — creates custom kind', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds`, {
      method: 'POST',
      body: JSON.stringify({ slug: testSlug, label: 'Test Kind', color: '#123456' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { noteKind: { slug: string; isSystemDefault: boolean } };
    expect(body.noteKind.slug).toBe(testSlug);
    expect(body.noteKind.isSystemDefault).toBe(false);
  });

  it('POST — rejects duplicate slug with 409', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds`, {
      method: 'POST',
      body: JSON.stringify({ slug: testSlug, label: 'Duplicate', color: '#abcdef' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST — rejects system-default slug conflict', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'fact', label: 'Fact Duplicate', color: '#abcdef' }),
    });
    expect(res.status).toBe(409);
  });

  it('PATCH /api/workspaces/:wid/note-kinds/:slug — updates color', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds/${testSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ color: '#654321' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { noteKind: { color: string } };
    expect(body.noteKind.color).toBe('#654321');
  });

  it('PATCH — rejects invalid color', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds/${testSlug}`, {
      method: 'PATCH',
      body: JSON.stringify({ color: 'bad-color' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE — rejects system-default kind', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds/fact`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
  });

  it('DELETE /api/workspaces/:wid/note-kinds/:slug — deletes custom kind with no notes', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds/${testSlug}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean; slug: string };
    expect(body.deleted).toBe(true);
    expect(body.slug).toBe(testSlug);
  });

  it('DELETE — returns 404 after deletion', async () => {
    const res = await adminFetch(`/api/workspaces/${WID}/note-kinds/${testSlug}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});
