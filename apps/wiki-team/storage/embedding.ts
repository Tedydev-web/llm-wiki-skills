/**
 * embedding.ts — Gemini text-embedding-004 helper
 *
 * Returns a 768-dimensional Float32Array for a given text input.
 * Model: text-embedding-004 (Gemini) — 768 dim matches notes.embedding vector(768).
 *
 * Env vars:
 *   GEMINI_API_KEY — Google AI Studio key (see .env.example)
 *
 * IMPORTANT: embedding dim is locked to 768 by the DB schema (vector(768) column).
 * Changing the model to one with different output dim requires a migration.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ---------------------------------------------------------------------------
// Constants

/** Output dimension of text-embedding-004 — matches vector(768) SQL column. */
export const EMBEDDING_DIM = 768 as const;

/** Gemini embedding model identifier. */
const EMBEDDING_MODEL = 'text-embedding-004' as const;

/** Maximum input characters before truncation warning (Gemini limit ~2048 tokens ≈ 8000 chars). */
const MAX_INPUT_CHARS = 8000;

// ---------------------------------------------------------------------------
// Client singleton

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (_client) return _client;

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('[embedding] GEMINI_API_KEY is not set. Add it to your .env file.');
  }
  if (apiKey === 'your-gemini-api-key-here') {
    throw new Error('[embedding] GEMINI_API_KEY still has placeholder value. Set a real API key.');
  }

  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

// ---------------------------------------------------------------------------
// embed — main public API

/**
 * Embed a text string using Gemini text-embedding-004.
 * Returns a Float32Array of length 768.
 *
 * @param text — input text to embed; silently truncated to MAX_INPUT_CHARS
 * @throws if GEMINI_API_KEY is missing/placeholder or API call fails
 */
export async function embed(text: string): Promise<Float32Array> {
  if (text.length > MAX_INPUT_CHARS) {
    // Truncate and continue — do not throw; warn instead so callers don't crash on long docs
    console.warn(
      `[embedding] Input truncated from ${text.length} to ${MAX_INPUT_CHARS} chars ` +
      'before embedding. Consider chunking long documents.',
    );
    text = text.slice(0, MAX_INPUT_CHARS);
  }

  const client = getClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent(text);
  const values = result.embedding.values;

  if (values.length !== EMBEDDING_DIM) {
    throw new Error(
      `[embedding] Unexpected embedding dimension: got ${values.length}, expected ${EMBEDDING_DIM}. ` +
      'Model may have changed. Update EMBEDDING_DIM and re-migrate the DB schema.',
    );
  }

  return new Float32Array(values);
}

/**
 * Embed multiple texts in sequence (no batching — Gemini free tier is rate-limited).
 * Returns array of Float32Array, one per input text.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

/**
 * Convert a Float32Array embedding to a number[] for Drizzle vector column insertion.
 */
export function embeddingToArray(embedding: Float32Array): number[] {
  return Array.from(embedding);
}
