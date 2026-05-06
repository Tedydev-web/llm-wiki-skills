/**
 * openapi.ts — OpenAPI 3.1 spec assembly
 *
 * Served at GET /openapi.json
 * Swagger UI served at GET /docs (via @hono/swagger-ui)
 *
 * Spec is hand-authored (not codegen) — YAGNI for 25 endpoints.
 * Each endpoint section matches the route files 1:1.
 */

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'wiki-team HTTP API',
    version: '2.0.0',
    description: 'Administrative and management API for wiki-team v2.0. Sync model: optimistic concurrency (If-Match / ETag). Auth: session cookie or Bearer wkt_* MCP token.',
  },
  servers: [{ url: '/api', description: 'wiki-team API' }],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'wiki-team.session_token' },
      bearerToken: { type: 'http', scheme: 'bearer', bearerFormat: 'wkt_<base64url>', description: 'MCP bearer token (wkt_ prefix)' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'object' },
        },
      },
      Workspace: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          displayName: { type: 'string' },
          ownerId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Note: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          taxonomy: { type: 'string', enum: ['fact', 'analysis', 'procedure', 'reference'] },
          version: { type: 'integer', description: 'ADR 011 optimistic concurrency version. Send as If-Match: "<version>" on PATCH.' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Material: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          fileName: { type: 'string' },
          mimeType: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          sizeBytes: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      McpToken: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          workspaceId: { type: 'string', format: 'uuid' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }, { bearerToken: [] }],
  paths: {
    '/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': { description: 'All services healthy' },
          '503': { description: 'One or more services degraded' },
        },
      },
    },
    '/api/me': {
      get: {
        tags: ['Me'],
        summary: 'Get caller identity',
        responses: {
          '200': { description: 'AuthContext summary' },
          '401': { description: 'Unauthenticated' },
        },
      },
    },
    '/api/workspaces': {
      get: {
        tags: ['Workspaces'],
        summary: 'List workspaces',
        responses: { '200': { description: 'Workspace list' }, '401': { description: 'Unauthenticated' } },
      },
      post: {
        tags: ['Workspaces'],
        summary: 'Create workspace',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['slug', 'displayName'], properties: { slug: { type: 'string' }, displayName: { type: 'string' } } } } },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' }, '401': { description: 'Unauthenticated' } },
      },
    },
    '/api/workspaces/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { tags: ['Workspaces'], summary: 'Get workspace', responses: { '200': { description: 'Workspace' }, '404': { description: 'Not found' } } },
      patch: { tags: ['Workspaces'], summary: 'Update workspace (steward+)', responses: { '200': { description: 'Updated' }, '403': { description: 'RBAC deny' } } },
      delete: { tags: ['Workspaces'], summary: 'Delete workspace (owner)', responses: { '200': { description: 'Deleted' }, '403': { description: 'RBAC deny' } } },
    },
    '/api/workspaces/{id}/members': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { tags: ['Members'], summary: 'List members', responses: { '200': { description: 'Member list' } } },
      post: { tags: ['Members'], summary: 'Invite member', responses: { '201': { description: 'Member added' }, '403': { description: 'RBAC deny' } } },
    },
    '/api/workspaces/{id}/members/{uid}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'uid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      patch: { tags: ['Members'], summary: 'Change member tier', responses: { '200': { description: 'Updated' }, '403': { description: 'RBAC deny' } } },
      delete: { tags: ['Members'], summary: 'Remove member', responses: { '200': { description: 'Removed' }, '403': { description: 'RBAC deny' } } },
    },
    '/api/workspaces/{id}/materials': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { tags: ['Materials'], summary: 'List materials', responses: { '200': { description: 'Material list' } } },
      post: {
        tags: ['Materials'],
        summary: 'Upload material (multipart, max 100MB)',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
        responses: { '201': { description: 'Uploaded' }, '400': { description: 'Invalid file' }, '503': { description: 'Redis/MinIO unavailable' } },
      },
    },
    '/api/workspaces/{id}/materials/{mid}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'mid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      get: { tags: ['Materials'], summary: 'Get material metadata', responses: { '200': { description: 'Material' }, '404': { description: 'Not found' } } },
      delete: { tags: ['Materials'], summary: 'Delete material', responses: { '200': { description: 'Deleted' }, '403': { description: 'RBAC deny' } } },
    },
    '/api/workspaces/{id}/materials/{mid}/compile': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'mid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      post: { tags: ['Materials'], summary: 'Enqueue wiki-compile job', responses: { '202': { description: 'Job enqueued' }, '404': { description: 'Material not found' } } },
    },
    '/api/jobs/{jid}': {
      parameters: [{ name: 'jid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { tags: ['Jobs'], summary: 'Poll job status', responses: { '200': { description: 'Job state' }, '404': { description: 'Not found' } } },
    },
    '/api/workspaces/{id}/notes': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: { tags: ['Notes'], summary: 'List notes (RBAC-scoped)', responses: { '200': { description: 'Note list' } } },
    },
    '/api/workspaces/{id}/notes/{slug}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: {
        tags: ['Notes'],
        summary: 'Read note — sets ETag: "<version>"',
        responses: { '200': { description: 'Note + ETag header', headers: { ETag: { schema: { type: 'string' } } } }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Notes'],
        summary: 'Update note (optimistic concurrency — If-Match required)',
        description: 'Requires If-Match: "<version>" header. Returns 409 on version mismatch with currentVersion in body. Returns 428 if If-Match absent.',
        parameters: [{ name: 'if-match', in: 'header', required: true, schema: { type: 'string' }, example: '"3"' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, taxonomy: { type: 'string' } } } } } },
        responses: {
          '200': { description: 'Updated + new ETag', headers: { ETag: { schema: { type: 'string' } } } },
          '409': { description: 'Version mismatch — body contains currentVersion' },
          '428': { description: 'If-Match header missing or malformed' },
        },
      },
      delete: { tags: ['Notes'], summary: 'Soft-delete note', responses: { '200': { description: 'Deleted' }, '403': { description: 'RBAC deny' } } },
    },
    '/api/me/tokens': {
      get: { tags: ['Tokens'], summary: 'List MCP tokens (no plaintext)', responses: { '200': { description: 'Token metadata list' } } },
      post: {
        tags: ['Tokens'],
        summary: 'Issue MCP token (rate-limited: 10/day; step-up reauth required)',
        description: 'Returns plaintext token ONCE. Session must be ≤15 min old. Rate limit: 10 tokens per UTC calendar day.',
        responses: {
          '201': { description: 'Token issued — plaintext in response.token' },
          '401': { description: 'step_up_required — re-authenticate' },
          '429': { description: 'Rate limit exceeded — check Retry-After header' },
        },
      },
    },
    '/api/me/tokens/{tid}': {
      parameters: [{ name: 'tid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      delete: { tags: ['Tokens'], summary: 'Revoke token', responses: { '200': { description: 'Revoked' }, '404': { description: 'Not found' } } },
    },
    '/api/me/tokens/{tid}/rotate': {
      parameters: [{ name: 'tid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      post: { tags: ['Tokens'], summary: 'Rotate token (revoke + reissue atomically)', responses: { '201': { description: 'New token — plaintext in response.token' } } },
    },
    '/api/me/tokens/revoke-all': {
      post: { tags: ['Tokens'], summary: 'Revoke all tokens (incident kill-switch)', responses: { '200': { description: 'All tokens revoked' } } },
    },
  },
} as const;
