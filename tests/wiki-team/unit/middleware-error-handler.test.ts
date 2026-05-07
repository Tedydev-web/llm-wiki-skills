/**
 * middleware-error-handler.test.ts — unit tests for globalErrorHandler + errorResponse
 *
 * Verifies: 5xx logged via pino error, 4xx at debug, uniform response shape,
 *   stack-trace redaction in production, statusToCode mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger before importing error-handler

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from '../../../apps/wiki-team/lib/logger.js';
import { globalErrorHandler, errorResponse } from '../../../apps/wiki-team/api/middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Helpers

function makeCtx(overrides: Record<string, unknown> = {}) {
  const responses: Array<{ body: unknown; status: number }> = [];
  return {
    json: vi.fn((body: unknown, status: number) => {
      const r = { body, status };
      responses.push(r);
      return r;
    }),
    responses,
    ...overrides,
  };
}

function makeError(message: string, status?: number): Error & { status?: number } {
  const err = new Error(message) as Error & { status?: number };
  if (status !== undefined) err.status = status;
  return err;
}

// ---------------------------------------------------------------------------
// Tests

describe('globalErrorHandler', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NODE_ENV'] = 'development'; // default — stack traces allowed
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('logs 5xx errors at error level via pino', () => {
    const ctx = makeCtx();
    const err = makeError('db exploded', 500);

    globalErrorHandler(err, ctx as never);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      expect.stringContaining('[error-handler] unhandled server error'),
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs 4xx errors at debug level only', () => {
    const ctx = makeCtx();
    const err = makeError('not found', 404);

    globalErrorHandler(err, ctx as never);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404 }),
      expect.stringContaining('[error-handler] client error'),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns uniform JSON shape: { error, message }', () => {
    const ctx = makeCtx();
    const err = makeError('something bad', 400);

    const result = globalErrorHandler(err, ctx as never) as { body: Record<string, unknown>; status: number };

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: 'bad_request',
      message: expect.any(String),
    });
  });

  it('redacts message in production for 5xx errors', () => {
    process.env['NODE_ENV'] = 'production';
    const ctx = makeCtx();
    const err = makeError('SECRET_DB_CREDS in error message', 500);

    const result = globalErrorHandler(err, ctx as never) as { body: Record<string, unknown>; status: number };

    expect(result.body['message']).toBe('internal_server_error');
    expect(result.body['message']).not.toContain('SECRET_DB_CREDS');
  });

  it('does NOT redact 4xx messages in production', () => {
    process.env['NODE_ENV'] = 'production';
    const ctx = makeCtx();
    const err = makeError('resource not found', 404);

    const result = globalErrorHandler(err, ctx as never) as { body: Record<string, unknown>; status: number };

    expect(result.body['message']).toBe('resource not found');
  });

  it('defaults to status 500 when err.status is absent', () => {
    const ctx = makeCtx();
    const err = new Error('uncaught');

    const result = globalErrorHandler(err, ctx as never) as { body: Record<string, unknown>; status: number };

    expect(result.status).toBe(500);
    expect(result.body['error']).toBe('internal_server_error');
  });

  it('maps status codes to canonical error codes', () => {
    const cases: Array<[number, string]> = [
      [400, 'bad_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [428, 'precondition_required'],
      [429, 'too_many_requests'],
      [503, 'service_unavailable'],
      [502, 'internal_server_error'], // unknown → fallback
    ];

    for (const [status, expectedCode] of cases) {
      const ctx = makeCtx();
      const err = makeError('test', status);
      const result = globalErrorHandler(err, ctx as never) as { body: Record<string, unknown>; status: number };
      expect(result.body['error']).toBe(expectedCode);
    }
  });
});

// ---------------------------------------------------------------------------
// errorResponse helper

describe('errorResponse', () => {
  it('returns JSON with correct status and body shape', () => {
    const ctx = makeCtx();
    const result = errorResponse(ctx as never, 422, 'validation_error', 'bad field', { field: 'email' }) as {
      body: Record<string, unknown>;
      status: number;
    };

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: 'validation_error',
      message: 'bad field',
      details: { field: 'email' },
    });
  });

  it('omits details key when details is undefined', () => {
    const ctx = makeCtx();
    const result = errorResponse(ctx as never, 404, 'not_found', 'not found') as {
      body: Record<string, unknown>;
      status: number;
    };

    expect('details' in (result.body as object)).toBe(false);
  });
});
