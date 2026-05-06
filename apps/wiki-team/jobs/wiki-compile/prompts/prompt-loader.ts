/**
 * prompt-loader.ts — load system prompt from v1.md at process boot
 *
 * Reads the markdown file once and caches the result for the process lifetime.
 * Subsequent calls return the cached string without I/O.
 *
 * Design rationale:
 *   - Prompt lives in an external .md file (not an inlined TS string) to
 *     support A/B testing, audit trails, and clean-room re-authoring protocol.
 *   - Cache-per-process is safe because the file does not change at runtime;
 *     a new deployment always starts a fresh process.
 *
 * Throws at boot if the file is missing or contains only the STUB header —
 * this prevents accidentally running a compile job with a placeholder prompt.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Module-level cache — populated on first call

let _cachedPrompt: string | null = null;

// ---------------------------------------------------------------------------
// Resolve path to v1.md relative to this file

function resolvePromptPath(): string {
  // __dirname equivalent in ESM
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, 'v1.md');
}

// ---------------------------------------------------------------------------
// loadSystemPrompt — primary export

/**
 * Return the system prompt string, loading from disk on first call.
 *
 * @throws  If v1.md is missing, unreadable, or still contains the STUB header.
 */
export function loadSystemPrompt(): string {
  if (_cachedPrompt !== null) return _cachedPrompt;

  const promptPath = resolvePromptPath();
  let raw: string;

  try {
    raw = readFileSync(promptPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `[prompt-loader] Cannot read system prompt at "${promptPath}": ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (raw.trim().length === 0) {
    throw new Error(`[prompt-loader] System prompt at "${promptPath}" is empty`);
  }

  // Detect unfinished STUB — prevent running production jobs with placeholder text
  if (raw.includes('STUB — fresh subagent will author full prompt')) {
    throw new Error(
      '[prompt-loader] System prompt is still a STUB. ' +
      'Run the fresh-subagent prompt authoring step and replace v1.md before starting the worker.',
    );
  }

  _cachedPrompt = raw;
  return _cachedPrompt;
}

// ---------------------------------------------------------------------------
// resetPromptCache — for testing only

/**
 * Clear the in-memory cache so tests can inject different prompt content.
 * NOT for production use.
 *
 * @internal
 */
export function resetPromptCache(): void {
  _cachedPrompt = null;
}
