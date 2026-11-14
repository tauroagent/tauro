import { pctChange, rsi, sma } from "./indicators.js";
import type { Condition, Rules } from "./rules.js";

export interface Candle {
  /** Unix seconds at the start of the hour. */
  t: number;
  close: number;
}

export interface Position {
  entryPrice: number;
  sizeUsd: number;
  openedAt: number;
}

export type Action = "buy" | "sell" | "hold";

export interface Decision {
  action: Action;
  /** Hour the decision belongs to: start of the last closed candle. */
  hour: number;
  price: number;
  sizeUsd: number;
  /** Short machine-readable reasons, e.g. "entry:rsi(14)<30" or "stop_loss". */
  fired: string[];
  /** The exact numbers the rules looked at, rounded to 6 decimals. */
  values: Record<string, number | null>;
}

const round6 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1e6) / 1e6);

function evalCondition(c: Condition, closes: readonly number[], values: Record<string, number | null>): [boolean, string] {
  const last = closes[closes.length - 1]!;
  switch (c.kind) {
    case "change": {
      const key = `change(${c.hours}h)`;
      const v = pctChange(closes, c.hours);
      values[key] = round6(v);
      return [v !== null && (c.op === "lt" ? v < c.pct : v > c.pct), `${key}${c.op === "lt" ? "<" : ">"}${c.pct}%`];
    }
    case "rsi": {
      const key = `rsi(${c.period})`;
      const v = rsi(closes, c.period);
      values[key] = round6(v);
      return [v !== null && (c.op === "lt" ? v < c.value : v > c.value), `${key}${c.op === "lt" ? "<" : ">"}${c.value}`];
    }
    case "sma_cross": {
      const fk = `sma(${c.fast})`;
      const sk = `sma(${c.slow})`;
      const f = sma(closes, c.fast);
      const s = sma(closes, c.slow);
      values[fk] = round6(f);
      values[sk] = round6(s);
      const ok = f !== null && s !== null && (c.dir === "above" ? f > s : f < s);
      return [ok, `${fk}${c.dir === "above" ? ">" : "<"}${sk}`];
    }
    case "price_vs_sma": {
      const key = `sma(${c.period})`;
      const s = sma(closes, c.period);
      values[key] = round6(s);
      const dist = s === null || s === 0 ? null : ((last - s) / s) * 100;
      values[`dist_${key}`] = round6(dist);
      const ok = dist !== null && (c.op === "lt" ? dist < c.pct : dist > c.pct);
      return [ok, `dist_${key}${c.op === "lt" ? "<" : ">"}${c.pct}%`];
    }
  }
}

/**
 * One hourly step. Pure: same inputs, same decision, in backtest, paper and live.
 * `candles` must be sorted by time and end with the hour that just closed.
 */
export function tick(rules: Rules, candles: readonly Candle[], position: Position | null): Decision {
  if (candles.length === 0) throw new Error("tick needs at least one candle");
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.t <= candles[i - 1]!.t) throw new Error("candles must be strictly increasing in time");
  }
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1]!;
  const values: Record<string, number | null> = { close: round6(last.close) };
  const base = { hour: last.t, price: last.close };

  if (position) {
    const pnlPct = ((last.close - position.entryPrice) / position.entryPrice) * 100;
    values["pnl_pct"] = round6(pnlPct);
    if (pnlPct <= -rules.stopLossPct) {
      return { ...base, action: "sell", sizeUsd: position.sizeUsd, fired: ["stop_loss"], values };
    }
    if (rules.takeProfitPct !== undefined && pnlPct >= rules.takeProfitPct) {
      return { ...base, action: "sell", sizeUsd: position.sizeUsd, fired: ["take_profit"], values };
    }
    const heldHours = (last.t - position.openedAt) / 3600;
    values["held_h"] = heldHours;
    if (rules.maxHoldHours !== undefined && heldHours >= rules.maxHoldHours) {
      return { ...base, action: "sell", sizeUsd: position.sizeUsd, fired: ["max_hold"], values };
    }
    const fired: string[] = [];
    for (const c of rules.exit) {
      const [ok, label] = evalCondition(c, closes, values);
      if (ok) fired.push(`exit:${label}`);
    }
    if (fired.length > 0) return { ...base, action: "sell", sizeUsd: position.sizeUsd, fired, values };
    return { ...base, action: "hold", sizeUsd: 0, fired: [], values };
  }

  const fired: string[] = [];
  let all = true;
  for (const c of rules.entry) {
    const [ok, label] = evalCondition(c, closes, values);
    if (ok) fired.push(`entry:${label}`);
    else all = false;
  }
  if (all) return { ...base, action: "buy", sizeUsd: rules.sizeUsd, fired, values };
  return { ...base, action: "hold", sizeUsd: 0, fired: [], values };
}
