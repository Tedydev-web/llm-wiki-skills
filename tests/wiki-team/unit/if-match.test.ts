/**
 * if-match.test.ts — unit tests for parseIfMatch, versionMismatchResponse, buildETag
 *
 * Tests: missing header → 428, malformed → 428, valid → number,
 *   mismatch response → 409 shape, ETag format.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock error-handler (errorResponse must return a catchable Response-like value)

vi.mock('../../../apps/wiki-team/api/middleware/error-handler.js', () => ({
  errorResponse: vi.fn((c: unknown, status: number, error: string, message: string, details?: unknown) => {
    // Return a plain object that tests can inspect
    return { _mock: true, status, error, message, details };
  }),
}));

import { errorResponse } from '../../../apps/wiki-team/api/middleware/error-handler.js';
import {
  parseIfMatch,
  versionMismatchResponse,
  buildETag,
} from '../../../apps/wiki-team/api/concurrency/if-match.js';

// ---------------------------------------------------------------------------
// Helpers

function makeCtx(ifMatchHeader?: string) {
  return {
    req: {
      header: (name: string) =>
        name === 'if-match' ? (ifMatchHeader ?? null) : null,
    },
    json: vi.fn((body: unknown, status: number) => ({ body, status })),
  };
}

// ---------------------------------------------------------------------------
// parseIfMatch

describe('parseIfMatch', () => {
  it('throws 428 when If-Match header is absent', () => {
    const ctx = makeCtx(undefined); // no header
    expect(() => parseIfMatch(ctx as never)).toThrow();
    expect(errorResponse).toHaveBeenCalledWith(
      expect.anything(),
      428,
      'precondition_required',
      expect.any(String),
    );
  });

  it('throws 428 when If-Match header is malformed (not a number)', () => {
    const ctx = makeCtx('"not-a-number"');
    expect(() => parseIfMatch(ctx as never)).toThrow();
    expect(errorResponse).toHaveBeenCalledWith(
      expect.anything(),
      428,
      'precondition_required',
      expect.any(String),
    );
  });

  it('throws 428 when If-Match is zero', () => {
    const ctx = makeCtx('"0"');
    expect(() => parseIfMatch(ctx as never)).toThrow();
  });

  it('throws 428 when If-Match is negative', () => {
    const ctx = makeCtx('"-1"');
    expect(() => parseIfMatch(ctx as never)).toThrow();
  });

  it('returns parsed integer for quoted valid version: "3" → 3', () => {
    const ctx = makeCtx('"3"');
    const version = parseIfMatch(ctx as never);
    expect(version).toBe(3);
  });

  it('returns parsed integer for bare (unquoted) valid version: 5 → 5', () => {
    const ctx = makeCtx('5');
    const version = parseIfMatch(ctx as never);
    expect(version).toBe(5);
  });

  it('handles large version numbers', () => {
    const ctx = makeCtx('"99999"');
    expect(parseIfMatch(ctx as never)).toBe(99999);
  });
});

// ---------------------------------------------------------------------------
// versionMismatchResponse

describe('versionMismatchResponse', () => {
  it('calls errorResponse with 409 conflict', () => {
    const ctx = makeCtx();
    versionMismatchResponse(ctx as never, 7);

    expect(errorResponse).toHaveBeenCalledWith(
      expect.anything(),
      409,
      'version_mismatch',
      expect.any(String),
      expect.objectContaining({ currentVersion: 7 }),
    );
  });

  it('includes etag in details', () => {
    vi.clearAllMocks(); // isolate from previous test's mock calls
    const ctx = makeCtx();
    versionMismatchResponse(ctx as never, 12);

    const call = vi.mocked(errorResponse).mock.calls[0];
    const details = call?.[4] as Record<string, unknown> | undefined;
    expect(details?.['etag']).toBe('"12"');
    expect(details?.['currentVersion']).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// buildETag

describe('buildETag', () => {
  it('wraps version in double quotes per RFC 7232', () => {
    expect(buildETag(1)).toBe('"1"');
    expect(buildETag(42)).toBe('"42"');
    expect(buildETag(0)).toBe('"0"');
  });
});
