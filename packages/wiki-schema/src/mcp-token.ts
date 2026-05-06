/**
 * mcp-token.ts — MCPToken Zod schema
 *
 * Security requirements per ADR 012:
 *   - Token ID prefix: "wkt_" followed by ≥32 alphanumeric chars
 *   - prefixLookup: HMAC-SHA256(fullToken, BETTER_AUTH_SECRET) truncated to 16 hex chars
 *                   — indexed unique; NO plaintext bits leak to disk
 *   - tokenHash: argon2id hash of the full token — NEVER store plain token
 *   - No tokenPlain field — prevents accidental serialization of raw secret
 *   - scopes: array of PermissionGrant (ADR 010 permission model)
 */

import { z } from 'zod';
import { permissionGrantSchema } from './permission.js';

// ---------------------------------------------------------------------------
// MCPToken

export const mcpTokenSchema = z.object({
  /** Prefixed ID: "wkt_<32+ alphanumeric chars>" (ADR 012) */
  id:           z.string().regex(/^wkt_[a-zA-Z0-9]{32,}$/),
  workspaceId:  z.string().uuid(),
  ownerId:      z.string().uuid(),
  /** HMAC-SHA256(fullToken, BETTER_AUTH_SECRET) truncated to 16 hex chars — indexed unique */
  prefixLookup: z.string().length(16),
  /** argon2id hash of the full token — NEVER the raw token value */
  tokenHash:    z.string().min(1),
  /** Knowledge base IDs this token may access */
  grantedKbIds: z.array(z.string().uuid()),
  /** Page taxonomy types this token may access (subset of pageTaxonomySchema enum values) */
  grantedPageTypes: z.array(z.string()),
  /** Workspace-scoped permission grants for this token */
  scopes:       z.array(permissionGrantSchema),
  createdAt:    z.string().datetime(),
  expiresAt:    z.string().datetime().nullable(),
  revokedAt:    z.string().datetime().nullable(),
}).strict();

export type MCPToken = z.infer<typeof mcpTokenSchema>;

// ---------------------------------------------------------------------------
// MCPToken issuance input (POST /auth/mcp-tokens — steward or owner required)

export const mcpTokenCreateInputSchema = z.object({
  workspaceId:      z.string().uuid(),
  grantedKbIds:     z.array(z.string().uuid()).min(1),
  grantedPageTypes: z.array(z.string()).default([]),
  scopes:           z.array(permissionGrantSchema).min(1),
  /** ISO datetime; null = non-expiring */
  expiresAt:        z.string().datetime().nullable().default(null),
}).strict();

export type MCPTokenCreateInput = z.infer<typeof mcpTokenCreateInputSchema>;

// ---------------------------------------------------------------------------
// McpAccessContext — built from a verified token (ADR 010 §MCP scope resolution)

export const mcpAccessContextSchema = z.object({
  workspaceId:      z.string().uuid(),
  allowedKbIds:     z.array(z.string().uuid()),
  allowedPageTypes: z.array(z.string()),
  scopes:           z.array(permissionGrantSchema),
}).strict();

export type McpAccessContext = z.infer<typeof mcpAccessContextSchema>;
