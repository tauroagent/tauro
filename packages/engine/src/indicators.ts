/** Indicators over hourly closes. Every function returns null when there is not enough history. */

export function sma(closes: readonly number[], period: number): number | null {
  if (period <= 0 || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]!;
  return sum / period;
}

/** Wilder's RSI over the last `period` changes, seeded with a simple average. */
export function rsi(closes: readonly number[], period: number): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Percent change over the last `hours` candles, e.g. -3.2 for a 3.2% drop. */
export function pctChange(closes: readonly number[], hours: number): number | null {
  if (hours <= 0 || closes.length < hours + 1) return null;
  const from = closes[closes.length - 1 - hours]!;
  const to = closes[closes.length - 1]!;
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}
