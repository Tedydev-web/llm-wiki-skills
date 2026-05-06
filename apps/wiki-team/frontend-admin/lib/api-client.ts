/**
 * api-client.ts — typed wrapper around P08 REST endpoints.
 *
 * All methods throw WikiTeamApiError on non-2xx responses.
 * PATCH workspace/note methods throw OptimisticConflictError on 409.
 * ETag plumbing: get() returns ETag header alongside data via tuple.
 *
 * BASE_URL resolves from NEXT_PUBLIC_API_URL (default: http://localhost:3333).
 */

const BASE_URL =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL']) ||
  'http://localhost:3333';

// ---------------------------------------------------------------------------
// Error types

export class WikiTeamApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WikiTeamApiError';
  }
}

export class OptimisticConflictError extends WikiTeamApiError {
  constructor(public readonly currentVersion: number) {
    super(409, 'conflict', `Conflict: current version is ${currentVersion}`);
    this.name = 'OptimisticConflictError';
  }
}

export class StepUpRequiredError extends WikiTeamApiError {
  constructor() {
    super(401, 'step_up_required', 'Fresh authentication required for this action');
    this.name = 'StepUpRequiredError';
  }
}

export class RateLimitError extends WikiTeamApiError {
  constructor(public readonly resetsAt: string) {
    super(429, 'rate_limited', `Rate limit reached. Resets at ${resetsAt}`);
    this.name = 'RateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Domain types

export interface Workspace {
  id: string;
  slug: string;
  displayName: string;
  ownerId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface Member {
  id: string;
  workspaceId: string;
  userId: string;
  tier: 'observer' | 'contributor' | 'steward' | 'owner';
  invitedBy: string | null;
  joinedAt: string;
}

export interface Material {
  id: string;
  workspaceId: string;
  kbId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  createdAt: string;
}

export interface JobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  result?: unknown;
  failedReason?: string;
}

export interface Note {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  body: string;
  taxonomy: string[];
  version: number;
  kbId: string;
  updatedAt: string;
}

export interface NoteSummary {
  id: string;
  slug: string;
  title: string;
  taxonomy: string[];
  version: number;
  updatedAt: string;
  kbId: string;
}

export interface McpTokenMetadata {
  id: string;
  prefixLookup: string;
  userId: string;
  workspaceId: string | null;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface McpTokenIssued extends McpTokenMetadata {
  /** Plaintext token — returned ONCE at issuance, never again. */
  token: string;
}

// ---------------------------------------------------------------------------
// Internal fetch helper

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { etag?: string },
): Promise<{ data: T; etag?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };

  if (init?.etag) {
    headers['If-Match'] = init.etag;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 409) {
    let currentVersion = 0;
    try {
      const body = await res.json() as { currentVersion?: number };
      currentVersion = body.currentVersion ?? 0;
    } catch {
      // ignore parse failure
    }
    throw new OptimisticConflictError(currentVersion);
  }

  if (res.status === 401) {
    let code = 'unauthorized';
    try {
      const body = await res.json() as { code?: string };
      code = body.code ?? 'unauthorized';
    } catch {
      // ignore
    }
    if (code === 'step_up_required') throw new StepUpRequiredError();
    throw new WikiTeamApiError(401, code, 'Unauthorized');
  }

  if (res.status === 429) {
    const resetsAt = res.headers.get('X-RateLimit-Reset') ?? 'midnight UTC';
    throw new RateLimitError(resetsAt);
  }

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code = 'unknown';
    try {
      const body = await res.json() as { message?: string; code?: string };
      message = body.message ?? message;
      code = body.code ?? code;
    } catch {
      // ignore parse failure
    }
    throw new WikiTeamApiError(res.status, code, message);
  }

  const etag = res.headers.get('ETag') ?? undefined;

  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return { data: undefined as T, etag };
  }

  const data = await res.json() as T;
  return { data, etag };
}

// ---------------------------------------------------------------------------
// API namespace

export const api = {
  workspaces: {
    list: async (): Promise<Workspace[]> => {
      const { data } = await apiFetch<{ workspaces: Workspace[] }>('/api/workspaces');
      return data.workspaces;
    },

    create: async (input: { slug: string; displayName: string }): Promise<Workspace> => {
      const { data } = await apiFetch<Workspace>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return data;
    },

    get: async (slug: string): Promise<{ workspace: Workspace; etag?: string }> => {
      const { data, etag } = await apiFetch<Workspace>(`/api/workspaces/${slug}`);
      return { workspace: data, etag };
    },

    update: async (
      slug: string,
      ifMatch: string,
      patch: Partial<Pick<Workspace, 'displayName' | 'slug'>>,
    ): Promise<Workspace> => {
      // throws OptimisticConflictError on 409
      const { data } = await apiFetch<Workspace>(`/api/workspaces/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        etag: ifMatch,
      });
      return data;
    },

    delete: async (slug: string): Promise<void> => {
      await apiFetch<void>(`/api/workspaces/${slug}`, { method: 'DELETE' });
    },
  },

  members: {
    list: async (workspaceId: string): Promise<Member[]> => {
      const { data } = await apiFetch<{ members: Member[] }>(`/api/workspaces/${workspaceId}/members`);
      return data.members;
    },

    invite: async (workspaceId: string, userId: string, tier: Member['tier']): Promise<Member> => {
      const { data } = await apiFetch<Member>(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, tier }),
      });
      return data;
    },

    updateTier: async (workspaceId: string, userId: string, tier: Member['tier']): Promise<Member> => {
      const { data } = await apiFetch<Member>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tier }),
      });
      return data;
    },

    remove: async (workspaceId: string, userId: string): Promise<void> => {
      await apiFetch<void>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
    },
  },

  materials: {
    list: async (workspaceId: string): Promise<Material[]> => {
      const { data } = await apiFetch<{ materials: Material[] }>(`/api/workspaces/${workspaceId}/materials`);
      return data.materials;
    },

    upload: async (workspaceId: string, file: File): Promise<Material> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/materials`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
        // No Content-Type header — let browser set multipart boundary
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
        throw new WikiTeamApiError(res.status, body.code ?? 'upload_failed', body.message ?? 'Upload failed');
      }
      return res.json() as Promise<Material>;
    },

    delete: async (workspaceId: string, materialId: string): Promise<void> => {
      await apiFetch<void>(`/api/workspaces/${workspaceId}/materials/${materialId}`, {
        method: 'DELETE',
      });
    },

    compile: async (workspaceId: string, materialId: string): Promise<{ jobId: string }> => {
      const { data } = await apiFetch<{ jobId: string }>(
        `/api/workspaces/${workspaceId}/materials/${materialId}/compile`,
        { method: 'POST' },
      );
      return data;
    },

    pollJob: async (jobId: string): Promise<JobStatus> => {
      const { data } = await apiFetch<JobStatus>(`/api/jobs/${jobId}`);
      return data;
    },
  },

  notes: {
    list: async (workspaceId: string, q?: string): Promise<NoteSummary[]> => {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const { data } = await apiFetch<{ notes: NoteSummary[] }>(`/api/workspaces/${workspaceId}/notes${qs}`);
      return data.notes;
    },

    get: async (workspaceId: string, noteSlug: string): Promise<{ note: Note; etag?: string }> => {
      const { data, etag } = await apiFetch<Note>(`/api/workspaces/${workspaceId}/notes/${noteSlug}`);
      return { note: data, etag };
    },

    update: async (
      workspaceId: string,
      noteSlug: string,
      ifMatch: string,
      patch: Partial<Pick<Note, 'title' | 'body' | 'taxonomy'>>,
    ): Promise<Note> => {
      // throws OptimisticConflictError on 409
      const { data } = await apiFetch<Note>(`/api/workspaces/${workspaceId}/notes/${noteSlug}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        etag: ifMatch,
      });
      return data;
    },

    delete: async (workspaceId: string, noteSlug: string): Promise<void> => {
      await apiFetch<void>(`/api/workspaces/${workspaceId}/notes/${noteSlug}`, {
        method: 'DELETE',
      });
    },
  },

  tokens: {
    list: async (): Promise<McpTokenMetadata[]> => {
      const { data } = await apiFetch<{ tokens: McpTokenMetadata[] }>('/api/me/tokens');
      return data.tokens;
    },

    /** Returns plaintext token ONCE — caller must display immediately and never persist. */
    issue: async (workspaceId?: string): Promise<McpTokenIssued> => {
      // throws StepUpRequiredError if session > 15 min
      // throws RateLimitError if > 10 tokens/day
      const { data } = await apiFetch<McpTokenIssued>('/api/me/tokens', {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      });
      return data;
    },

    revoke: async (tokenId: string): Promise<void> => {
      await apiFetch<void>(`/api/me/tokens/${tokenId}`, { method: 'DELETE' });
    },

    rotate: async (tokenId: string): Promise<McpTokenIssued> => {
      const { data } = await apiFetch<McpTokenIssued>(`/api/me/tokens/${tokenId}/rotate`, {
        method: 'POST',
      });
      return data;
    },

    revokeAll: async (): Promise<void> => {
      await apiFetch<void>('/api/me/tokens/revoke-all', { method: 'POST' });
    },
  },
};
