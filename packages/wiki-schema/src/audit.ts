/**
 * audit.ts — AuditEvent Zod schema
 *
 * Records every significant state-change action in the system for compliance,
 * debugging, and history page (__history sentinel slug from note.ts).
 *
 * Immutable append-only — no update/delete on audit rows.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AuditAction — discrete action types recorded in the audit log

export const auditActionSchema = z.enum([
  // Note (wiki page) actions
  'note.created',
  'note.updated',
  'note.deleted',
  // Material (source) actions
  'material.uploaded',
  'material.ingest_started',
  'material.ingest_completed',
  'material.ingest_failed',
  'material.deleted',
  // Membership actions
  'member.invited',
  'member.tier_changed',
  'member.removed',
  // MCP token actions
  'mcp_token.issued',
  'mcp_token.revoked',
  // Workspace actions
  'workspace.created',
  'workspace.settings_updated',
  'workspace.deleted',
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

// ---------------------------------------------------------------------------
// AuditEvent

export const auditEventSchema = z.object({
  id:          z.string().uuid(),
  workspaceId: z.string().uuid(),
  /** User who performed the action; null for system/worker actions */
  actorId:     z.string().uuid().nullable(),
  action:      auditActionSchema,
  /** The primary resource type affected */
  resourceType: z.enum(['note', 'material', 'member', 'mcp_token', 'workspace']),
  /** UUID of the affected resource */
  resourceId:  z.string().uuid(),
  /** Arbitrary JSON payload with before/after state or context */
  payload:     z.record(z.unknown()).nullable(),
  /** Client IP address for auth events; null for worker events */
  ipAddress:   z.string().nullable(),
  createdAt:   z.string().datetime(),
}).strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;
