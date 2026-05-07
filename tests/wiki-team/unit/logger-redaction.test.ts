/**
 * logger-redaction.test.ts — golden tests for pino logger redaction
 *
 * Verifies that sensitive fields are replaced with '[REDACTED]' before
 * any log output — passwords, API keys, MCP token plaintext, auth headers.
 *
 * Strategy: create a pino logger with destination → in-memory string stream,
 * log a sensitive object, parse the JSON output, assert '[REDACTED]' present
 * and raw secret absent.
 */

import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// Helper: build a test logger that writes JSON to a string buffer

function makeTestLogger(redactPaths: string[]) {
  let captured = '';
  const dest = new Writable({
    write(chunk, _encoding, cb) {
      captured += chunk.toString();
      cb();
    },
  });

  const log = pino(
    {
      level: 'trace',
      redact: { paths: redactPaths, censor: '[REDACTED]' },
    },
    dest,
  );

  return {
    log,
    getOutput: () => {
      try {
        // pino writes newline-delimited JSON; parse last complete line
        const lines = captured.trim().split('\n').filter(Boolean);
        return lines.length ? JSON.parse(lines[lines.length - 1]!) : {};
      } catch {
        return { raw: captured };
      }
    },
    reset: () => { captured = ''; },
  };
}

// Redact paths matching those in apps/wiki-team/lib/logger.ts
const REDACT_PATHS = [
  'req.headers.authorization',
  'request.headers.authorization',
  'authorization',
  '*.api_key',
  '*.api_key_plaintext',
  '*.encryptedApiKey',
  'password',
  'passwordHash',
  'password_hash',
  'DEFAULT_ADMIN_PASSWORD',
  'token',
  'plaintext',
  '*.secret',
  '*.token',
  '*.password',
  '*.dsn',
];

// ---------------------------------------------------------------------------
// Tests

describe('logger redaction — golden tests', () => {
  it('redacts top-level password field', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ password: 'super-secret-123' }, 'test');
    const out = getOutput();
    expect(out.password).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('super-secret-123');
  });

  it('redacts *.api_key on nested provider object', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ provider: { api_key: 'sk-ant-abc123' } }, 'test');
    const out = getOutput();
    expect(out.provider.api_key).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('sk-ant-abc123');
  });

  it('redacts *.api_key_plaintext on nested provider object', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ provider: { api_key_plaintext: 'voyage-xyz-secret' } }, 'test');
    const out = getOutput();
    expect(out.provider.api_key_plaintext).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('voyage-xyz-secret');
  });

  it('redacts top-level token field (MCP token plaintext)', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ token: 'wkt_abc123xyz456def789ghi012jkl345' }, 'test');
    const out = getOutput();
    expect(out.token).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('wkt_abc123xyz456def789ghi012jkl345');
  });

  it('redacts top-level plaintext field', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ plaintext: 'wkt_plaintext_value_here' }, 'test');
    const out = getOutput();
    expect(out.plaintext).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('wkt_plaintext_value_here');
  });

  it('redacts req.headers.authorization', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ req: { headers: { authorization: 'Bearer wkt_secret' } } }, 'test');
    const out = getOutput();
    expect(out.req.headers.authorization).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('wkt_secret');
  });

  it('redacts top-level authorization field', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ authorization: 'Bearer some-token' }, 'test');
    const out = getOutput();
    expect(out.authorization).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('some-token');
  });

  it('does NOT redact non-sensitive fields', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ materialId: 'mat-123', workspaceId: 'ws-456', status: 'completed' }, 'test');
    const out = getOutput();
    expect(out.materialId).toBe('mat-123');
    expect(out.workspaceId).toBe('ws-456');
    expect(out.status).toBe('completed');
  });

  it('golden: all three provider key shapes redacted simultaneously', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info(
      {
        password: 'secret-password',
        provider: {
          api_key: 'sk-ant-api03-real-key',
          api_key_plaintext: 'voyage-plaintext-key',
        },
      },
      'multi-field test',
    );
    const out = getOutput();
    const json = JSON.stringify(out);
    // All three must be redacted
    expect(out.password).toBe('[REDACTED]');
    expect(out.provider.api_key).toBe('[REDACTED]');
    expect(out.provider.api_key_plaintext).toBe('[REDACTED]');
    // Raw secrets must not appear anywhere
    expect(json).not.toContain('secret-password');
    expect(json).not.toContain('sk-ant-api03-real-key');
    expect(json).not.toContain('voyage-plaintext-key');
  });

  it('preserves log level, message, and timestamp in output', () => {
    const { log, getOutput } = makeTestLogger(REDACT_PATHS);
    log.info({ jobId: 'job-1' }, 'job completed');
    const out = getOutput();
    expect(out.msg).toBe('job completed');
    expect(out.level).toBeDefined();
    expect(out.time).toBeDefined();
    expect(out.jobId).toBe('job-1');
  });
});
