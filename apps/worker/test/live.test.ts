import { describe, expect, it } from "vitest";
import { haltReason, LIVE, liveAccount, minOut, planOrder, type Decision } from "../src/live.js";

const d = (action: Decision["action"], sizeUsd = 100): Decision => ({ hour: 1_795_125_600, action, sizeUsd, leaf: "0x01" });

describe("live wallet", () => {
  it("publishes the caps chosen on 20 November 2026", () => {
    expect(LIVE.agent).toBe("house-mean-reversion-nvda");
    expect(LIVE.caps).toMatchObject({ startUsdg: 200, scale: 0.2, maxOrderUsd: 40, maxDayUsd: 200, slippageBps: 50, maxGapBps: 200, drawdownStop: 0.2, gateFailStop: 6 });
  });

  it("buys the paper order scaled down, within the per-order and daily caps", () => {
    expect(planOrder(d("buy"), { cash: 200, qty: 0 }, 0, null)).toEqual({ do: "buy", usd: 20 });
    expect(planOrder(d("buy", 1000), { cash: 200, qty: 0 }, 0, null)).toEqual({ do: "buy", usd: 40 });
    expect(planOrder(d("buy"), { cash: 200, qty: 0 }, 190, null)).toEqual({ do: "buy", usd: 10 });
    expect(planOrder(d("buy"), { cash: 200, qty: 0 }, 200, null)).toEqual({ do: "skip", reason: "daily cap reached" });
    expect(planOrder(d("buy"), { cash: 7.5, qty: 0 }, 0, null)).toEqual({ do: "buy", usd: 7.5 });
    expect(planOrder(d("buy"), { cash: 0.4, qty: 0 }, 0, null)).toEqual({ do: "skip", reason: "no cash" });
  });

  it("does not stack buys, sells the whole position, ignores holds", () => {
    expect(planOrder(d("buy"), { cash: 180, qty: 0.14 }, 0, null)).toEqual({ do: "skip", reason: "already holding" });
    expect(planOrder(d("sell"), { cash: 180, qty: 0.14 }, 0, null)).toEqual({ do: "sell", qty: 0.14 });
    expect(planOrder(d("sell"), { cash: 200, qty: 0 }, 0, null)).toEqual({ do: "skip", reason: "nothing to sell" });
    expect(planOrder(d("hold"), { cash: 200, qty: 0 }, 0, null).do).toBe("skip");
  });

  it("treats rounding dust as no position", () => {
    expect(planOrder(d("buy"), { cash: 199.9, qty: 0.0000004 }, 0, null)).toEqual({ do: "buy", usd: 20 });
    expect(planOrder(d("sell"), { cash: 199.9, qty: 0.0000004 }, 0, null)).toEqual({ do: "skip", reason: "nothing to sell" });
  });

  it("does nothing once halted", () => {
    expect(planOrder(d("sell"), { cash: 0, qty: 1 }, 0, "drawdown")).toEqual({ do: "skip", reason: "halted: drawdown" });
  });

  it("halts at a 20% drawdown or 6 gate blocks in a row", () => {
    expect(haltReason(161, 0)).toBeNull();
    expect(haltReason(159.99, 0)).toMatch(/drawdown/);
    expect(haltReason(200, 5)).toBeNull();
    expect(haltReason(200, 6)).toMatch(/price gate/);
  });

  it("sets the minimum output 0.5% under the quote", () => {
    expect(minOut(1_000_000n)).toBe(995_000n);
    expect(minOut(139_808_000_000_000_000n)).toBe(139_108_960_000_000_000n);
  });

  it("reads the key with or without 0x and rejects anything else", () => {
    const k = "11".repeat(32);
    expect(liveAccount(k)?.address).toBe(liveAccount(`0x${k}`)?.address);
    expect(liveAccount(` 0x${k}\n`)?.address).toBe(liveAccount(k)?.address);
    expect(liveAccount("not a key")).toBeNull();
    expect(liveAccount(undefined)).toBeNull();
  });
});
