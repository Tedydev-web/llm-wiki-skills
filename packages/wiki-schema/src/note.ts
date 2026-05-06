/**
 * note.ts — Note (compiled wiki page) Zod schema
 *
 * Vocabulary per ADR 010 / phase-02:
 *   - Note: compiled wiki page (v2 name per ADR 010)
 *   - PageTaxonomy: fact | analysis | procedure | reference (ADR 010 final)
 *   - Sentinel slugs: __catalog (index page), __history (audit page)
 *
 * Version column semantics per ADR 011:
 *   - version: positive integer, starts at 1, incremented on each content write
 *   - never reset to 0; soft-delete does not increment version
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// PageTaxonomy — page classification (ADR 010; fact/analysis/procedure/reference)

export const pageTaxonomySchema = z.enum([
  'fact',       // factual reference (definitions, specs, data)
  'analysis',   // analysis / reasoning artifact
  'procedure',  // how-to, runbook, step-by-step
  'reference',  // external reference / bibliography
]);

export type PageTaxonomy = z.infer<typeof pageTaxonomySchema>;

// ---------------------------------------------------------------------------
// Sentinel slugs (string constants — not type names)

export const SENTINEL_SLUG_CATALOG = '__catalog' as const;
export const SENTINEL_SLUG_HISTORY = '__history' as const;

// ---------------------------------------------------------------------------
// Note

export const noteSchema = z.object({
  id:          z.string().uuid(),
  workspaceId: z.string().uuid(),
  kbId:        z.string().uuid(),
  slug:        z.string().min(1).max(120).regex(/^[a-z0-9_-]+$/),
  title:       z.string().min(1).max(255),
  content:     z.string(),
  taxonomy:    pageTaxonomySchema,
  tags:        z.array(z.string().max(64)),
  /** Wikilink slugs this page links to */
  links:       z.array(z.string()),
  /** Optimistic concurrency version (ADR 011: starts at 1, never 0) */
  version:     z.number().int().min(1),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
  deletedAt:   z.string().datetime().nullable(),
}).strict();

export type Note = z.infer<typeof noteSchema>;

// ---------------------------------------------------------------------------
// Note update DTO — client sends content + version to detect conflicts (ADR 011)

export const noteUpdateInputSchema = z.object({
  content: z.string(),
  version: z.number().int().min(1),  // must match current server version
}).strict();

export type NoteUpdateInput = z.infer<typeof noteUpdateInputSchema>;
