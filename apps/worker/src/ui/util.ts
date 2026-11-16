export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const utcHour = (sec: number): string => new Date(sec * 1000).toISOString().slice(11, 16) + " UTC";
export const utcDay = (sec: number): string => {
  const d = new Date(sec * 1000);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
};
export const utcStamp = (sec: number): string => `${utcDay(sec)}, ${utcHour(sec)}`;

export function ago(sec: number, now: number): string {
  const d = Math.max(0, now - sec);
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86_400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86_400)} d ago`;
}

export const usd = (v: number): string => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const price = (v: number): string => (v >= 1 ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4));
export const pct = (v: number | null, digits = 2): string => (v === null || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`);
export const pts = (v: number | null): string => (v === null || !Number.isFinite(v) ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} pts`);
export const tone = (v: number | null): string => (v === null || v === 0 ? "" : v > 0 ? "up" : "down");
export const short = (hex: string, a = 6, b = 4): string => (hex.length > a + b + 2 ? `${hex.slice(0, a)}…${hex.slice(-b)}` : hex);
export const int = (v: number): string => v.toLocaleString("en-US");

/** Inline SVG sparkline from values, scaled to the box. Empty string for fewer than 2 points. */
export function spark(values: readonly number[], w = 300, h = 88, area = true, label = "Price over the period"): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, pad + (1 - (v - min) / span) * (h - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const fill = area ? `<path class="area" d="${d}L${w} ${h}L0 ${h}Z"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${fill}<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Two-series line chart (agent vs hold) with light gridlines. */
export function lineChart(a: readonly number[], b: readonly number[], w = 720, h = 280, label = "Agent value compared with holding"): string {
  const all = [...a, ...b];
  if (a.length < 2) return "";
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 12;
  const path = (vs: readonly number[]) =>
    vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * w).toFixed(1)} ${(pad + (1 - (v - min) / span) * (h - pad * 2)).toFixed(1)}`).join("");
  const grid = [0.25, 0.5, 0.75].map((f) => `<line class="g" x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" vector-effect="non-scaling-stroke"/>`).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${grid}${b.length > 1 ? `<path class="b" d="${path(b)}" vector-effect="non-scaling-stroke"/>` : ""}<path class="a" d="${path(a)}" vector-effect="non-scaling-stroke"/></svg>`;
}

export const WAX = `<svg class="wax" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 2c4 0 5 3 8.5 3.6S47 4 49.7 6.8s.9 6.7 3 9.6 5.6 3.4 6.7 7.1-1.9 6.1-1.9 8.5 3 4.9 1.9 8.5-4.6 4.2-6.7 7.1-.3 6.8-3 9.6-6.2.6-9.7 1.2S36 62 32 62s-5-3-8.5-3.6S17 60 14.3 57.2s-.9-6.7-3-9.6-5.6-3.4-6.7-7.1S6.5 34.4 6.5 32s-3-4.9-1.9-8.5 4.6-4.2 6.7-7.1.3-6.8 3-9.6 6.2-.6 9.7-1.2S28 2 32 2Z" fill="var(--seal)"/><circle cx="32" cy="32" r="20" fill="none" stroke="var(--seal-ink)" stroke-opacity=".35"/><path d="M21 22.5c0 5 3 7 7.3 7h7.4c4.3 0 7.3-2 7.3-7" fill="none" stroke="var(--seal-ink)" stroke-width="3.6" stroke-linecap="round"/><path d="M32 29.5V43" stroke="var(--seal-ink)" stroke-width="3.8" stroke-linecap="round"/></svg>`;
