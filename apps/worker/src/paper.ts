/**
 * One paper agent, one hour. Pure: the worker loads state and prices, calls `stepAgent`, stores the result.
 * Same `tick` as the backtest. Orders decided at hour H fill at the close of H+1, like the backtest,
 * and only if the feed is fresh at that hour; otherwise the order is held and dropped, with the reason.
 */
import { tick, type Candle, type Decision, type Rules } from "@tauro/engine";

export const PAPER_FEE_BPS = 50;

export interface Pending {
  action: "buy" | "sell";
  sizeUsd: number;
  decidedHour: number;
}

export interface AgentState {
  cash: number;
  qty: number;
  entryPrice: number | null;
  openedAt: number | null;
  pending: Pending | null;
}

export interface FeedCheck {
  ok: boolean;
  reason: string;
  feedAgeSec: number | null;
}

export type FillResult =
  | { status: "filled"; side: "buy" | "sell"; price: number; usd: number; feeUsd: number; qty: number }
  | { status: "held"; side: "buy" | "sell"; reason: string }
  | { status: "expired"; side: "buy" | "sell"; reason: string };

export interface StepResult {
  state: AgentState;
  decision: Decision;
  fill: FillResult | null;
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

export function stepAgent(rules: Rules, s: AgentState, candles: readonly Candle[], hour: number, feed: FeedCheck): StepResult {
  const close = candles[candles.length - 1];
  if (!close || close.t !== hour) throw new Error("the last candle must be the hour being stepped");
  let state: AgentState = { ...s, pending: null };
  let fill: FillResult | null = null;

  if (s.pending) {
    const p = s.pending;
    if (p.decidedHour !== hour - 3600) {
      fill = { status: "expired", side: p.action, reason: "order older than one hour" };
    } else if (!feed.ok) {
      fill = { status: "held", side: p.action, reason: feed.reason };
    } else if (p.action === "buy" && state.qty === 0 && state.cash > 0) {
      const usd = Math.min(p.sizeUsd, state.cash);
      const feeUsd = (usd * PAPER_FEE_BPS) / 10_000;
      const qty = (usd - feeUsd) / close.close;
      state = { ...state, cash: state.cash - usd, qty, entryPrice: close.close, openedAt: hour };
      fill = { status: "filled", side: "buy", price: close.close, usd: r6(usd), feeUsd: r6(feeUsd), qty: r6(qty) };
    } else if (p.action === "sell" && state.qty > 0) {
      const gross = state.qty * close.close;
      const feeUsd = (gross * PAPER_FEE_BPS) / 10_000;
      fill = { status: "filled", side: "sell", price: close.close, usd: r6(gross), feeUsd: r6(feeUsd), qty: r6(state.qty) };
      state = { ...state, cash: state.cash + gross - feeUsd, qty: 0, entryPrice: null, openedAt: null };
    } else {
      fill = { status: "expired", side: p.action, reason: "nothing to do for this order" };
    }
  }

  const position = state.qty > 0 && state.entryPrice !== null && state.openedAt !== null
    ? { entryPrice: state.entryPrice, sizeUsd: state.qty * state.entryPrice, openedAt: state.openedAt }
    : null;
  const decision = tick(rules, candles, position);
  if (decision.action === "buy" && state.qty === 0) state = { ...state, pending: { action: "buy", sizeUsd: decision.sizeUsd, decidedHour: hour } };
  if (decision.action === "sell" && state.qty > 0) state = { ...state, pending: { action: "sell", sizeUsd: decision.sizeUsd, decidedHour: hour } };
  return { state, decision, fill };
}

/** Feed freshness for paper fills: the close's round must be younger than heartbeat + slack. */
export function feedCheck(hour: number, updatedAt: number | null, heartbeatSec: number, slackSec = 3600): FeedCheck {
  if (updatedAt === null) return { ok: false, reason: "no_close", feedAgeSec: null };
  const age = hour + 3600 - updatedAt;
  if (age > heartbeatSec + slackSec) return { ok: false, reason: "stale_feed", feedAgeSec: age };
  return { ok: true, reason: "ok", feedAgeSec: age };
}

export const equity = (s: AgentState, price: number): number => s.cash + s.qty * price;
