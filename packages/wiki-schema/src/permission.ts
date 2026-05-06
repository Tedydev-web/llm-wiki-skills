/**
 * permission.ts — PermissionGrant Zod schema + permission-string parser
 *
 * Format: "<resource>.<verb>.<scope>" (DOT-separated per ADR 010)
 * Resources: kb | page | tenant | mcp
 * Verbs:     view | edit | delete | manage
 * Scopes:    own | shared | all
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema

export const permissionGrantSchema = z.object({
  resource: z.enum(['kb', 'page', 'tenant', 'mcp']),
  verb: z.enum(['view', 'edit', 'delete', 'manage']),
  scope: z.enum(['own', 'shared', 'all']),
});

export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

// Canonical permission string regex (used at HTTP boundary per ADR 010)
export const permissionStringSchema = z
  .string()
  .regex(/^(kb|page|tenant|mcp)\.(view|edit|delete|manage)\.(own|shared|all)$/);

// ---------------------------------------------------------------------------
// Parser

/**
 * Parse a permission string into a validated PermissionGrant.
 * Throws on malformed input — NEVER returns a silent default (ADR 010 security req).
 */
export function parsePermission(s: string): PermissionGrant {
  const parts = s.split('.');
  if (parts.length !== 3) {
    throw new Error(`Malformed permission string (expected 3 dot-segments): "${s}"`);
  }
  return permissionGrantSchema.parse({ resource: parts[0], verb: parts[1], scope: parts[2] });
}

// ---------------------------------------------------------------------------
// Inline validation (runs outside test env to surface regressions during import)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env: string | undefined = (globalThis as any)?.process?.env?.['NODE_ENV'];
if (_env !== 'test') {
  // Case 1: valid grant
  const c1 = parsePermission('kb.view.own');
  console.assert(c1.resource === 'kb' && c1.verb === 'view' && c1.scope === 'own', 'case1 failed');

  // Case 2: malformed (too few segments) — must throw
  let threw2 = false;
  try { parsePermission('kb.view'); } catch { threw2 = true; }
  console.assert(threw2, 'case2: expected throw for "kb.view"');

  // Case 3: unknown verb — Zod enum must reject
  let threw3 = false;
  try { parsePermission('kb.fly.own'); } catch { threw3 = true; }
  console.assert(threw3, 'case3: expected throw for unknown verb "fly"');

  // Case 4: valid MCP manage grant
  const c4 = parsePermission('mcp.manage.all');
  console.assert(c4.resource === 'mcp' && c4.verb === 'manage' && c4.scope === 'all', 'case4 failed');
}
