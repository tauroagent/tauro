/**
 * Price gate. A real fill goes ahead only when the pool price and the Chainlink answer agree
 * and the feed is fresh. Anything missing or odd blocks the fill: the gate fails closed.
 */

export interface FeedRound {
  roundId: bigint;
  answer: bigint;
  decimals: number;
  /** Unix seconds. */
  updatedAt: number;
}

export interface GateInput {
  /** Pool price of one stock token in USD. Null when the pool had no usable swap. */
  poolPrice: number | null;
  feed: FeedRound | null;
  /** Unix seconds when the gate runs. */
  now: number;
  /** Feed heartbeat plus slack, in seconds. */
  maxFeedAgeSec: number;
  maxGapBps: number;
  /** True when the venue reports the stock as halted. */
  halted: boolean;
}

export type GateReason = "ok" | "halted" | "no_feed" | "bad_answer" | "stale_feed" | "future_feed" | "no_pool_price" | "deviation";

export interface GateResult {
  ok: boolean;
  reason: GateReason;
  feedPrice: number | null;
  /** Gap between pool and feed, rounded up to a whole basis point. */
  gapBps: number | null;
  feedAgeSec: number | null;
}

export const DEFAULT_MAX_GAP_BPS = 200;

export function feedPrice(feed: FeedRound): number {
  return Number(feed.answer) / 10 ** feed.decimals;
}

export function gapBps(poolPrice: number, reference: number): number {
  return Math.ceil((Math.abs(poolPrice - reference) / reference) * 10_000);
}

export function checkGate(input: GateInput): GateResult {
  const blocked = (reason: GateReason, extra: Partial<GateResult> = {}): GateResult => ({
    ok: false,
    reason,
    feedPrice: null,
    gapBps: null,
    feedAgeSec: null,
    ...extra,
  });

  if (input.halted) return blocked("halted");
  const { feed } = input;
  if (!feed) return blocked("no_feed");
  if (feed.answer <= 0n) return blocked("bad_answer");
  const age = input.now - feed.updatedAt;
  if (age < 0) return blocked("future_feed", { feedAgeSec: age });
  if (age > input.maxFeedAgeSec) return blocked("stale_feed", { feedAgeSec: age });
  const ref = feedPrice(feed);
  if (input.poolPrice === null || !(input.poolPrice > 0)) return blocked("no_pool_price", { feedPrice: ref, feedAgeSec: age });
  const gap = gapBps(input.poolPrice, ref);
  if (gap > input.maxGapBps) return blocked("deviation", { feedPrice: ref, gapBps: gap, feedAgeSec: age });
  return { ok: true, reason: "ok", feedPrice: ref, gapBps: gap, feedAgeSec: age };
}

const Q96 = 2n ** 96n;

/**
 * Uniswap v3/v4 sqrtPriceX96 to a price of token0 in token1, adjusted for decimals.
 * Returns token1 per token0; invert for the other direction.
 */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  if (sqrtPriceX96 <= 0n) throw new Error("sqrtPriceX96 must be positive");
  // price = (sqrt / 2^96)^2, kept in bigint with 18 extra digits before converting.
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96);
  return (Number(scaled) / 1e18) * 10 ** (decimals0 - decimals1);
}
