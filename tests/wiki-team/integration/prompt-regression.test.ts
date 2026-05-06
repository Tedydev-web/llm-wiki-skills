/**
 * prompt-regression.test.ts — SHA-256 golden hash gate for agent prompts
 *
 * Pins the content hash of two critical prompt files:
 *   - apps/wiki-team/jobs/wiki-compile/prompts/v1.md
 *   - apps/wiki-team/mcp-host/system-instructions.md
 *
 * If either file drifts, this test fails — requiring a deliberate hash update
 * plus manual reviewer sign-off before merge. This is an intentional friction gate.
 *
 * TO UPDATE: run `shasum -a 256 <file>` and replace the GOLDEN_* constant below.
 * Commit the hash change in a separate commit with message:
 *   "test: update prompt golden hash — <reason for prompt change>"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Golden hashes — update these when prompts change (requires reviewer sign-off)

/**
 * SHA-256 of apps/wiki-team/jobs/wiki-compile/prompts/v1.md
 * Pinned: 2026-05-06
 */
const GOLDEN_V1_PROMPT_SHA256 =
  '3a5e2b4a208d82e875216664febc11579629fe7bf0ff61e6abdece657fba88bc';

/**
 * SHA-256 of apps/wiki-team/mcp-host/system-instructions.md
 * Pinned: 2026-05-06
 */
const GOLDEN_MCP_SYSTEM_SHA256 =
  '0067d3cf236965a13ca4f258ad7a865cb95293bbda280a387a22ec63a5d87932';

// ---------------------------------------------------------------------------
// Helpers

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function repoRoot(): string {
  // Walk up from this file's location to find the monorepo root
  // Tests run with CWD = repo root; use process.cwd() as fallback
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Tests

describe('prompt regression — golden hash gate', () => {
  it('v1.md hash matches pinned golden value', () => {
    const filePath = join(repoRoot(), 'apps/wiki-team/jobs/wiki-compile/prompts/v1.md');
    const actual = sha256File(filePath);

    expect(actual).toBe(GOLDEN_V1_PROMPT_SHA256);
    // ^^^ FAILS? Update GOLDEN_V1_PROMPT_SHA256 above after reviewer sign-off.
    // Run: shasum -a 256 apps/wiki-team/jobs/wiki-compile/prompts/v1.md
  });

  it('mcp-host/system-instructions.md hash matches pinned golden value', () => {
    const filePath = join(repoRoot(), 'apps/wiki-team/mcp-host/system-instructions.md');
    const actual = sha256File(filePath);

    expect(actual).toBe(GOLDEN_MCP_SYSTEM_SHA256);
    // ^^^ FAILS? Update GOLDEN_MCP_SYSTEM_SHA256 above after reviewer sign-off.
    // Run: shasum -a 256 apps/wiki-team/mcp-host/system-instructions.md
  });

  it('v1.md is non-empty and not a STUB', () => {
    const filePath = join(repoRoot(), 'apps/wiki-team/jobs/wiki-compile/prompts/v1.md');
    const content = readFileSync(filePath, 'utf-8');

    expect(content.trim().length).toBeGreaterThan(100);
    expect(content).not.toContain('STUB — fresh subagent will author full prompt');
  });

  it('system-instructions.md is non-empty', () => {
    const filePath = join(repoRoot(), 'apps/wiki-team/mcp-host/system-instructions.md');
    const content = readFileSync(filePath, 'utf-8');

    expect(content.trim().length).toBeGreaterThan(10);
  });
});
