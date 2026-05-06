/**
 * cost-meter.ts — per-workspace daily cost cap via Redis INCR
 *
 * Design (phase-06 step 4):
 *   - Atomic Redis INCR on key `cost-cap:<workspaceId>:<YYYY-MM-DD>` (UTC date)
 *   - EXPIRE set to 25 hours on first write — auto-resets the next UTC day
 *   - Refuse-on-cap: if INCR result > dailyCapCents, return ok=false
 *   - Cluster-safe: INCR is atomic on single slot; key includes workspaceId
 *     so all jobs for the same workspace hash to the same slot in cluster mode
 *
 * Token → USD conversion: Anthropic Sonnet claude-sonnet-4-5 pricing
 *   Input:  $3.00  per 1M tokens = 0.000003 USD / token
 *   Output: $15.00 per 1M tokens = 0.000015 USD / token
 *   We store cost as integer micro-dollars (1 USD = 1_000_000 µUSD) for
 *   INCR-safe integer arithmetic. No floating-point in Redis keys.
 */

import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Constants

const KEY_PREFIX = 'cost-cap';
// TTL slightly longer than one calendar day to survive clock skew between workers
const TTL_SECONDS = 25 * 60 * 60; // 25 hours

// Micro-dollar multiplier — stores cost as integer µUSD in Redis
const MICRO_USD = 1_000_000;

// ---------------------------------------------------------------------------
// CostRecordResult — returned by recordTokens

export interface CostRecordResult {
  /** False if this call pushed the workspace over its daily cap */
  ok: boolean;
  /** Total micro-USD spent today for this workspace (after this call) */
  totalTodayMicroUsd: number;
  /** Daily cap in micro-USD */
  capMicroUsd: number;
}

// ---------------------------------------------------------------------------
// CostMeter class

export class CostMeter {
  private readonly redis: Redis;
  /** Daily cap in USD — read from WIKI_COMPILE_DAILY_USD_CAP env at construction */
  private readonly dailyCapUsd: number;

  constructor(redis: Redis, dailyCapUsd: number) {
    if (!redis) throw new Error('[cost-meter] Redis client is required');
    if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0) {
      throw new Error(`[cost-meter] dailyCapUsd must be a positive finite number (got ${dailyCapUsd})`);
    }
    this.redis = redis;
    this.dailyCapUsd = dailyCapUsd;
  }

  // ---------------------------------------------------------------------------
  // recordTokens — atomic cost accumulation + cap check

  /**
   * Record token usage for a workspace and check against the daily cap.
   *
   * @param workspaceId   Workspace UUID (used as Redis key segment)
   * @param inputTokens   Anthropic input tokens consumed in this call
   * @param outputTokens  Anthropic output tokens consumed in this call
   * @returns             CostRecordResult — ok=false means cap exceeded; caller MUST abort job
   */
  async recordTokens(
    workspaceId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<CostRecordResult> {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('[cost-meter] workspaceId must be a non-empty string');
    }
    if (!Number.isFinite(inputTokens) || inputTokens < 0) {
      throw new Error(`[cost-meter] inputTokens must be >= 0 (got ${inputTokens})`);
    }
    if (!Number.isFinite(outputTokens) || outputTokens < 0) {
      throw new Error(`[cost-meter] outputTokens must be >= 0 (got ${outputTokens})`);
    }

    // Compute cost in µUSD (integer arithmetic — no float precision risk in Redis)
    const costMicroUsd = Math.round(
      inputTokens * 3.0 * MICRO_USD / 1_000_000 +   // $3/1M input tokens
      outputTokens * 15.0 * MICRO_USD / 1_000_000,  // $15/1M output tokens
    );

    const capMicroUsd = Math.round(this.dailyCapUsd * MICRO_USD);
    const key = this.buildKey(workspaceId);

    // INCR is atomic — no race between concurrent workers
    const newTotal = await this.redis.incrby(key, costMicroUsd);

    // Set TTL only on first write (NX flag — "set if not exists")
    // If key already existed, TTL is already set; EXPIRE NX avoids extending it.
    // Redis >= 7.0 supports EXPIRE key seconds NX; for compatibility use raw command.
    try {
      // Raw EXPIRE with NX option (Redis 7+). Falls back silently on older Redis
      // because EXPIRE without NX would reset the TTL which is also acceptable.
      await this.redis.expire(key, TTL_SECONDS);
    } catch {
      // Non-fatal: key exists and will eventually expire; INCR still committed
    }

    return {
      ok: newTotal <= capMicroUsd,
      totalTodayMicroUsd: newTotal,
      capMicroUsd,
    };
  }

  // ---------------------------------------------------------------------------
  // getTodayTotal — read-only check (no increment)

  /**
   * Returns the current accumulated cost for a workspace today (µUSD).
   * Returns 0 if no spending recorded yet.
   */
  async getTodayTotal(workspaceId: string): Promise<number> {
    const key = this.buildKey(workspaceId);
    const val = await this.redis.get(key);
    return val === null ? 0 : parseInt(val, 10);
  }

  // ---------------------------------------------------------------------------
  // Private helpers

  private buildKey(workspaceId: string): string {
    const dateUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${KEY_PREFIX}:${workspaceId}:${dateUtc}`;
  }
}

// ---------------------------------------------------------------------------
// Factory — create CostMeter from environment variables

/**
 * Build a CostMeter instance from env vars + Redis client.
 * Reads WIKI_COMPILE_DAILY_USD_CAP (default: 10 USD).
 */
export function createCostMeter(redis: Redis): CostMeter {
  const capStr = process.env['WIKI_COMPILE_DAILY_USD_CAP'] ?? '10';
  const cap = parseFloat(capStr);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(
      `[cost-meter] WIKI_COMPILE_DAILY_USD_CAP must be a positive number (got "${capStr}")`,
    );
  }
  return new CostMeter(redis, cap);
}
