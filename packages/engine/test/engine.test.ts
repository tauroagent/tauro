import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { backtest, pctChange, rsi, sma, tick, TEMPLATES, validateRules, type Candle, type Rules } from "../src/index.js";

const H = 3600;
const series = (closes: number[], t0 = 1_763_200_800): Candle[] => closes.map((close, i) => ({ t: t0 + i * H, close }));
const rules = (name: keyof typeof TEMPLATES, market = "TSLA"): Rules => ({ ...structuredClone(TEMPLATES[name]!), market });

describe("indicators", () => {
  it("sma averages the last n closes", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([1, 2], 0)).toBeNull();
  });

  it("pctChange measures the move over n hours", () => {
    expect(pctChange([100, 110, 99], 2)).toBeCloseTo(-1, 10);
    expect(pctChange([100], 1)).toBeNull();
    expect(pctChange([0, 5], 1)).toBeNull();
    expect(pctChange([1, 2], 0)).toBeNull();
  });

  it("rsi matches the textbook cases", () => {
    expect(rsi([1, 2, 3, 4, 5], 4)).toBe(100);
    expect(rsi([5, 4, 3, 2, 1], 4)).toBe(0);
    expect(rsi([3, 3, 3, 3, 3], 4)).toBe(50);
    expect(rsi([1, 2], 4)).toBeNull();
    expect(rsi([1, 2], 0)).toBeNull();
  });

  it("rsi applies Wilder smoothing after the seed window", () => {
    // seed over 2 changes: +1, -1 -> avg gain 0.5, avg loss 0.5; then +2 -> gain 1.25, loss 0.25
    expect(rsi([10, 11, 10, 12], 2)).toBeCloseTo(100 - 100 / (1 + 1.25 / 0.25), 10);
  });

  it("rsi always stays within 0..100", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1, max: 1000, noNaN: true }), { minLength: 16, maxLength: 80 }), (xs) => {
        const v = rsi(xs, 14)!;
        return v >= 0 && v <= 100;
      }),
    );
  });
});

describe("validateRules", () => {
  it("accepts every template", () => {
    for (const name of Object.keys(TEMPLATES)) expect(validateRules(rules(name as keyof typeof TEMPLATES))).toEqual([]);
  });

  it("reports each bad field with its path", () => {
    const bad = {
      version: 1,
      market: "",
      entry: [
        { kind: "change", hours: 0, op: "lt", pct: Number.NaN },
        { kind: "rsi", period: 1, op: "lt", value: 120 },
        { kind: "sma_cross", fast: 24, slow: 6, dir: "above" },
        { kind: "price_vs_sma", period: 0, op: "gt", pct: Number.POSITIVE_INFINITY },
        { kind: "nope" },
      ],
      exit: "x",
      stopLossPct: 0,
      takeProfitPct: -1,
      maxHoldHours: 1.5,
      sizeUsd: 0,
    } as unknown as Rules;
    const paths = validateRules(bad).map((e) => e.path);
    expect(paths).toEqual([
      "version",
      "market",
      "entry[0].hours",
      "entry[0].pct",
      "entry[1].period",
      "entry[1].value",
      "entry[2]",
      "entry[3].period",
      "entry[3].pct",
      "entry[4]",
      "exit",
      "stopLossPct",
      "takeProfitPct",
      "maxHoldHours",
      "sizeUsd",
    ]);
  });

  it("needs at least one entry condition", () => {
    expect(validateRules({ ...rules("momentum"), entry: [] }).map((e) => e.path)).toEqual(["entry"]);
  });
});

describe("tick", () => {
  it("rejects empty and unsorted input", () => {
    expect(() => tick(rules("momentum"), [], null)).toThrow();
    expect(() => tick(rules("momentum"), [{ t: 2, close: 1 }, { t: 1, close: 1 }], null)).toThrow();
  });

  it("holds while history is too short for the indicators", () => {
    const d = tick(rules("momentum"), series([100, 101, 102]), null);
    expect(d.action).toBe("hold");
    expect(d.values["sma(24)"]).toBeNull();
  });

  it("buys when every entry condition holds and reports the numbers", () => {
    const up = series(Array.from({ length: 30 }, (_, i) => 100 + i));
    const d = tick(rules("momentum"), up, null);
    expect(d.action).toBe("buy");
    expect(d.sizeUsd).toBe(100);
    expect(d.fired).toEqual(["entry:sma(6)>sma(24)", "entry:change(6h)>0.5%"]);
    expect(d.values["sma(6)"]).toBe(126.5);
    expect(d.hour).toBe(up[29]!.t);
  });

  it("does not buy when only some entry conditions hold", () => {
    const xs = Array.from({ length: 30 }, (_, i) => 100 + i);
    xs[29] = xs[23]!; // 6h change is 0, so change(6h)>0.5% fails
    expect(tick(rules("momentum"), series(xs), null).action).toBe("hold");
  });

  it("stop loss wins over every other exit", () => {
    const r = { ...rules("dip_hunter"), takeProfitPct: 1 };
    const pos = { entryPrice: 100, sizeUsd: 100, openedAt: 0 };
    const d = tick(r, series([100, 94]), pos);
    expect(d).toMatchObject({ action: "sell", fired: ["stop_loss"], sizeUsd: 100 });
    expect(d.values["pnl_pct"]).toBe(-6);
  });

  it("takes profit, then max hold, then rule exits", () => {
    const pos = { entryPrice: 100, sizeUsd: 50, openedAt: 1_763_200_800 };
    expect(tick(rules("dip_hunter"), series([100, 105]), pos).fired).toEqual(["take_profit"]);
    const mr = rules("mean_reversion");
    const long = series(Array.from({ length: 49 }, () => 100));
    expect(tick(mr, long, pos).fired).toEqual(["max_hold"]);
    const exitNow = series([...Array.from({ length: 24 }, () => 100), 101]);
    expect(tick(mr, exitNow, pos).fired).toEqual(["exit:dist_sma(24)>0%"]);
  });

  it("holds an open position when nothing fires", () => {
    const pos = { entryPrice: 100, sizeUsd: 50, openedAt: 1_763_200_800 };
    const flat = series(Array.from({ length: 25 }, () => 100));
    expect(tick(rules("momentum"), flat, pos)).toMatchObject({ action: "hold", sizeUsd: 0, fired: [] });
  });

  it("covers rsi and price_vs_sma entries", () => {
    const falling = series(Array.from({ length: 30 }, (_, i) => 130 - i));
    expect(tick(rules("dip_hunter"), falling, null).fired).toEqual(["entry:rsi(14)<30", "entry:change(24h)<-3%"]);
    const breakout = series([...Array.from({ length: 47 }, () => 100), 101, 102, 104]);
    expect(tick(rules("breakout"), breakout, null).action).toBe("buy");
  });

  it("is deterministic: same input, same output", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1, max: 500, noNaN: true }), { minLength: 1, maxLength: 60 }), (xs) => {
        const c = series(xs);
        return JSON.stringify(tick(rules("dip_hunter"), c, null)) === JSON.stringify(tick(rules("dip_hunter"), c, null));
      }),
    );
  });
});

describe("backtest", () => {
  it("fills at the next hour's close, never the decision hour's", () => {
    const xs = [...Array.from({ length: 30 }, (_, i) => 100 + i), 140, 90];
    const r = backtest(rules("momentum"), series(xs), { feeBps: 0, lookback: 168, startUsd: 1000 });
    const firstBuy = r.decisions.findIndex((d) => d.action === "buy");
    expect(r.fills[0]).toMatchObject({ side: "buy", price: xs[firstBuy + 1] });
  });

  it("charges fees on both sides and books the stop loss", () => {
    const xs = [...Array.from({ length: 30 }, (_, i) => 100 + i), 130, 120, 120];
    const r = backtest(rules("momentum"), series(xs), { feeBps: 50, lookback: 168, startUsd: 1000 });
    expect(r.fills.map((f) => f.side)).toEqual(["buy", "sell"]);
    expect(r.fills[0]!.feeUsd).toBeCloseTo(0.5, 10);
    expect(r.endUsd).toBeLessThan(1000);
    expect(r.maxDrawdownPct).toBeGreaterThan(0);
    expect(r.holdReturnPct).toBeCloseTo(20, 10);
  });

  it("returns a flat result for an empty series", () => {
    const r = backtest(rules("momentum"), []);
    expect(r).toMatchObject({ fills: [], endUsd: 1000, returnPct: 0, holdReturnPct: 0 });
  });

  it("never spends more cash than it has", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1, max: 500, noNaN: true }), { minLength: 2, maxLength: 120 }), (xs) => {
        const r = backtest({ ...rules("dip_hunter"), sizeUsd: 5000 }, series(xs), { feeBps: 50, lookback: 168, startUsd: 1000 });
        return r.fills.filter((f) => f.side === "buy").every((f) => f.usd <= 1000 + 1e-9) && r.endUsd >= 0;
      }),
    );
  });
});
