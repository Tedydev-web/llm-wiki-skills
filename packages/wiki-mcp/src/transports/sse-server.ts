/**
 * sse-server.ts — SSE legacy fallback transport (v2.0 SHIM)
 *
 * v2.0 status: STUB ONLY. Returns 501 Not Implemented with a deprecation
 * pointer to the Streamable HTTP endpoint (/mcp). Full SSE support requires
 * Node http response types that don't map cleanly to Bun's Web Response model;
 * the upstream SDK's SSEServerTransport constructor expects Node http types,
 * not the callback shape an earlier draft assumed.
 *
 * Why ship the stub:
 *   1. Streamable HTTP is the current MCP spec (POST /mcp) and works on Bun.
 *   2. No real-world MCP client today targets SSE-only — Claude Desktop,
 *      mcp-cli, and the SDK reference clients all support Streamable HTTP.
 *   3. ADR 012 dual-transport requirement is satisfied structurally (both
 *      endpoints exist) with the explicit deferral documented here and in
 *      ADR 012's "v2.0 implementation notes" amendment (added by P12).
 *
 * Re-enable plan (v2.1):
 *   - When a real SSE-only client surfaces, port to a Bun-native SSE adapter
 *     that wraps the SDK's SSEServerTransport with Node http types via a
 *     polyfill (or migrate to Hono's stream helpers if SDK exposes a more
 *     transport-agnostic API by then).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ---------------------------------------------------------------------------
// Stub handlers — return 501 with a Streamable HTTP pointer

function deprecatedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'sse_transport_not_implemented',
      message:
        'SSE legacy transport is deferred to v2.1. Use Streamable HTTP at POST /mcp instead.',
      streamableHttpEndpoint: '/mcp',
      adr: 'docs/decisions/012-mcp-exposure-protocol.md',
    }),
    {
      status: 501,
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Transport-Status': 'sse-deferred-to-v2.1',
      },
    },
  );
}

/**
 * Handle GET /mcp/sse — would open the SSE event stream.
 * v2.0: returns 501 with deprecation pointer.
 *
 * Signature kept as `(request, server, baseUrl)` for caller-site compatibility
 * with the original P07 draft so server.ts wiring does not need to change.
 */
export async function handleSseConnection(
  _request: Request,
  _server: Server,
  _baseUrl: string,
): Promise<Response> {
  return deprecatedResponse();
}

/**
 * Handle POST /mcp/messages?sessionId=... — would route client JSON-RPC into the SSE session.
 * v2.0: returns 501 with deprecation pointer.
 */
export async function handleSseMessage(_request: Request): Promise<Response> {
  return deprecatedResponse();
}

/**
 * Active SSE session count — always 0 in v2.0 (stub).
 * Kept for API compatibility with v2.1 implementation.
 */
export function activeSessionCount(): number {
  return 0;
}
