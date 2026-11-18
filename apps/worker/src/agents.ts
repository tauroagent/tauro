import { TEMPLATES, validateRules, type Candle, type Rules } from "@tauro/engine";
import { canonicalize, payloadHash } from "@tauro/seal";
import { feedCheck, stepAgent, type AgentState, type Pending } from "./paper.js";
import { MARKETS } from "./universe.js";
import type { PublicClient } from "viem";
import { allocate, balancesOf, burnSlots, holdSlots, type Credit, type LaunchRow } from "./holders.js";

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
export async function runAgents(db: D1Database, hour: number, engineVer: string, c?: PublicClient): Promise<{ ran: number; created: number; holders?: unknown }> {
  const heartbeat = new Map(MARKETS.map((m) => [m.symbol, m.heartbeatSec]));
  const holders = c ? await gateHolders(db, c, hour) : [];
  const roster: { id: string; market: string; rules: Rules; house: boolean }[] = [
    ...houseAgents().map((a) => ({ id: a.id, market: a.market, rules: a.rules, house: true })),
    ...holders,
  ];
  const candlesBy = new Map<string, CloseRow[]>();
  for (const m of new Set(roster.map((a) => a.market))) {
    const { results } = await db
      .prepare("SELECT hour, price, updated_at FROM price_hourly WHERE symbol = ? AND hour <= ? AND hour > ? AND status IN ('ok', 'backfill') ORDER BY hour")
      .bind(m, hour, hour - LOOKBACK_HOURS * 3600)
      .all<CloseRow>();
    candlesBy.set(m, results);
  }

  let ran = 0;
  let created = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const a of roster) {
    const rows = candlesBy.get(a.market) ?? [];
    const last = rows[rows.length - 1];
    if (!last || last.hour !== hour) continue; // no close for this hour: the agent sits the hour out, visibly (no decision row)

    let st = await db.prepare("SELECT * FROM agent_state WHERE agent = ?").bind(a.id).first<{
      cash: number; qty: number; entry_price: number | null; opened_at: number | null; pending: string | null; last_hour: number;
    }>();
    if (!st && !a.house) continue; // holder agents are created by gateHolders
    if (!st) {
      const rules = canonicalize(a.rules);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO agents (id, owner, template, market, rules, config_hash, paper, start_cash, created_hour, start_price) VALUES (?, 'house', ?, ?, ?, ?, 1, ?, ?, ?)")
          .bind(a.id, houseTemplate(a.id), a.market, rules, payloadHash(a.rules), START_CASH, hour, last.price),
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
  return { ran, created, holders: holders.length };
}

const houseTemplate = (id: string): string => HOUSE_TEMPLATES.find((t) => id.startsWith(`house-${t.replace(/_/g, "-")}-`)) ?? "custom";

/**
 * Holder agents for this hour. Reads every holder's TAURO balance once, decides which agents have a
 * slot, creates first-time agents (their config is sealed in this hour) and returns the ones to run.
 */
export async function gateHolders(db: D1Database, c: PublicClient, hour: number): Promise<{ id: string; market: string; rules: Rules; house: false }[]> {
  const { results: rows } = await db
    .prepare("SELECT agent, owner, template, market, rules, config_hash, requested_at, status FROM launches WHERE status != 'retired' AND requested_at < ?")
    .bind(hour + 3600)
    .all<LaunchRow & { template: string; market: string; rules: string; config_hash: string }>();
  if (rows.length === 0) return [];
  const owners = [...new Set(rows.map((r) => r.owner))];
  const balances = await balancesOf(c, owners);
  const { results: burnRows } = await db.prepare("SELECT owner, tx_hash, slots, expires_at FROM burns WHERE expires_at > ?").bind(hour + 3600).all<Credit & { owner: string }>();
  const credits = new Map<string, Credit[]>();
  for (const b of burnRows) credits.set(b.owner, [...(credits.get(b.owner) ?? []), b]);
  const at = hour + 3600;
  const plan = allocate(rows, balances, credits, at);

  const closeAt = new Map<string, number>();
  for (const m of new Set(rows.map((r) => r.market))) {
    const p = await db.prepare("SELECT price FROM price_hourly WHERE symbol = ? AND hour = ? AND status IN ('ok', 'backfill')").bind(m, hour).first<{ price: number }>();
    if (p) closeAt.set(m, p.price);
  }

  const stmts: D1PreparedStatement[] = [];
  const run: { id: string; market: string; rules: Rules; house: false }[] = [];
  for (const o of owners) {
    const bal = balances.get(o);
    stmts.push(db.prepare("INSERT OR REPLACE INTO holder_checks (owner, hour, balance, slots) VALUES (?, ?, ?, ?)").bind(o, hour, bal == null ? null : bal.toString(), bal == null ? null : holdSlots(bal) + burnSlots(credits.get(o) ?? [], at)));
  }
  for (const p of plan) {
    const r = rows.find((x) => x.agent === p.agent)!;
    let status = p.status;
    let reason = p.reason;
    if (status === "active" && r.status === "queued") {
      const price = closeAt.get(r.market);
      if (price === undefined) { status = "queued"; reason = "no close for this market this hour"; }
      else
        stmts.push(
          db.prepare("INSERT OR IGNORE INTO agents (id, owner, template, market, rules, config_hash, paper, start_cash, created_hour, start_price) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
            .bind(r.agent, r.owner, r.template, r.market, r.rules, r.config_hash, START_CASH, hour, price),
          db.prepare("INSERT OR IGNORE INTO agent_state (agent, cash, qty, pending, last_hour) VALUES (?, ?, 0, NULL, ?)").bind(r.agent, START_CASH, hour - 3600),
        );
    }
    stmts.push(db.prepare("UPDATE launches SET status = ?, status_reason = ?, status_hour = ? WHERE agent = ?").bind(status, reason, hour, r.agent));
    if (status === "active") run.push({ id: r.agent, market: r.market, rules: JSON.parse(r.rules) as Rules, house: false });
  }
  await db.batch(stmts);
  return run;
}
