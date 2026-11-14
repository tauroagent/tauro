import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkGate, DEFAULT_MAX_GAP_BPS, gapBps, priceFromSqrtX96, type GateInput } from "../src/index.js";

const NOW = 1_763_300_000;
const feed = { roundId: 7n, answer: 25_000_000_000n, decimals: 8, updatedAt: NOW - 60 }; // $250.00
const base: GateInput = { poolPrice: 250, feed, now: NOW, maxFeedAgeSec: 3_600, maxGapBps: DEFAULT_MAX_GAP_BPS, halted: false };

describe("checkGate", () => {
  it("passes when the pool and the feed agree", () => {
    expect(checkGate({ ...base, poolPrice: 253 })).toEqual({ ok: true, reason: "ok", feedPrice: 250, gapBps: 120, feedAgeSec: 60 });
  });

  it("passes exactly at the limit and blocks one bp past it", () => {
    expect(checkGate({ ...base, poolPrice: 255 }).ok).toBe(true); // 200 bps
    expect(checkGate({ ...base, poolPrice: 255.03 })).toMatchObject({ ok: false, reason: "deviation", gapBps: 202 });
  });

  it.each([
    ["halted", { halted: true }],
    ["no_feed", { feed: null }],
    ["bad_answer", { feed: { ...feed, answer: 0n } }],
    ["stale_feed", { feed: { ...feed, updatedAt: NOW - 3_601 } }],
    ["future_feed", { feed: { ...feed, updatedAt: NOW + 5 } }],
    ["no_pool_price", { poolPrice: null }],
    ["no_pool_price", { poolPrice: 0 }],
    ["no_pool_price", { poolPrice: Number.NaN }],
  ] as const)("blocks with %s", (reason, patch) => {
    expect(checkGate({ ...base, ...patch } as GateInput)).toMatchObject({ ok: false, reason });
  });

  it("checks the halt before anything else", () => {
    expect(checkGate({ ...base, halted: true, feed: null }).reason).toBe("halted");
  });

  it("never passes a gap above the limit", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 10_000, noNaN: true }), fc.integer({ min: 0, max: 1_000 }), (pool, maxGap) => {
        const r = checkGate({ ...base, poolPrice: pool, maxGapBps: maxGap });
        return !r.ok || (r.gapBps !== null && r.gapBps <= maxGap);
      }),
    );
  });
});

describe("helpers", () => {
  it("rounds the gap up", () => {
    expect(gapBps(100.001, 100)).toBe(1);
    expect(gapBps(100, 100)).toBe(0);
  });

  it("reads sqrtPriceX96 with decimals", () => {
    const Q96 = 2n ** 96n;
    expect(priceFromSqrtX96(Q96, 18, 18)).toBe(1);
    expect(priceFromSqrtX96(Q96 * 2n, 18, 18)).toBe(4);
    // token0 with 18 decimals, token1 with 6 decimals (USDG-like): raw 1:1 means 1e12 token1 per token0 unit
    expect(priceFromSqrtX96(Q96, 6, 18)).toBeCloseTo(1e-12, 20);
    expect(() => priceFromSqrtX96(0n, 18, 6)).toThrow();
  });
});
