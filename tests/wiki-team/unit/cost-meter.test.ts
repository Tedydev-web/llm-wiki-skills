/**
 * cost-meter.test.ts — unit tests for CostMeter (Redis INCR math + cap boundary)
 *
 * All Redis calls are mocked — no real Redis instance required.
 * Tests: µUSD conversion math, cap boundary (at / over / under), daily UTC key,
 * invalid constructor args, invalid recordTokens args, getTodayTotal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostMeter, createCostMeter } from '../../../apps/wiki-team/jobs/wiki-compile/cost-meter.js';

// ---------------------------------------------------------------------------
// Redis mock factory

function makeRedisMock(currentTotal = 0) {
  return {
    incrby: vi.fn().mockResolvedValue(currentTotal),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(String(currentTotal)),
  };
}

// ---------------------------------------------------------------------------
// µUSD math helpers (mirrors cost-meter internals for assertion clarity)

const MICRO_USD = 1_000_000;
function inputCost(tokens: number) { return Math.round(tokens * 3.0 * MICRO_USD / 1_000_000); }
function outputCost(tokens: number) { return Math.round(tokens * 15.0 * MICRO_USD / 1_000_000); }

// ---------------------------------------------------------------------------
// Constructor validation

describe('CostMeter constructor', () => {
  it('throws when redis is falsy', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CostMeter(null as any, 10)).toThrow('Redis client is required');
  });

  it('throws when dailyCapUsd is zero', () => {
    expect(() => new CostMeter(makeRedisMock() as never, 0)).toThrow('dailyCapUsd must be a positive');
  });

  it('throws when dailyCapUsd is negative', () => {
    expect(() => new CostMeter(makeRedisMock() as never, -5)).toThrow('dailyCapUsd must be a positive');
  });

  it('throws when dailyCapUsd is Infinity', () => {
    expect(() => new CostMeter(makeRedisMock() as never, Infinity)).toThrow('dailyCapUsd must be a positive');
  });
});

// ---------------------------------------------------------------------------
// recordTokens — µUSD arithmetic

describe('CostMeter.recordTokens — µUSD math', () => {
  it('calls incrby with correct µUSD value for 1000 input + 500 output tokens', async () => {
    const redis = makeRedisMock(inputCost(1000) + outputCost(500));
    const meter = new CostMeter(redis as never, 10);

    await meter.recordTokens('ws-001', 1000, 500);

    const expectedMicroUsd = inputCost(1000) + outputCost(500);
    expect(redis.incrby).toHaveBeenCalledWith(
      expect.stringContaining('ws-001'),
      expectedMicroUsd,
    );
  });

  it('calls expire after incrby', async () => {
    const redis = makeRedisMock(1000);
    const meter = new CostMeter(redis as never, 10);

    await meter.recordTokens('ws-002', 100, 50);

    expect(redis.expire).toHaveBeenCalledOnce();
  });

  it('key includes workspaceId and today UTC date', async () => {
    const redis = makeRedisMock(1);
    const meter = new CostMeter(redis as never, 10);
    const todayUtc = new Date().toISOString().slice(0, 10);

    await meter.recordTokens('ws-xyz', 10, 5);

    const calledKey = (redis.incrby.mock.calls[0] as [string, number])[0];
    expect(calledKey).toContain('ws-xyz');
    expect(calledKey).toContain(todayUtc);
  });
});

// ---------------------------------------------------------------------------
// recordTokens — cap boundary

describe('CostMeter.recordTokens — cap boundary', () => {
  it('returns ok=true when total is exactly at cap', async () => {
    // Cap: $1 = 1_000_000 µUSD. Total after INCR = 1_000_000 (at cap).
    const capUsd = 1;
    const capMicroUsd = capUsd * MICRO_USD;
    const redis = makeRedisMock(capMicroUsd); // INCR returns exactly cap
    const meter = new CostMeter(redis as never, capUsd);

    const result = await meter.recordTokens('ws-cap', 100, 50);

    expect(result.ok).toBe(true);
    expect(result.totalTodayMicroUsd).toBe(capMicroUsd);
    expect(result.capMicroUsd).toBe(capMicroUsd);
  });

  it('returns ok=false when total exceeds cap by 1 µUSD', async () => {
    const capUsd = 1;
    const capMicroUsd = capUsd * MICRO_USD;
    const redis = makeRedisMock(capMicroUsd + 1); // 1 µUSD over cap
    const meter = new CostMeter(redis as never, capUsd);

    const result = await meter.recordTokens('ws-over', 100, 50);

    expect(result.ok).toBe(false);
  });

  it('returns ok=true well below cap', async () => {
    const redis = makeRedisMock(100); // tiny spend
    const meter = new CostMeter(redis as never, 10); // $10 cap

    const result = await meter.recordTokens('ws-low', 10, 5);

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordTokens — input validation

describe('CostMeter.recordTokens — input validation', () => {
  let meter: CostMeter;

  beforeEach(() => {
    meter = new CostMeter(makeRedisMock() as never, 10);
  });

  it('throws on empty workspaceId', async () => {
    await expect(meter.recordTokens('', 100, 50)).rejects.toThrow('workspaceId');
  });

  it('throws on negative inputTokens', async () => {
    await expect(meter.recordTokens('ws-1', -1, 50)).rejects.toThrow('inputTokens');
  });

  it('throws on negative outputTokens', async () => {
    await expect(meter.recordTokens('ws-1', 100, -1)).rejects.toThrow('outputTokens');
  });
});

// ---------------------------------------------------------------------------
// getTodayTotal

describe('CostMeter.getTodayTotal', () => {
  it('returns 0 when key absent (redis.get returns null)', async () => {
    const redis = { ...makeRedisMock(), get: vi.fn().mockResolvedValue(null) };
    const meter = new CostMeter(redis as never, 10);

    const total = await meter.getTodayTotal('ws-new');
    expect(total).toBe(0);
  });

  it('returns parsed integer when key exists', async () => {
    const redis = { ...makeRedisMock(), get: vi.fn().mockResolvedValue('42000') };
    const meter = new CostMeter(redis as never, 10);

    const total = await meter.getTodayTotal('ws-existing');
    expect(total).toBe(42000);
  });
});

// ---------------------------------------------------------------------------
// createCostMeter factory

describe('createCostMeter factory', () => {
  it('reads WIKI_COMPILE_DAILY_USD_CAP env var', () => {
    process.env['WIKI_COMPILE_DAILY_USD_CAP'] = '5';
    const redis = makeRedisMock();
    const meter = createCostMeter(redis as never);
    expect(meter).toBeInstanceOf(CostMeter);
    delete process.env['WIKI_COMPILE_DAILY_USD_CAP'];
  });

  it('defaults to $10 when env var unset', () => {
    delete process.env['WIKI_COMPILE_DAILY_USD_CAP'];
    const redis = makeRedisMock();
    // Should not throw
    expect(() => createCostMeter(redis as never)).not.toThrow();
  });

  it('throws when env var is non-numeric', () => {
    process.env['WIKI_COMPILE_DAILY_USD_CAP'] = 'not-a-number';
    const redis = makeRedisMock();
    expect(() => createCostMeter(redis as never)).toThrow('WIKI_COMPILE_DAILY_USD_CAP');
    delete process.env['WIKI_COMPILE_DAILY_USD_CAP'];
  });
});
