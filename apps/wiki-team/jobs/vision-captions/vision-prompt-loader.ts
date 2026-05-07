/**
 * vision-prompt-loader.ts — load the fresh-authored image caption prompt.
 *
 * Prompt file: apps/wiki-team/jobs/vision-captions/prompts/vision-v1.md
 * Authored independently of wiki-compile v1.md (different domain, different inputs).
 * Anti-trace: file is NOT excluded from the anti-trace grep script (ADR 015).
 *
 * Caches the prompt string in memory after first load to avoid repeated FS reads.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPT_PATH = join(__dirname, 'prompts', 'vision-v1.md');

let _cachedPrompt: string | null = null;

/**
 * Load and return the vision caption prompt.
 * Cached after first read. Throws if file is missing or empty.
 */
export async function loadVisionPrompt(): Promise<string> {
  if (_cachedPrompt !== null) return _cachedPrompt;

  const content = await readFile(PROMPT_PATH, 'utf-8');
  if (!content || content.trim().length === 0) {
    throw new Error('[vision-prompt-loader] vision-v1.md is empty or missing');
  }

  _cachedPrompt = content.trim();
  return _cachedPrompt;
}

/** Reset cache — for testing only */
export function _resetPromptCache(): void {
  _cachedPrompt = null;
}
