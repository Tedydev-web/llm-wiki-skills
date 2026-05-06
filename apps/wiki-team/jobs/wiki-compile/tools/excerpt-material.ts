/**
 * excerpt-material.ts — excerptMaterial tool: read a slice of the source material text
 *
 * Returns a windowed excerpt of the already-extracted material text. The
 * full text lives in the job context (not the DB) to avoid re-extraction on
 * every agent step.
 *
 * SECURITY — prompt injection mitigation:
 *   All content is wrapped in XML delimiters:
 *     <material id="<id>" untrusted="true">…content…</material>
 *   Any nested </material> tags in the content are escaped to [/material]
 *   so a poisoned document cannot close the delimiter early.
 *   The system prompt instructs the model to treat <material> blocks as
 *   data, not instruction (per phase-06 step 5 + ADR 010 security notes).
 *
 * RBAC gate: kb.view — material access requires KB read permission.
 */

import { z } from 'zod';
import { evaluatePolicy } from '../../../rbac/index.js';
import type { AuthContext } from '../../../auth/auth-context.js';

// ---------------------------------------------------------------------------
// Constants — own values per phase-06 spec

/** Maximum chars returned per excerptMaterial call */
export const MATERIAL_EXCERPT_CAP = 20_000;

// ---------------------------------------------------------------------------
// Schemas

export const excerptMaterialInputSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Opaque material ID — used in the XML wrapper for traceability */
  materialId: z.string().uuid(),
  /** Character offset to start reading from (0-indexed) */
  charOffset: z.number().int().min(0).default(0),
  /** How many chars to return; capped at MATERIAL_EXCERPT_CAP */
  charCount: z.number().int().min(1).max(MATERIAL_EXCERPT_CAP).default(MATERIAL_EXCERPT_CAP),
});

export type ExcerptMaterialInput = z.infer<typeof excerptMaterialInputSchema>;

export const excerptMaterialOutputSchema = z.object({
  /** XML-wrapped content: <material id="..." untrusted="true">…</material> */
  wrappedContent: z.string(),
  charOffset: z.number().int().min(0),
  charsReturned: z.number().int().min(0),
  totalChars: z.number().int().min(0),
  hasMore: z.boolean(),
});

export type ExcerptMaterialOutput = z.infer<typeof excerptMaterialOutputSchema>;

// ---------------------------------------------------------------------------
// escapeNestedMaterialTag — prevent prompt injection via early delimiter close

/**
 * Escape any `</material>` substring in content so it cannot break out of
 * the XML wrapper. Replaces with the visually similar `[/material]`.
 *
 * Also escapes `<material` to prevent nested material tags from confusing
 * the model's tag-matching heuristics.
 */
export function escapeNestedMaterialTag(content: string): string {
  return content
    .replace(/<\/material>/gi, '[/material]')
    .replace(/<material/gi, '[material');
}

// ---------------------------------------------------------------------------
// wrapInMaterialXml — attach XML envelope

function wrapInMaterialXml(id: string, content: string): string {
  const escaped = escapeNestedMaterialTag(content);
  return `<material id="${id}" untrusted="true">${escaped}</material>`;
}

// ---------------------------------------------------------------------------
// Tool handler

/**
 * Return a char-windowed excerpt of the material text, wrapped in a
 * prompt-injection-resistant XML envelope.
 *
 * @param ctx           AuthContext (RBAC gate)
 * @param input         Validated excerpt request
 * @param materialText  Full extracted text for the material (held in job context)
 */
export async function handleExcerptMaterial(
  ctx: AuthContext,
  input: ExcerptMaterialInput,
  materialText: string,
): Promise<ExcerptMaterialOutput> {
  // RBAC gate — kb.view required to access raw material text
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  if (!decision.allow) {
    throw Object.assign(
      new Error(`rbac-denied: ${decision.reason}`),
      { code: 'rbac-denied' },
    );
  }

  const totalChars = materialText.length;
  const offset = Math.min(input.charOffset, totalChars);
  const requestedCount = Math.min(input.charCount, MATERIAL_EXCERPT_CAP);
  const slice = materialText.slice(offset, offset + requestedCount);
  const charsReturned = slice.length;
  const hasMore = offset + charsReturned < totalChars;

  return {
    wrappedContent: wrapInMaterialXml(input.materialId, slice),
    charOffset: offset,
    charsReturned,
    totalChars,
    hasMore,
  };
}
