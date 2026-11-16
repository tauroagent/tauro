// Runs in the browser: the same engine and backtest the house agents use, on the hourly closes from the API.
import { backtest, TEMPLATES, type Rules } from "@tauro/engine";

const DESC: Record<string, string> = {
  momentum: "Buys when the 6 hour average crosses above the 24 hour average and price rose over 6 hours. Sells on the cross back.",
  mean_reversion: "Buys when price is 2% under its 24 hour average. Sells back at the average, or after 48 hours.",
  dip_hunter: "Buys when RSI(14) is under 30 after a 3% drop over 24 hours. Sells when RSI recovers above 55 or at +4%.",
  breakout: "Buys when price is 2% above its 48 hour average and up 1% over 3 hours. Sells on a 1% drop over 3 hours.",
};
const form = document.querySelector<HTMLFormElement>("[data-studio]")!;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const market = $<HTMLSelectElement>("#s-market");
const stop = $<HTMLInputElement>("#s-stop");
const size = $<HTMLInputElement>("#s-size");
let template = "momentum";
const cache = new Map<string, { t: number; close: number }[]>();
const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

const params = new URLSearchParams(location.search);
if (params.get("market")) market.value = params.get("market")!;

function chart(a: number[], b: number[]): string {
  const all = [...a, ...b]; const min = Math.min(...all), max = Math.max(...all), span = max - min || 1, W = 720, H = 260;
  const p = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * W).toFixed(1)} ${(10 + (1 - (v - min) / span) * (H - 20)).toFixed(1)}`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Strategy value compared with holding"><path class="b" d="${p(b)}" vector-effect="non-scaling-stroke"/><path class="a" d="${p(a)}" vector-effect="non-scaling-stroke"/></svg>`;
}

async function closes(sym: string) {
  if (!cache.has(sym)) {
    const j = (await (await fetch(`/api/v1/prices?symbol=${sym}&hours=720`)).json()) as { rows: { hour: number; price: number | null; status: string }[] };
    cache.set(sym, j.rows.filter((r) => r.price !== null && (r.status === "ok" || r.status === "backfill")).map((r) => ({ t: r.hour, close: r.price! })).reverse());
  }
  return cache.get(sym)!;
}

async function run() {
  $("[data-tpl-desc]").textContent = DESC[template] ?? "";
  const candles = await closes(market.value);
  if (candles.length < 3) { $("[data-range]").textContent = "Not enough history for this token yet."; return; }
  const rules: Rules = { ...structuredClone(TEMPLATES[template]!), market: market.value, stopLossPct: Number(stop.value) || 3, sizeUsd: Number(size.value) || 100 };
  const r = backtest(rules, candles, { feeBps: 50, lookback: 168, startUsd: 1000 });
  // Equity path, rebuilt from fills, for the chart.
  let cash = 1000, qty = 0, fi = 0; const eq: number[] = [], hold: number[] = [];
  for (const c of candles) {
    while (fi < r.fills.length && r.fills[fi]!.hour === c.t) { const f = r.fills[fi++]!; if (f.side === "buy") { qty = (f.usd - f.feeUsd) / f.price; cash -= f.usd; } else { cash += f.usd - f.feeUsd; qty = 0; } }
    eq.push(cash + qty * c.close); hold.push((1000 * c.close) / candles[0]!.close);
  }
  $("[data-range]").textContent = `${candles.length} hourly closes, ${day(candles[0]!.t)} to ${day(candles[candles.length - 1]!.t)} (UTC). History before the agents started is backfilled from Chainlink rounds.`;
  const ret = $("[data-ret]"); ret.textContent = fmtPct(r.returnPct); ret.className = "big-result " + (r.returnPct > 0 ? "up" : r.returnPct < 0 ? "down" : "");
  const hd = $("[data-hold]"); hd.textContent = fmtPct(r.holdReturnPct); hd.className = r.holdReturnPct > 0 ? "up" : r.holdReturnPct < 0 ? "down" : "";
  $("[data-chart]").innerHTML = chart(eq, hold);
  const diff = r.returnPct - r.holdReturnPct;
  $("[data-verdict]").textContent = r.fills.length === 0
    ? "No trade: the rules never fired on this history. Try another token or strategy."
    : diff >= 0 ? `Ahead of holding by ${diff.toFixed(2)} points on this history.` : `Behind holding by ${Math.abs(diff).toFixed(2)} points on this history.`;
  $("[data-fills]").textContent = String(r.fills.length);
  $("[data-dd]").textContent = `−${r.maxDrawdownPct.toFixed(2)}%`;
  $("[data-end]").textContent = `$${r.endUsd.toFixed(2)}`;
}

document.querySelectorAll<HTMLButtonElement>("[data-template]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-template]").forEach((x) => x.setAttribute("aria-pressed", "false"));
  b.setAttribute("aria-pressed", "true"); template = b.dataset.template!; void run();
}));
form.addEventListener("input", () => void run());
form.addEventListener("submit", (e) => e.preventDefault());
void run();
