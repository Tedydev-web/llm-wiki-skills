/**
 * logger.ts — pino-based structured logger for wiki-team server-side code
 *
 * Anti-trace: module name is "logger" (not arkon_logger, structured_logger, etc.)
 *
 * Usage:
 *   import { logger } from './lib/logger.js';
 *   logger.info({ materialId }, '[job] processing');
 *   logger.error({ err }, '[auth] Bearer validation failed');
 *
 * Level: controlled by LOG_LEVEL env (default: 'info').
 * Format: JSON in production; pretty-printed in development (NODE_ENV=development).
 *
 * Redaction: sensitive paths are replaced with '[REDACTED]' before serialization.
 * Redact list covers auth tokens, API keys, passwords, MCP token plaintext.
 */

import pino from 'pino';

// ---------------------------------------------------------------------------
// Redact paths — covers all known secret field shapes in wiki-team payloads

const REDACT_PATHS: string[] = [
  // HTTP auth headers (request objects, forwarded in logs)
  'req.headers.authorization',
  'request.headers.authorization',
  'authorization',

  // Provider API keys (P01 encrypted at rest; still redact plaintext in logs)
  '*.api_key',
  '*.api_key_plaintext',
  '*.encryptedApiKey',

  // Passwords and hashes
  'password',
  'passwordHash',
  'password_hash',
  'DEFAULT_ADMIN_PASSWORD',

  // MCP token fields — plaintext token value must never appear in logs
  'token',
  'plaintext',
  'wkt_*',

  // Generic secret/key/dsn subfield (catch-all for nested objects)
  '*.secret',
  '*.token',
  '*.password',
  '*.dsn',
];

// ---------------------------------------------------------------------------
// Logger singleton

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',

  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },

  // Development: pretty-print with color; Production: JSON lines (stdout)
  transport:
    process.env['NODE_ENV'] === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export type Logger = typeof logger;
