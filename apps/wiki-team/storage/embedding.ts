/**
 * embedding.ts — DEPRECATED direct Gemini embedding helper.
 *
 * As of P04 (ADR 013), all embedding calls are routed through the provider
 * abstraction in `services/embedding-router.ts`. GEMINI_API_KEY env var is
 * no longer needed — API keys are stored encrypted in provider_settings table.
 *
 * This file is kept for backwards compatibility only. All functions now
 * delegate to the embedding-router or are no-ops with deprecation warnings.
 *
 * @deprecated Use `embedNote(workspaceId, text)` from `services/embedding-router.ts`.
 */

import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants (preserved for any legacy callers reading EMBEDDING_DIM)

/** @deprecated Dimension is now determined dynamically by the active provider. */
export const EMBEDDING_DIM = 768 as const;

// ---------------------------------------------------------------------------
// embed — DEPRECATED

/**
 * @deprecated Use `embedNote(workspaceId, text)` from `services/embedding-router.ts`.
 * This function previously called Gemini directly. It now throws immediately to
 * surface any stale callers during development.
 */
export async function embed(_text: string): Promise<Float32Array> {
  logger.error(
    '[embedding] embed() is DEPRECATED. Use embedNote(workspaceId, text) from services/embedding-router.ts. ' +
    'GEMINI_API_KEY is no longer used — provider keys are stored in provider_settings table.',
  );
  throw new Error(
    '[embedding] Direct Gemini embedding is removed. ' +
    'Configure an embedding provider in workspace Settings and use embedNote() instead.',
  );
}

/**
 * @deprecated Use batch embed via EmbeddingProvider.embed([texts]) from ProviderFactory.
 */
export async function embedBatch(_texts: string[]): Promise<Float32Array[]> {
  throw new Error('[embedding] embedBatch() is DEPRECATED — use embedNote() per-note or EmbeddingProvider.embed([texts]).');
}

/**
 * Convert a Float32Array embedding to a number[] for Drizzle vector column insertion.
 * This utility remains valid — not deprecated.
 */
export function embeddingToArray(embedding: Float32Array): number[] {
  return Array.from(embedding);
}
