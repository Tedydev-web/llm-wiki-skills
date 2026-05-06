/**
 * index.ts — public surface re-exports for @wiki-team/mcp
 *
 * Consumers import from this entry point only — never from sub-modules directly.
 * Surface is intentionally minimal: only primitives needed by mcp-host/server.ts.
 */

// Local type aliases (no cross-package relative imports)
export type { AuthContext, McpTokenDb, McpTokenRow, Decision, DenyReason } from './types.js';

// Tool registration helper
export type { ToolDefinition } from './define-tool.js';
export { defineTool } from './define-tool.js';

// Bearer auth middleware
export type { VerifyMcpTokenFn } from './mcp-auth.js';
export { loadAuthContextFromBearer, extractBearerToken, invalidateCacheByPrefix } from './mcp-auth.js';

// RBAC error mapper
export { throwIfDenied, redactAuthorizationHeader, wrapToolError } from './error-mapper.js';

// Transports
export { handleStreamableHttpRequest } from './transports/streamable-http-server.js';
export { handleSseConnection, handleSseMessage, activeSessionCount } from './transports/sse-server.js';
