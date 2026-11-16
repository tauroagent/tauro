import { TEMPLATES, validateRules, type Candle, type Rules } from "@tauro/engine";
import { canonicalize, payloadHash } from "@tauro/seal";
import { feedCheck, stepAgent, type AgentState, type Pending } from "./paper.js";
import { MARKETS } from "./universe.js";

/** House agents: every template on five liquid markets. All paper. */
export const HOUSE_MARKETS = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL"] as const;
export const HOUSE_TEMPLATES = ["momentum", "mean_reversion", "dip_hunter", "breakout"] as const;
export const START_CASH = 1000;
const LOOKBACK_HOURS = 168;

export function houseAgents(): { id: string; template: string; market: string; rules: Rules }[] {
  const out: { id: string; template: string; market: string; rules: Rules }[] = [];
  for (const t of HOUSE_TEMPLATES)
    for (const m of HOUSE_MARKETS) {
      const rules: Rules = { ...structuredClone(TEMPLATES[t]!), market: m };
      const errors = validateRules(rules);
      if (errors.length) throw new Error(`template ${t} invalid: ${JSON.stringify(errors)}`);
      out.push({ id: `house-${t.replace(/_/g, "-")}-${m.toLowerCase()}`, template: t, market: m, rules });
    }
  return out;
}

interface CloseRow {
  hour: number;
  price: number;
  updated_at: number;
}

/**
 * Runs every house agent for `hour` (which must already be ingested). Idempotent per (agent, hour):
 * an agent whose last_hour is >= hour is skipped. Creates agents on first sight and records their
 * creation in `agents`; the config hash is sealed in that hour.
 */
export async function runAgents(db: D1Database, hour: number, engineVer: string): Promise<{ ran: number; created: number }> {
  const heartbeat = new Map(MARKETS.map((m) => [m.symbol, m.heartbeatSec]));
  const candlesBy = new Map<string, CloseRow[]>();
  for (const m of HOUSE_MARKETS) {
    const { results } = await db
      .prepare("SELECT hour, price, updated_at FROM price_hourly WHERE symbol = ? AND hour <= ? AND hour > ? AND status IN ('ok', 'backfill') ORDER BY hour")
      .bind(m, hour, hour - LOOKBACK_HOURS * 3600)
      .all<CloseRow>();
    candlesBy.set(m, results);
  }

  let ran = 0;
  let created = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const a of houseAgents()) {
    const rows = candlesBy.get(a.market) ?? [];
    const last = rows[rows.length - 1];
    if (!last || last.hour !== hour) continue; // no close for this hour: the agent sits the hour out, visibly (no decision row)

    let st = await db.prepare("SELECT * FROM agent_state WHERE agent = ?").bind(a.id).first<{
      cash: number; qty: number; entry_price: number | null; opened_at: number | null; pending: string | null; last_hour: number;
    }>();
    if (!st) {
      const rules = canonicalize(a.rules);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO agents (id, owner, template, market, rules, config_hash, paper, start_cash, created_hour, start_price) VALUES (?, 'house', ?, ?, ?, ?, 1, ?, ?, ?)")
          .bind(a.id, a.template, a.market, rules, payloadHash(a.rules), START_CASH, hour, last.price),
        db.prepare("INSERT OR IGNORE INTO agent_state (agent, cash, qty, pending, last_hour) VALUES (?, ?, 0, NULL, ?)").bind(a.id, START_CASH, hour - 3600),
      ]);
      st = { cash: START_CASH, qty: 0, entry_price: null, opened_at: null, pending: null, last_hour: hour - 3600 };
      created++;
    }
    if (st.last_hour >= hour) continue;

    const state: AgentState = {
      cash: st.cash, qty: st.qty, entryPrice: st.entry_price, openedAt: st.opened_at,
      pending: st.pending ? (JSON.parse(st.pending) as Pending) : null,
    };
    const candles: Candle[] = rows.map((r) => ({ t: r.hour, close: r.price }));
    const feed = feedCheck(hour, last.updated_at, heartbeat.get(a.market) ?? 86_400);
    const { state: next, decision, fill } = stepAgent(a.rules, state, candles, hour, feed);

    const record = canonicalize({
      agent: a.id,
      hour,
      paper: true,
      action: decision.action,
      size_usd: decision.sizeUsd,
      price: decision.price,
      fired: decision.fired,
      values: decision.values,
      feed: { ok: feed.ok, reason: feed.reason, age_sec: feed.feedAgeSec },
      fill,
      position_after: { cash: Math.round(next.cash * 1e6) / 1e6, qty: Math.round(next.qty * 1e6) / 1e6 },
      config_hash: payloadHash(a.rules),
      engine: engineVer,
    });
    stmts.push(
      db.prepare("INSERT OR IGNORE INTO decisions (agent, hour, action, record) VALUES (?, ?, ?, ?)").bind(a.id, hour, decision.action, record),
      db.prepare("UPDATE agent_state SET cash = ?, qty = ?, entry_price = ?, opened_at = ?, pending = ?, last_hour = ? WHERE agent = ?")
        .bind(next.cash, next.qty, next.entryPrice, next.openedAt, next.pending ? JSON.stringify(next.pending) : null, hour, a.id),
    );
    ran++;
  }
  if (stmts.length) await db.batch(stmts);
  return { ran, created };
}
