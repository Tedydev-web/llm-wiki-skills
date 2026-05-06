/**
 * directory-lookup.ts — directory.lookup tool handler
 *
 * Search workspace members by name/email. Admin-tier gated per ADR 012 + phase-07 spec.
 *
 * RBAC gating:
 *   - evaluatePolicy(ctx, { resource: 'tenant', workspaceId }, { verb: 'manage' }) → admin tier
 *   - Non-admin callers with 'mcp.view.all' OR workspace membership get {userId, displayName} only
 *   - Admin callers (global-admin OR manage grant) also receive email field
 *
 * Security: email field is stripped for non-admin callers — enforced in handler, not post-process.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, or, ilike, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const DirectoryLookupInputSchema = z.object({
  query: z.string().min(1).max(200),
  workspaceId: z.string().uuid(),
});

// Full output (admin callers)
const DirectoryEntryAdminSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string().email(),
});

// Restricted output (non-admin callers) — no email
const DirectoryEntryPublicSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
});

const DirectoryLookupOutputSchema = z.object({
  people: z.array(
    z.union([DirectoryEntryAdminSchema, DirectoryEntryPublicSchema]),
  ),
  callerIsAdmin: z.boolean(),
});

async function directoryLookupHandler(
  input: z.infer<typeof DirectoryLookupInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof DirectoryLookupOutputSchema>> {
  // 1. Must be a workspace member to use this tool at all (page.view minimum)
  const viewDecision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(viewDecision, 'directory.lookup');

  // 2. Determine admin status — admin = global-admin OR tenant.manage grant
  const adminDecision = evaluatePolicy(
    ctx,
    { resource: 'tenant', workspaceId: input.workspaceId },
    { verb: 'manage' },
  );
  const callerIsAdmin = adminDecision.allow;

  const db = getDb();

  // Escape ILIKE metacharacters (%, _, \) in user input so a literal '%' query
  // doesn't exfiltrate the entire directory. The escape char is '\' (the SQL
  // default for LIKE/ILIKE) — same char must appear before ESCAPE in the clause
  // (which Postgres assumes by default for ILIKE, so no explicit ESCAPE needed).
  const escaped = input.query.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
  const ilikePattern = `%${escaped}%`;

  // 3. Query members + users (joined) for the workspace
  //    Use ILIKE for case-insensitive name/email search
  const rows = await db
    .select({
      userId: schema.members.userId,
      // user fields come from Better Auth users table; schema.users is the auth table
      // Fallback: use userId as display name if users table not in schema
      displayName: sql<string>`COALESCE(
        (SELECT name FROM "user" u WHERE u.id = ${schema.members.userId}),
        ${schema.members.userId}
      )`.as('display_name'),
      email: sql<string>`COALESCE(
        (SELECT email FROM "user" u WHERE u.id = ${schema.members.userId}),
        ''
      )`.as('email'),
    })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, input.workspaceId),
        or(
          sql`(SELECT name FROM "user" u WHERE u.id = ${schema.members.userId})
              ILIKE ${ilikePattern}`,
          callerIsAdmin
            ? sql`(SELECT email FROM "user" u WHERE u.id = ${schema.members.userId})
                  ILIKE ${ilikePattern}`
            : sql`FALSE`,
        ),
      ),
    )
    .limit(20);

  // 4. Apply admin gate: strip email for non-admin callers
  const people = rows.map((r) => {
    if (callerIsAdmin) {
      return DirectoryEntryAdminSchema.parse({
        userId: r.userId,
        displayName: r.displayName,
        email: r.email,
      });
    }
    // Non-admin: return restricted shape only — email field intentionally omitted
    return DirectoryEntryPublicSchema.parse({
      userId: r.userId,
      displayName: r.displayName,
    });
  });

  return DirectoryLookupOutputSchema.parse({ people, callerIsAdmin });
}

export function buildDirectoryLookupTool(ctx: AuthContext) {
  return defineTool({
    name: 'directory.lookup',
    description:
      'Search workspace members by name (or email for admins). ' +
      'Non-admin callers receive userId and displayName only. ' +
      'Admin callers also receive the email field.',
    inputSchema: DirectoryLookupInputSchema,
    handler: (input) =>
      directoryLookupHandler(input, ctx).catch((err) => wrapToolError(err, 'directory.lookup')),
  });
}
