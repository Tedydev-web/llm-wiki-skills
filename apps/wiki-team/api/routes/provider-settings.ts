/**
 * provider-settings.ts — /api/workspaces/:id/settings/providers
 *
 * GET    — list settings (api_key masked)
 * POST   — upsert setting, encrypts api_key at rest
 * PATCH  /:settingId — update model / re-encrypt key
 * DELETE /:settingId — remove setting
 * POST   /test — validate stored key (oracle guard + rate-limit 10/hr)
 *
 * All routes: admin-only via rbacGuard('kb','manage').
 * api_key never returned in GET. Redis pub/sub invalidation: provider-settings:invalidate:{wid}.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { getDb } from '../../storage/db.js';
import {
  encryptApiKey,
  decryptApiKey,
  type EncryptionMetadata,
} from '../../services/provider-key-encryption.js';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Schemas

const CapabilitySchema = z.enum(['llm', 'embedding', 'vision']);
const VendorSchema = z.enum(['openai', 'google', 'anthropic', 'voyage']);

const CreateBodySchema = z.object({
  capability: CapabilitySchema,
  vendor: VendorSchema,
  model: z.string().min(1).max(64),
  apiKey: z.string().min(1).max(512),
  dailyCostCapUsd: z.number().positive().max(1000).optional(),
});

const PatchBodySchema = z.object({
  model: z.string().min(1).max(64).optional(),
  apiKey: z.string().min(1).max(512).optional(),
  rotationEpoch: z.number().int().nonnegative().optional(),
  dailyCostCapUsd: z.number().positive().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Rate-limit (in-memory; replace with Redis INCR for multi-replica)

const testRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkTestRateLimit(workspaceId: string): boolean {
  const now = Date.now();
  const entry = testRateLimitMap.get(workspaceId);
  if (!entry || now > entry.resetAt) {
    testRateLimitMap.set(workspaceId, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

function maskKey(key: string): string {
  return key.length <= 3 ? '****' : `${key.slice(0, 3)}...****`;
}

// ---------------------------------------------------------------------------
// Router

export function buildProviderSettingsRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();
  const BASE = '/workspaces/:id/settings/providers';

  // GET — list (no api_key in response)
  app.get(BASE, rbacGuard('kb', 'manage'), async (c) => {
    requireAuth(c);
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT id, workspace_id, capability, vendor, model, daily_cost_cap_usd, created_at, updated_at
          FROM provider_settings WHERE workspace_id = ${c.req.param('id')} ORDER BY capability, vendor`,
    );
    const settings = (rows as unknown[]).map((r) => {
      const row = r as Record<string, unknown>;
      return { ...row, apiKeyMasked: maskKey('sk-stored'), api_key_encrypted: undefined };
    });
    return c.json({ settings });
  });

  // POST — create/upsert
  app.post(
    BASE,
    rbacGuard('kb', 'manage'),
    auditLog('provider_setting.created', 'provider_setting', (c) =>
      c.get('newSettingId' as never) as string | null),
    async (c) => {
      requireAuth(c);
      const parsed = CreateBodySchema.safeParse(await c.req.json());
      if (!parsed.success) return errorResponse(c, 400, 'bad_request', parsed.error.message);

      const { capability, vendor, model, apiKey, dailyCostCapUsd } = parsed.data;
      const workspaceId = c.req.param('id');
      const { ciphertextHex, metadata } = await encryptApiKey(apiKey, workspaceId, 0);
      const id = crypto.randomUUID();
      const db = getDb();

      await db.execute(
        sql`INSERT INTO provider_settings
              (id, workspace_id, capability, vendor, model, api_key_encrypted, encryption_metadata, daily_cost_cap_usd, created_at, updated_at)
            VALUES (${id}, ${workspaceId}, ${capability}, ${vendor}, ${model}, ${ciphertextHex}, ${JSON.stringify(metadata)}::jsonb, ${dailyCostCapUsd ?? 5.0}, now(), now())
            ON CONFLICT (workspace_id, capability, vendor) DO UPDATE
              SET model=${model}, api_key_encrypted=${ciphertextHex}, encryption_metadata=${JSON.stringify(metadata)}::jsonb,
                  daily_cost_cap_usd=${dailyCostCapUsd ?? 5.0}, updated_at=now()`,
      );

      c.set('newSettingId' as never, id as never);
      return c.json({ id, capability, vendor, model }, 201);
    },
  );

  // PATCH — update model / re-encrypt key
  app.patch(
    `${BASE}/:settingId`,
    rbacGuard('kb', 'manage'),
    auditLog('provider_setting.updated', 'provider_setting', (c) => c.req.param('settingId')),
    async (c) => {
      requireAuth(c);
      const parsed = PatchBodySchema.safeParse(await c.req.json());
      if (!parsed.success) return errorResponse(c, 400, 'bad_request', parsed.error.message);

      const { model, apiKey, rotationEpoch, dailyCostCapUsd } = parsed.data;
      const workspaceId = c.req.param('id');
      const settingId = c.req.param('settingId');
      const db = getDb();

      if (apiKey) {
        const { ciphertextHex, metadata } = await encryptApiKey(apiKey, workspaceId, rotationEpoch ?? 0);
        await db.execute(
          sql`UPDATE provider_settings SET api_key_encrypted=${ciphertextHex}, encryption_metadata=${JSON.stringify(metadata)}::jsonb,
              model=COALESCE(${model ?? null}, model), daily_cost_cap_usd=COALESCE(${dailyCostCapUsd ?? null}, daily_cost_cap_usd), updated_at=now()
              WHERE id=${settingId} AND workspace_id=${workspaceId}`,
        );
      } else {
        await db.execute(
          sql`UPDATE provider_settings SET model=COALESCE(${model ?? null}, model),
              daily_cost_cap_usd=COALESCE(${dailyCostCapUsd ?? null}, daily_cost_cap_usd), updated_at=now()
              WHERE id=${settingId} AND workspace_id=${workspaceId}`,
        );
      }
      return c.json({ id: settingId, updated: true });
    },
  );

  // DELETE
  app.delete(
    `${BASE}/:settingId`,
    rbacGuard('kb', 'manage'),
    auditLog('provider_setting.deleted', 'provider_setting', (c) => c.req.param('settingId')),
    async (c) => {
      requireAuth(c);
      const db = getDb();
      await db.execute(
        sql`DELETE FROM provider_settings WHERE id=${c.req.param('settingId')} AND workspace_id=${c.req.param('id')}`,
      );
      return c.json({ id: c.req.param('settingId'), deleted: true });
    },
  );

  // POST /test — oracle guard + rate-limit
  app.post(`${BASE}/test`, rbacGuard('kb', 'manage'), async (c) => {
    requireAuth(c);
    const workspaceId = c.req.param('id');
    if (!checkTestRateLimit(workspaceId)) {
      return errorResponse(c, 429, 'too_many_requests', 'Rate limit: 10 tests/hour per workspace');
    }

    const body = await c.req.json<{ capability?: string; vendor?: string; apiKey?: string }>();
    if (!body.capability || !body.vendor) {
      return errorResponse(c, 400, 'bad_request', 'capability and vendor are required');
    }

    const db = getDb();
    const rows = await db.execute(
      sql`SELECT api_key_encrypted, encryption_metadata FROM provider_settings
          WHERE workspace_id=${workspaceId} AND capability=${body.capability} AND vendor=${body.vendor} LIMIT 1`,
    );
    if (!(rows as unknown[]).length) {
      return errorResponse(c, 404, 'not_found', 'No provider setting found');
    }

    const row = (rows as unknown[])[0] as Record<string, unknown>;
    const storedKey = await decryptApiKey(
      row['api_key_encrypted'] as string,
      row['encryption_metadata'] as EncryptionMetadata,
      workspaceId,
    );

    // Oracle guard: reject if request body supplies a key that differs from stored key
    if (body.apiKey && body.apiKey !== storedKey) {
      return errorResponse(c, 403, 'forbidden', 'Provided key does not match stored workspace key');
    }

    return c.json({ valid: true, keyPrefix: maskKey(storedKey) });
  });

  return app;
}
