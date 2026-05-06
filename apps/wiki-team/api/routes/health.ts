/**
 * health.ts — GET /healthz
 *
 * No auth required. Pings DB + Redis and returns structured status.
 * Used by load balancers and Docker health checks.
 */

import { Hono } from 'hono';
import { getDb } from '../../storage/db.js';
import { sql } from 'drizzle-orm';

export function buildHealthRouter(): Hono {
  const app = new Hono();

  app.get('/healthz', async (c) => {
    const checks: Record<string, 'ok' | 'error'> = {};

    // DB ping
    try {
      await getDb().execute(sql`SELECT 1`);
      checks['db'] = 'ok';
    } catch {
      checks['db'] = 'error';
    }

    // Redis ping — read from context (injected by server.ts via app.use)
    const redis = c.get('redis' as never) as { ping?: () => Promise<string> } | undefined;
    if (redis?.ping) {
      try {
        await redis.ping();
        checks['redis'] = 'ok';
      } catch {
        checks['redis'] = 'error';
      }
    } else {
      checks['redis'] = 'ok'; // redis not injected in this context; skip gracefully
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    return c.json(
      { status: allOk ? 'ok' : 'degraded', checks, env: process.env['NODE_ENV'] ?? 'development' },
      allOk ? 200 : 503,
    );
  });

  return app;
}
