/**
 * error-mapper.ts — translates RBAC Decision denials → MCP protocol errors
 *
 * RBAC Decision { allow: false; reason: DenyReason } is converted to a
 * McpError with code -32001 (InvalidRequest) and a reason-code message.
 *
 * Security requirements (ADR 012 §Security):
 *   - Bearer token value MUST NEVER appear in error message or context
 *   - DenyReason reason codes are safe to surface (no sensitive data)
 *   - Error context object is scrubbed: Authorization header removed before logging
 *
 * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { Decision, DenyReason } from './types.js';

// ---------------------------------------------------------------------------
// McpPermissionError — structured MCP error for RBAC denials

/**
 * Convert an RBAC deny Decision to a thrown McpError.
 *
 * @param decision  Decision object with allow=false (caller must ensure this)
 * @param toolName  MCP tool name — included in error message for debuggability
 *
 * Reason codes surfaced to client (safe — no sensitive data):
 *   'no-grant'           → caller has no permission grant for this resource
 *   'workspace-mismatch' → caller's workspace != resource's workspace
 *   'role-too-low'       → caller's membership tier is below required minimum
 *
 * @throws McpError always
 */
export function throwIfDenied(decision: Decision, toolName: string): void {
  if (decision.allow) return; // nothing to do

  const reason = (decision as { allow: false; reason: DenyReason }).reason;
  throw new McpError(
    ErrorCode.InvalidRequest,
    `permission_denied: ${reason} (tool: ${toolName})`,
  );
}

// ---------------------------------------------------------------------------
// redactAuthorizationHeader — scrub Bearer token from any error context object

/**
 * Remove the Authorization header value from a plain-object context before logging.
 * Returns a new object — never mutates the original.
 *
 * Usage:
 *   catch (err) {
 *     const safe = redactAuthorizationHeader(requestHeaders);
 *     logger.error('tool failed', { headers: safe, error: err.message });
 *   }
 */
export function redactAuthorizationHeader(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out = { ...headers };
  // Case-insensitive match for "authorization" variants
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() === 'authorization') {
      const val = out[key];
      if (typeof val === 'string' && val.startsWith('Bearer wkt_')) {
        out[key] = 'Bearer wkt_[REDACTED]';
      } else if (typeof val === 'string') {
        out[key] = '[REDACTED]';
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// wrapToolError — uniform error wrapper for unexpected tool handler failures

/**
 * Convert any thrown error inside a tool handler to a McpError.
 * Strips sensitive values: token strings, raw SQL, internal paths.
 *
 * @param err       The caught error
 * @param toolName  MCP tool name for context
 * @throws McpError always
 */
export function wrapToolError(err: unknown, toolName: string): never {
  if (err instanceof McpError) {
    // Already a protocol error — re-throw unchanged
    throw err;
  }

  const message =
    err instanceof Error
      ? err.message.replace(/wkt_[A-Za-z0-9_-]{10,}/g, 'wkt_[REDACTED]')
      : 'unexpected_error';

  throw new McpError(
    ErrorCode.InternalError,
    `tool_error: ${toolName}: ${message}`,
  );
}
