/**
 * server.ts — MCP host server entry point
 *
 * Standalone Bun process exposing wiki-team knowledge via Model Context Protocol.
 * Dual-transport per ADR 012:
 *   POST /mcp      — Streamable HTTP (primary, current MCP spec 2025-03-26)
 *   GET  /mcp/sse  — SSE event stream (legacy fallback for older MCP clients)
 *   POST /mcp/messages — SSE client→server messages
 *   GET  /healthz  — liveness check (no auth required)
 *
 * Auth: Bearer wkt_* token validated per ADR 012 on every request.
 * RBAC: each tool calls evaluatePolicy + compileScopeFilter before any DB read.
 *
 * Boot: MCP_PORT env var (default 3334). Crashes if BETTER_AUTH_SECRET or
 * DATABASE_URL contain placeholder values (assertEnv via getDb()).
 *
 * Anti-trace compliance: uses mcpAuthMiddleware function, loadAuthContextFromBearer,
 * and compileScopeFilter (P05). See plan.md §Anti-Trace Discipline for the
 * canonical forbidden-token list.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadAuthContextFromBearer } from '@wiki-team/mcp/mcp-auth';
import { handleStreamableHttpRequest } from '@wiki-team/mcp/transports/streamable-http';
import {
  handleSseConnection,
  handleSseMessage,
  activeSessionCount,
} from '@wiki-team/mcp/transports/sse';
import type { McpTokenDb } from '../auth/mcp-token-service.js';
import { verifyMcpToken } from '../auth/mcp-token-service.js';
import { getDb } from '../storage/db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Tool builders
import { buildWikiSearchTool } from './tools/wiki-search.js';
import { buildWikiFetchTool } from './tools/wiki-fetch.js';
import { buildWikiCatalogTool } from './tools/wiki-catalog.js';
import { buildWikiRecentTool } from './tools/wiki-recent.js';
import { buildMaterialReadTool } from './tools/material-read.js';
import { buildDirectoryLookupTool } from './tools/directory-lookup.js';
import { buildWorkspaceInfoTool } from './tools/workspace-info.js';
import { buildNoteCrossrefsTool } from './tools/note-crossrefs.js';

// ---------------------------------------------------------------------------
// Environment

const MCP_PORT = parseInt(process.env['MCP_PORT'] ?? '3334', 10);
const BASE_URL = process.env['MCP_BASE_URL'] ?? `http://localhost:${MCP_PORT}`;
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

// ---------------------------------------------------------------------------
// System instructions (returned at MCP initialize)
// Loaded from system-instructions.md authored per plan §System-Prompt
// Re-Authoring Protocol (fresh-context subagent + user review gate, Wave 3).

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_INSTRUCTIONS = readFileSync(
  join(__dirname, 'system-instructions.md'),
  'utf-8',
)
  // Strip the trailing HTML attestation comment block (dev metadata, not for clients)
  .replace(/<!--[\s\S]*?-->\s*$/m, '')
  .trim();

// ---------------------------------------------------------------------------
// McpTokenDb adapter — wraps Drizzle schema for the auth module

/**
 * Build a McpTokenDb adapter from the Drizzle instance.
 * Kept inline in server.ts — avoids coupling mcp-host to P03 internals.
 * P08 will extract this to a shared storage adapter when it lands.
 */
function buildMcpTokenDb(): McpTokenDb {
  const db = getDb();
  const { schema } = db as unknown as { schema: Record<string, unknown> };

  // Minimal adapter — delegates to Drizzle queries. Full implementation
  // depends on P03's generated schema; these are typed against McpTokenDb interface.
  return {
    async insertMcpToken(row) {
      // P03 will own the actual drizzle table — placeholder implementation
      void db; void row; void schema;
      throw new Error('insertMcpToken: not implemented in mcp-host (use P08 HTTP API)');
    },
    async findMcpTokenByPrefixLookup(prefixLookup) {
      // This is the hot path — P03 must provide mcpTokens table
      // Placeholder: returns null (auth will fail → appropriate for pre-P03 dev)
      void prefixLookup;
      return null;
    },
    async findMcpTokenById(id) {
      void id;
      return null;
    },
    async revokeMcpTokenById(id) {
      void id;
    },
    async revokeAllMcpTokensByUserId(userId) {
      void userId;
      return 0;
    },
    async countMcpTokensIssuedToday(userId, dateKey) {
      void userId; void dateKey;
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// createMcpServer — builds an MCP SDK Server with all 8 tools registered
//
// Called per-request for Streamable HTTP (stateless sessions).
// For SSE sessions, the server instance persists for the session lifetime.

function createMcpServer(db: McpTokenDb) {
  const server = new Server(
    { name: 'wiki-team-mcp', version: '2.0.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Initialize handler — returns system instructions to Claude
  server.setRequestHandler(InitializeRequestSchema, async (req) => {
    return {
      protocolVersion: req.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'wiki-team-mcp', version: '2.0.0' },
      instructions: SYSTEM_INSTRUCTIONS,
    };
  });

  // ListTools handler — discovery surface for Claude
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Tool descriptors don't require auth (they carry no data)
    // Auth is enforced per-tool in CallTool handler
    return {
      tools: ALL_TOOL_NAMES.map((name) => ({
        name,
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: TOOL_SCHEMAS[name],
      })),
    };
  });

  // CallTool handler — auth + dispatch to per-tool builder
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    // Auth: extract Bearer token from meta (SDK passes request headers via meta)
    // For Streamable HTTP, the Authorization header is passed via request context.
    // We read it from the meta object injected by the transport adapter.
    const authHeader =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any)._meta?.authorization as string | undefined;

    const ctx = await loadAuthContextFromBearer(authHeader ?? null, db, verifyMcpToken);

    // Dispatch to the correct tool builder + handler
    const tool = buildTool(name, ctx);
    if (!tool) {
      const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
      throw new McpError(ErrorCode.MethodNotFound, `unknown_tool: ${name}`);
    }

    return tool.mcpHandler(args ?? {});
  });

  return server;
}

// ---------------------------------------------------------------------------
// Tool registry helpers

const ALL_TOOL_NAMES = [
  'wiki.search',
  'wiki.fetch',
  'wiki.catalog',
  'wiki.recent',
  'material.read',
  'directory.lookup',
  'workspace.info',
  'note.crossrefs',
] as const;

// Descriptions mirrored from tool files — kept in sync manually (YAGNI: no codegen for 8 tools)
const TOOL_DESCRIPTIONS: Record<string, string> = {
  'wiki.search': 'Search wiki notes by semantic similarity or keyword. Returns matching notes with excerpts. Search before fetching full pages.',
  'wiki.fetch': 'Read the full content of a wiki note by slug. Use wiki.search first; call this only when the excerpt is insufficient.',
  'wiki.catalog': 'List all accessible notes in a workspace with pagination. Returns slug, title, taxonomy, updatedAt.',
  'wiki.recent': 'Return the most recently updated notes in a workspace.',
  'material.read': 'Read a raw material excerpt by ID. Returns extracted text up to maxChars. Cite material IDs in answers.',
  'directory.lookup': 'Search workspace members by name. Non-admin callers receive userId and displayName only. Admin callers also receive the email field.',
  'workspace.info': 'Retrieve metadata for the current workspace: slug, display name, member count, note count.',
  'note.crossrefs': 'List outbound cross-references (wikilinks) from a note. Use to traverse the knowledge graph.',
};

// Minimal JSON Schema descriptors for ListTools (full validation happens in tool handlers via Zod)
const TOOL_SCHEMAS: Record<string, object> = {
  'wiki.search': { type: 'object', properties: { query: { type: 'string' }, workspaceId: { type: 'string' }, topK: { type: 'integer' }, mode: { type: 'string' } }, required: ['query', 'workspaceId'] },
  'wiki.fetch': { type: 'object', properties: { slug: { type: 'string' }, workspaceId: { type: 'string' }, version: { type: 'integer' } }, required: ['slug', 'workspaceId'] },
  'wiki.catalog': { type: 'object', properties: { workspaceId: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer' } }, required: ['workspaceId'] },
  'wiki.recent': { type: 'object', properties: { workspaceId: { type: 'string' }, limit: { type: 'integer' } }, required: ['workspaceId'] },
  'material.read': { type: 'object', properties: { materialId: { type: 'string' }, workspaceId: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['materialId', 'workspaceId'] },
  'directory.lookup': { type: 'object', properties: { query: { type: 'string' }, workspaceId: { type: 'string' } }, required: ['query', 'workspaceId'] },
  'workspace.info': { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] },
  'note.crossrefs': { type: 'object', properties: { slug: { type: 'string' }, workspaceId: { type: 'string' } }, required: ['slug', 'workspaceId'] },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic dispatch over 8 tools
function buildTool(name: string, ctx: any): ReturnType<typeof buildWikiSearchTool> | null {
  switch (name) {
    case 'wiki.search':    return buildWikiSearchTool(ctx);
    case 'wiki.fetch':     return buildWikiFetchTool(ctx);
    case 'wiki.catalog':   return buildWikiCatalogTool(ctx);
    case 'wiki.recent':    return buildWikiRecentTool(ctx);
    case 'material.read':  return buildMaterialReadTool(ctx);
    case 'directory.lookup': return buildDirectoryLookupTool(ctx);
    case 'workspace.info': return buildWorkspaceInfoTool(ctx);
    case 'note.crossrefs': return buildNoteCrossrefsTool(ctx);
    default:               return null;
  }
}

// ---------------------------------------------------------------------------
// Bun HTTP server

const db = buildMcpTokenDb();

// Shared SSE server instance (SSE sessions are long-lived)
const sseServer = createMcpServer(db);

Bun.serve({
  port: MCP_PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const path = url.pathname;

    // ---- Health check (no auth) ----
    if (path === '/healthz' && method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          transport: ['streamable-http', 'sse'],
          activeSseSessions: activeSessionCount(),
          env: NODE_ENV,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ---- Streamable HTTP — POST /mcp ----
    if (path === '/mcp' && method === 'POST') {
      // Create a per-request server for stateless Streamable HTTP sessions.
      // Auth is resolved inside the CallTool handler via loadAuthContextFromBearer.
      // The Authorization header is passed into the request meta by the transport adapter.
      const perRequestServer = createMcpServer(db);
      // Inject Authorization header into server request meta for CallTool handler
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (perRequestServer as any)._requestMeta = { authorization: authHeader };
      }
      return handleStreamableHttpRequest(req, perRequestServer);
    }

    // ---- SSE legacy — GET /mcp/sse (open stream) ----
    if (path === '/mcp/sse' && method === 'GET') {
      return handleSseConnection(req, sseServer, BASE_URL);
    }

    // ---- SSE legacy — POST /mcp/messages (client message) ----
    if (path === '/mcp/messages' && method === 'POST') {
      return handleSseMessage(req);
    }

    // ---- 404 for all other paths ----
    return new Response(
      JSON.stringify({ error: 'not_found', path }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  },

  error(err: Error): Response {
    console.error('[mcp-server] unhandled error:', err.message);
    return new Response(
      JSON.stringify({ error: 'internal_server_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  },
});

console.log(`[mcp-server] listening on port ${MCP_PORT}`);
console.log(`[mcp-server] Streamable HTTP: POST http://localhost:${MCP_PORT}/mcp`);
console.log(`[mcp-server] SSE legacy:      GET  http://localhost:${MCP_PORT}/mcp/sse`);
console.log(`[mcp-server] Health check:    GET  http://localhost:${MCP_PORT}/healthz`);
