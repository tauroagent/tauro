import type { Rules } from "./rules.js";
import { tick, type Candle, type Decision, type Position } from "./tick.js";

export interface BacktestOptions {
  /** Fee per fill in basis points, applied on both buy and sell. */
  feeBps: number;
  /** Candles the engine sees per step. Must cover the longest indicator period. */
  lookback: number;
  startUsd: number;
}

export interface Fill {
  hour: number;
  side: "buy" | "sell";
  price: number;
  usd: number;
  feeUsd: number;
}

export interface BacktestResult {
  decisions: Decision[];
  fills: Fill[];
  endUsd: number;
  returnPct: number;
  holdReturnPct: number;
  /** Largest peak-to-trough drop of the equity curve, as a positive percent. */
  maxDrawdownPct: number;
}

export const DEFAULT_BACKTEST: BacktestOptions = { feeBps: 50, lookback: 168, startUsd: 1000 };

/**
 * Replays history through the same `tick` the live loop uses.
 * A decision made at the close of hour H fills at the close of hour H+1, never at H's own close,
 * because in live trading the order can only be sent after H has closed.
 */
export function backtest(rules: Rules, candles: readonly Candle[], opts: BacktestOptions = DEFAULT_BACKTEST): BacktestResult {
  const decisions: Decision[] = [];
  const fills: Fill[] = [];
  let cash = opts.startUsd;
  let qty = 0;
  let position: Position | null = null;
  let peak = opts.startUsd;
  let maxDd = 0;
  const fee = opts.feeBps / 10_000;

  for (let i = 0; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i + 1 - opts.lookback), i + 1);
    const d = tick(rules, window, position);
    decisions.push(d);
    const next = candles[i + 1]!;

    if (d.action === "buy" && cash > 0) {
      const usd = Math.min(d.sizeUsd, cash);
      const feeUsd = usd * fee;
      qty = (usd - feeUsd) / next.close;
      cash -= usd;
      position = { entryPrice: next.close, sizeUsd: usd, openedAt: next.t };
      fills.push({ hour: next.t, side: "buy", price: next.close, usd, feeUsd });
    } else if (d.action === "sell" && qty > 0) {
      const gross = qty * next.close;
      const feeUsd = gross * fee;
      cash += gross - feeUsd;
      fills.push({ hour: next.t, side: "sell", price: next.close, usd: gross, feeUsd });
      qty = 0;
      position = null;
    }

    const equity = cash + qty * next.close;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }

  const lastClose = candles.length > 0 ? candles[candles.length - 1]!.close : 0;
  const firstClose = candles.length > 0 ? candles[0]!.close : 0;
  const endUsd = cash + qty * lastClose;
  return {
    decisions,
    fills,
    endUsd,
    returnPct: ((endUsd - opts.startUsd) / opts.startUsd) * 100,
    holdReturnPct: firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0,
    maxDrawdownPct: maxDd,
  };
}
