/**
 * error-handler.ts — uniform error response shape + Hono error handler
 *
 * All API errors use: { error: string, message: string, details?: unknown }
 * HTTP status codes follow RFC 7231.
 */

import type { Context, ErrorHandler } from 'hono';

// ---------------------------------------------------------------------------
// Canonical error response shape

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Build a typed JSON error response.
 * Use in route handlers for inline error returns.
 */
export function errorResponse(
  c: Context,
  status: number,
  error: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = { error, message };
  if (details !== undefined) body.details = details;
  return c.json(body, status as Parameters<Context['json']>[1]);
}

// ---------------------------------------------------------------------------
// Global Hono error handler — catches unhandled throws

export const globalErrorHandler: ErrorHandler = (err, c) => {
  // Structured errors thrown by service layer (e.g. { status, message })
  // Cast through unknown to avoid TS overlap check between Error and HTTPResponseError
  const errAsStatus = err as unknown as { status?: number };
  const status: number =
    typeof errAsStatus.status === 'number' ? errAsStatus.status : 500;

  const message = err instanceof Error ? err.message : String(err);

  // Avoid leaking stack traces in production
  const isProduction = process.env['NODE_ENV'] === 'production';

  return c.json(
    {
      error: statusToCode(status),
      message: isProduction && status >= 500 ? 'internal_server_error' : message,
    } satisfies ApiError,
    status as Parameters<Context['json']>[1],
  );
};

// ---------------------------------------------------------------------------
// Internal helpers

function statusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    428: 'precondition_required',
    429: 'too_many_requests',
    503: 'service_unavailable',
  };
  return map[status] ?? 'internal_server_error';
}
