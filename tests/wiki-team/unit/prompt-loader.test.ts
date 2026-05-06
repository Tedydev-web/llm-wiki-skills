/**
 * prompt-loader.test.ts — unit tests for loadSystemPrompt() + cache behaviour
 *
 * Uses vi.mock to intercept node:fs readFileSync so no real disk I/O occurs.
 * Tests: happy path, cache hit (single read), STUB detection, empty file, missing file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs — must be hoisted before importing the module under test

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

// Also mock import.meta.url resolution used inside prompt-loader
vi.mock('node:url', () => ({
  fileURLToPath: vi.fn().mockReturnValue('/fake/prompts/prompt-loader.ts'),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
    dirname: vi.fn(() => '/fake/prompts'),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks are established

import { readFileSync } from 'node:fs';
import { loadSystemPrompt, resetPromptCache } from '../../../apps/wiki-team/jobs/wiki-compile/prompts/prompt-loader.js';

const mockReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// Helpers

const VALID_PROMPT = '# System Prompt\n\nYou are a wiki compilation agent.\n\nDo your job.';

// ---------------------------------------------------------------------------
// Tests

describe('loadSystemPrompt', () => {
  beforeEach(() => {
    // Reset module-level cache between each test
    resetPromptCache();
    vi.clearAllMocks();
  });

  // ---- Happy path ----

  it('returns prompt string from file on first call', () => {
    mockReadFileSync.mockReturnValue(VALID_PROMPT);

    const result = loadSystemPrompt();

    expect(result).toBe(VALID_PROMPT);
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });

  it('returns cached prompt on second call without re-reading file', () => {
    mockReadFileSync.mockReturnValue(VALID_PROMPT);

    const first = loadSystemPrompt();
    const second = loadSystemPrompt();

    expect(first).toBe(second);
    // readFileSync called only once — second call uses cache
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });

  it('reads file again after resetPromptCache()', () => {
    mockReadFileSync.mockReturnValue(VALID_PROMPT);

    loadSystemPrompt();      // first call — reads file
    resetPromptCache();
    loadSystemPrompt();      // second call — should re-read

    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  // ---- STUB guard ----

  it('throws when prompt file still contains STUB header', () => {
    const stubContent = '# STUB — fresh subagent will author full prompt\n\nplaceholder';
    mockReadFileSync.mockReturnValue(stubContent);

    expect(() => loadSystemPrompt()).toThrow('STUB');
  });

  // ---- Empty file ----

  it('throws when prompt file is empty', () => {
    mockReadFileSync.mockReturnValue('   \n  ');

    expect(() => loadSystemPrompt()).toThrow('empty');
  });

  // ---- Missing file ----

  it('throws with descriptive message when file is unreadable', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });

    expect(() => loadSystemPrompt()).toThrow('Cannot read system prompt');
  });

  it('error message includes the file path', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    let thrown: Error | undefined;
    try {
      loadSystemPrompt();
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    // Message should reference the path attempted
    expect(thrown!.message).toMatch(/prompt-loader|v1\.md|Cannot read/);
  });

  // ---- Cache isolation ----

  it('resetPromptCache allows loading different content in next call', () => {
    mockReadFileSync.mockReturnValueOnce(VALID_PROMPT);
    const first = loadSystemPrompt();

    resetPromptCache();

    const updatedPrompt = '# Updated System Prompt v2\n\nNew instructions here.';
    mockReadFileSync.mockReturnValueOnce(updatedPrompt);
    const second = loadSystemPrompt();

    expect(first).not.toBe(second);
    expect(second).toBe(updatedPrompt);
  });
});
