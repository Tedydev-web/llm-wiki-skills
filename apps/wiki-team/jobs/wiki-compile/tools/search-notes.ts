/**
 * search-notes.ts — searchNotes tool: semantic search over compiled notes
 *
 * Uses pgvector cosine distance (<=> operator) to find the top-K most
 * relevant notes given a query string. Embeds the query via Gemini
 * text-embedding-004 (same model as note embeddings — dimension-matched).
 *
 * RBAC gate: page.view — evaluated before DB access.
 */

import { z } from 'zod';
import { sql, and, eq, isNull } from 'drizzle-orm';
import { evaluatePolicy } from '../../rbac/index.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { getDb, schema } from '../../storage/db.js';
import { embed } from '../../storage/embedding.js';

// ---------------------------------------------------------------------------
// Constants — own values per phase-06 spec

const TOP_K_DEFAULT = 5;
const TOP_K_MAX = 20;

// ---------------------------------------------------------------------------
// Schemas

export const searchNotesInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kbId: z.string().uuid(),
  query: z.string().min(1).max(1000),
  topK: z.number().int().min(1).max(TOP_K_MAX).default(TOP_K_DEFAULT),
});

export type SearchNotesInput = z.infer<typeof searchNotesInputSchema>;

export const searchNotesOutputSchema = z.object({
  results: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      taxonomy: z.string(),
      /** Leading excerpt (first 300 chars of content) */
      excerpt: z.string(),
      /** Cosine distance score: 0 = identical, 2 = maximally distant */
      score: z.number(),
    }),
  ),
});

export type SearchNotesOutput = z.infer<typeof searchNotesOutputSchema>;

// ---------------------------------------------------------------------------
// Tool handler

export async function handleSearchNotes(
  ctx: AuthContext,
  input: SearchNotesInput,
): Promise<SearchNotesOutput> {
  // RBAC gate
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  if (!decision.allow) {
    throw Object.assign(
      new Error(`rbac-denied: ${decision.reason}`),
      { code: 'rbac-denied' },
    );
  }

  // Embed the query using the same model as stored embeddings
  const queryVector = await embed(input.query);
  const vectorLiteral = `[${queryVector.join(',')}]`;

  const db = getDb();

  // pgvector cosine distance: embedding <=> $vec::vector
  // Drizzle does not have first-class pgvector support — use sql`` escape hatch.
  const rows = await db
    .select({
      slug: schema.notes.slug,
      title: schema.notes.title,
      taxonomy: schema.notes.taxonomy,
      content: schema.notes.content,
      score: sql<number>`${schema.notes.embedding} <=> ${sql.raw(`'${vectorLiteral}'`)}::vector`,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, input.workspaceId),
        eq(schema.notes.kbId, input.kbId),
        isNull(schema.notes.deletedAt),
        sql`${schema.notes.embedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${schema.notes.embedding} <=> ${sql.raw(`'${vectorLiteral}'`)}::vector`)
    .limit(input.topK);

  return {
    results: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      taxonomy: r.taxonomy,
      excerpt: r.content.slice(0, 300),
      score: r.score,
    })),
  };
}
