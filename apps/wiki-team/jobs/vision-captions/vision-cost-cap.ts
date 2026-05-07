/**
 * vision-cost-cap.ts — Redis cost-cap helpers for the vision-captions queue.
 *
 * Two independent caps (ADR 015):
 *   1. Per-material cap: `vision-material-cost:<materialId>` (no TTL — per compile run)
 *   2. Per-workspace daily cap: `vision-cost:<workspaceId>:<YYYY-MM-DD>` (25h TTL)
 *
 * All arithmetic in micro-USD (integer) to keep Redis INCR exact — no float precision risk.
 */

import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Constants

export const VISION_DAILY_KEY = 'vision-cost';
export const MATERIAL_VISION_KEY = 'vision-material-cost';
export const DAILY_TTL_SECONDS = 25 * 60 * 60; // 25 hours
export const MICRO_USD = 1_000_000;

const DEFAULT_MATERIAL_CAP_USD = 0.50;

// ---------------------------------------------------------------------------
// Key builders

export function buildDailyKey(workspaceId: string): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `${VISION_DAILY_KEY}:${workspaceId}:${day}`;
}

export function buildMaterialKey(materialId: string): string {
  return `${MATERIAL_VISION_KEY}:${materialId}`;
}

// ---------------------------------------------------------------------------
// Config helpers

export function getMaterialCapMicroUsd(): number {
  const raw = process.env['VISION_COST_CAP_USD_PER_MATERIAL'];
  const n = raw ? parseFloat(raw) : DEFAULT_MATERIAL_CAP_USD;
  return Math.round((Number.isFinite(n) && n > 0 ? n : DEFAULT_MATERIAL_CAP_USD) * MICRO_USD);
}

export function getMaxImageBytes(): number {
  const raw = process.env['IMAGE_MAX_SIZE_MB'];
  const n = raw ? parseFloat(raw) : 5;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1024 * 1024) : 5 * 1024 * 1024;
}

// ---------------------------------------------------------------------------
// checkAndIncrCap — atomic peek + increment

/**
 * Check if current total is already at cap before incrementing.
 * Returns allowed=false if cap already met (no increment in that case).
 * Returns allowed=true and increments if under cap (may exceed after increment
 * in a race — post-call check in job-handler handles that).
 */
export async function checkAndIncrCap(
  redis: Redis,
  key: string,
  costMicroUsd: number,
  capMicroUsd: number,
  ttlSeconds?: number,
): Promise<{ allowed: boolean; newTotal: number }> {
  const current = await redis.get(key);
  const currentTotal = current === null ? 0 : parseInt(current, 10);
  if (currentTotal >= capMicroUsd) {
    return { allowed: false, newTotal: currentTotal };
  }
  const newTotal = await redis.incrby(key, costMicroUsd);
  if (ttlSeconds) {
    await redis.expire(key, ttlSeconds).catch(() => {/* non-fatal */});
  }
  return { allowed: newTotal <= capMicroUsd, newTotal };
}
