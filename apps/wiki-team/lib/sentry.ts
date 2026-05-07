/**
 * sentry.ts — optional Sentry error reporting adapter for wiki-team
 *
 * Opt-in: only initializes when SENTRY_DSN environment variable is set.
 * Silent no-op when SENTRY_DSN is absent — zero runtime cost.
 *
 * Bun compat: @sentry/node is used (Bun has Node.js-compatible module system).
 * @sentry/bun requires bun-specific runtime; @sentry/node works on both.
 *
 * Usage:
 *   import { initSentry, captureException } from './lib/sentry.js';
 *   initSentry(); // call once at server boot, before any request handlers
 *   captureException(err); // call in error handlers
 */

import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Sentry module type — lazy-loaded to avoid import cost when DSN is absent

type SentryModule = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (err: unknown) => string;
};

let _sentry: SentryModule | null = null;
let _initialized = false;

// ---------------------------------------------------------------------------
// initSentry — call once at server boot

export async function initSentry(): Promise<void> {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) {
    // Optional — silent skip when DSN is not configured
    return;
  }

  try {
    // Lazy import: only loads Sentry bundle when DSN is present.
    // @sentry/node works on Bun runtime (Bun's Node.js compat layer handles it).
    // Dynamic string prevents TS from statically resolving the optional package
    // (not installed by default — opt-in via `bun add @sentry/node`).
    const sentryPkg = '@sentry/node'; // intentional: prevents TS static resolution
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* @vite-ignore */ sentryPkg) as unknown as SentryModule;

    mod.init({
      dsn,
      environment: process.env['NODE_ENV'] ?? 'production',
      // Default 10% trace sampling — override via SENTRY_TRACES_SAMPLE_RATE env
      tracesSampleRate: parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
      beforeSend: (event: Record<string, unknown>) => {
        // Redact sensitive headers before sending to Sentry
        const req = event['request'] as Record<string, unknown> | undefined;
        if (req?.['headers'] && typeof req['headers'] === 'object') {
          const headers = req['headers'] as Record<string, unknown>;
          delete headers['authorization'];
          delete headers['cookie'];
          delete headers['x-api-key'];
        }
        return event;
      },
    });

    _sentry = mod;
    _initialized = true;
    logger.info('[sentry] initialized (DSN configured)');
  } catch (err) {
    // Sentry init failure must never crash the server — log and continue
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[sentry] failed to initialize — running without Sentry',
    );
  }
}

// ---------------------------------------------------------------------------
// captureException — safe wrapper; no-op when Sentry not initialized

export function captureException(err: unknown): void {
  if (!_initialized || !_sentry) return;
  try {
    _sentry.captureException(err);
  } catch {
    // Never let Sentry errors propagate into application code
  }
}

// ---------------------------------------------------------------------------
// isSentryEnabled — for health checks / debug logging

export function isSentryEnabled(): boolean {
  return _initialized;
}
