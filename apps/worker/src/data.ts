// Read models for pages and the API. Every number the site shows comes from these queries.
import { MARKETS } from "./universe.js";

export interface AgentSummary {
  id: string;
  template: string;
  market: string;
  paper: boolean;
  config_hash: string;
  created_hour: number;
  start_cash: number;
  start_price: number | null;
  rules: unknown;
  cash: number;
  qty: number;
  entry_price: number | null;
  pending: unknown;
  last_hour: number;
  price: number | null;
  equity: number | null;
  return_pct: number | null;
  hold_return_pct: number | null;
  vs_hold_pts: number | null;
  last_action: string | null;
  decisions: number;
  trades: number;
}

export const TEMPLATE_LABEL: Record<string, string> = { momentum: "Momentum", mean_reversion: "Mean reversion", dip_hunter: "Dip hunter", breakout: "Breakout" };
export const agentName = (a: { template: string; market: string }): string => `${TEMPLATE_LABEL[a.template] ?? a.template} · ${a.market}`;

export async function agentSummaries(db: D1Database): Promise<AgentSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.template, a.market, a.paper, a.config_hash, a.created_hour, a.start_cash, a.start_price, a.rules,
              s.cash, s.qty, s.entry_price, s.pending, s.last_hour,
              (SELECT price FROM price_hourly p WHERE p.symbol = a.market AND p.hour = s.last_hour) AS price,
              (SELECT action FROM decisions d WHERE d.agent = a.id ORDER BY hour DESC LIMIT 1) AS last_action,
              (SELECT COUNT(*) FROM decisions d WHERE d.agent = a.id) AS decisions,
              (SELECT COUNT(*) FROM decisions d WHERE d.agent = a.id AND d.record LIKE '%"status":"filled"%') AS trades
         FROM agents a JOIN agent_state s ON s.agent = a.id`,
    )
    .all<{
      id: string; template: string; market: string; paper: number; config_hash: string; created_hour: number; start_cash: number;
      start_price: number | null; rules: string; cash: number; qty: number; entry_price: number | null; pending: string | null; last_hour: number;
      price: number | null; last_action: string | null; decisions: number; trades: number;
    }>();
  return results
    .map((r) => {
      const equity = r.price === null ? null : r.cash + r.qty * r.price;
      const ret = equity === null ? null : ((equity - r.start_cash) / r.start_cash) * 100;
      // Fair baseline: hold the same dollar amount the agent puts in per order, keep the rest in cash.
      const rules = JSON.parse(r.rules) as { sizeUsd?: number };
      const exposure = Math.min(1, (rules.sizeUsd ?? r.start_cash) / r.start_cash);
      const hold = r.price === null || !r.start_price ? null : ((r.price - r.start_price) / r.start_price) * 100 * exposure;
      return {
        id: r.id, template: r.template, market: r.market, paper: r.paper === 1, config_hash: r.config_hash, created_hour: r.created_hour,
        start_cash: r.start_cash, start_price: r.start_price, rules: JSON.parse(r.rules), cash: r.cash, qty: r.qty, entry_price: r.entry_price,
        pending: r.pending ? JSON.parse(r.pending) : null, last_hour: r.last_hour, price: r.price, equity, return_pct: ret,
        hold_return_pct: hold, vs_hold_pts: ret === null || hold === null ? null : ret - hold,
        last_action: r.last_action, decisions: r.decisions, trades: r.trades,
      };
    })
    .sort((a, b) => (b.return_pct ?? -1e9) - (a.return_pct ?? -1e9) || a.id.localeCompare(b.id));
}

export interface DecisionRow {
  agent: string;
  template: string;
  market: string;
  hour: number;
  action: string;
  record: {
    price?: number;
    fired?: string[];
    values?: Record<string, number | null>;
    feed?: { ok: boolean; reason: string };
    fill?: { status: string; side: string; price?: number; usd?: number; reason?: string } | null;
  };
}

export async function recentDecisions(db: D1Database, limit: number, agent?: string): Promise<DecisionRow[]> {
  const q = agent
    ? db.prepare("SELECT d.agent, a.template, a.market, d.hour, d.action, d.record FROM decisions d JOIN agents a ON a.id = d.agent WHERE d.agent = ? ORDER BY d.hour DESC LIMIT ?").bind(agent, limit)
    : db
        .prepare(
          `SELECT d.agent, a.template, a.market, d.hour, d.action, d.record FROM decisions d JOIN agents a ON a.id = d.agent
            ORDER BY d.hour DESC, (d.action != 'hold') DESC, d.agent LIMIT ?`,
        )
        .bind(limit);
  const { results } = await q.all<{ agent: string; template: string; market: string; hour: number; action: string; record: string }>();
  return results.map((r) => ({ ...r, record: JSON.parse(r.record) as DecisionRow["record"] }));
}

/** Plain-English reason for a decision, built only from the fields the engine recorded. */
export function explain(d: DecisionRow): string {
  const f = d.record.fill;
  const parts: string[] = [];
  if (f?.status === "filled") parts.push(`Paper ${f.side} filled at ${f.price?.toFixed(2)}.`);
  if (f?.status === "held") parts.push(`Paper ${f.side} held: ${f.reason === "stale_feed" ? "the Chainlink feed was stale" : f.reason}.`);
  const fired = d.record.fired ?? [];
  if (d.action === "hold") {
    const v = d.record.values ?? {};
    const shown = Object.entries(v).filter(([k]) => k !== "close").slice(0, 3).map(([k, x]) => `${k} ${x === null ? "n/a" : Number(x).toFixed(2)}`);
    parts.push(shown.length ? `No rule fired. ${shown.join(", ")}.` : "No rule fired.");
  } else {
    const nice = fired.map((x) => x.replace(/^entry:|^exit:/, "").replace("stop_loss", "stop loss").replace("take_profit", "take profit").replace("max_hold", "max holding time"));
    parts.push(`${d.action === "buy" ? "Buy" : "Sell"} signal: ${nice.join(" and ")}. Fills at the next hour's close.`);
  }
  return parts.join(" ");
}

export interface SealSummary {
  hour: number;
  root: string;
  leaf_count: number;
  status: string;
  tx_hash: string | null;
  block_number: number | null;
  block_time: number | null;
  timing: string | null;
}

export interface SiteStats {
  markets: number;
  agents: number;
  decisions: number;
  sealedOnTime: number;
  sealsSinceFirst: number;
  missedSinceFirst: number;
  firstSealHour: number | null;
  lastSeal: SealSummary | null;
  lastIngest: { hour: number; ok: number; failed: number } | null;
}

export async function siteStats(db: D1Database): Promise<SiteStats> {
  const [agents, decisions, first, lastSeal, ingest] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM decisions").first<{ n: number }>(),
    db.prepare("SELECT MIN(hour) AS h FROM seals WHERE status = 'confirmed'").first<{ h: number | null }>(),
    db.prepare("SELECT hour, root, leaf_count, status, tx_hash, block_number, block_time, timing FROM seals WHERE status = 'confirmed' ORDER BY hour DESC LIMIT 1").first<SealSummary>(),
    db.prepare("SELECT hour, ok, failed FROM ingest_runs WHERE finished_at IS NOT NULL ORDER BY hour DESC LIMIT 1").first<{ hour: number; ok: number; failed: number }>(),
  ]);
  const firstHour = first?.h ?? null;
  let onTime = 0;
  let total = 0;
  let missed = 0;
  if (firstHour !== null) {
    const r = await db
      .prepare("SELECT SUM(status = 'confirmed' AND timing = 'on_time') AS ok, COUNT(*) AS n, SUM(status IN ('missed', 'failed')) AS miss FROM seals WHERE hour >= ?")
      .bind(firstHour)
      .first<{ ok: number; n: number; miss: number }>();
    onTime = r?.ok ?? 0;
    total = r?.n ?? 0;
    missed = r?.miss ?? 0;
  }
  return {
    markets: MARKETS.length,
    agents: agents?.n ?? 0,
    decisions: decisions?.n ?? 0,
    sealedOnTime: onTime,
    sealsSinceFirst: total,
    missedSinceFirst: missed,
    firstSealHour: firstHour,
    lastSeal: lastSeal ?? null,
    lastIngest: ingest ?? null,
  };
}

export interface MarketCard {
  symbol: string;
  name: string;
  price: number | null;
  change24: number | null;
  series: number[];
  updatedAt: number | null;
}

export async function marketCards(db: D1Database, hours = 48): Promise<MarketCard[]> {
  const { results } = await db
    .prepare("SELECT symbol, hour, price, updated_at FROM price_hourly WHERE status IN ('ok', 'backfill') AND hour > (SELECT MAX(hour) FROM price_hourly) - ? ORDER BY symbol, hour")
    .bind(hours * 3600)
    .all<{ symbol: string; hour: number; price: number; updated_at: number }>();
  const by = new Map<string, { hour: number; price: number; updated_at: number }[]>();
  for (const r of results) (by.get(r.symbol) ?? by.set(r.symbol, []).get(r.symbol)!).push(r);
  return MARKETS.map((m) => {
    const rows = by.get(m.symbol) ?? [];
    const last = rows[rows.length - 1];
    const dayAgo = rows.find((r) => last && r.hour >= last.hour - 24 * 3600);
    return {
      symbol: m.symbol,
      name: m.name,
      price: last?.price ?? null,
      change24: last && dayAgo && dayAgo.price ? ((last.price - dayAgo.price) / dayAgo.price) * 100 : null,
      series: rows.map((r) => r.price),
      updatedAt: last?.updated_at ?? null,
    };
  });
}

export async function closes(db: D1Database, symbol: string, hours: number): Promise<{ hour: number; price: number }[]> {
  const { results } = await db
    .prepare("SELECT hour, price FROM price_hourly WHERE symbol = ? AND status IN ('ok', 'backfill') ORDER BY hour DESC LIMIT ?")
    .bind(symbol, hours)
    .all<{ hour: number; price: number }>();
  return results.reverse();
}

/** Equity of one agent at each decided hour, rebuilt from its sealed decision records. */
export async function equitySeries(db: D1Database, agent: string, market: string, startCash: number): Promise<{ hour: number; equity: number; price: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT d.hour, d.record, p.price FROM decisions d JOIN price_hourly p ON p.symbol = ? AND p.hour = d.hour
        WHERE d.agent = ? ORDER BY d.hour`,
    )
    .bind(market, agent)
    .all<{ hour: number; record: string; price: number }>();
  return results.map((r) => {
    const rec = JSON.parse(r.record) as { position_after?: { cash: number; qty: number } };
    const pos = rec.position_after ?? { cash: startCash, qty: 0 };
    return { hour: r.hour, price: r.price, equity: pos.cash + pos.qty * r.price };
  });
}
