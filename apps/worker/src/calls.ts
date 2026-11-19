import { canonicalize, hourStart } from "@tauro/seal";
import { isAddress, isHex, keccak256, toHex, type Hex, type PublicClient } from "viem";
import { issuedOk, sigHash } from "./holders.js";
import { MARKETS } from "./universe.js";

/**
 * Sealed calls. Anyone signs a market call (stock token, up or down, a horizon, a short note).
 * It becomes a leaf in the next hourly root on Robinhood Chain, so it cannot be edited or
 * backdated. The entry is the Chainlink close of the hour it is sealed in; the result is read
 * from the close at entry + horizon. Paper only: no trade, no money, no transaction.
 */
export const CALLS = {
  horizons: [1, 4, 24, 72, 168],
  sides: ["up", "down"] as const,
  noteMax: 140,
  perWalletPerDay: 3,
  perDay: 1000,
} as const;

export type Side = (typeof CALLS.sides)[number];

export interface CallRequest {
  caller: string;
  market: string;
  side: Side;
  horizon: number;
  note: string;
  issued: string;
}

/** Notes are plain one-line text: no line breaks, no control characters. */
export const cleanNote = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The exact text a wallet signs. The server rebuilds it from the request fields. */
export function callMessage(r: CallRequest): string {
  return [
    "Tauro: seal my call",
    `Caller: ${r.caller.toLowerCase()}`,
    `Market: ${r.market}`,
    `Call: ${r.side}`,
    `Within: ${r.horizon} hours`,
    `Note: ${r.note || "-"}`,
    `Issued: ${r.issued}`,
    "Paper only. This signature sends no transaction and costs nothing.",
  ].join("\n");
}

export const callIdFor = (caller: string, issued: string, sig: string): string =>
  "call-" + keccak256(toHex(`${caller.toLowerCase()}|${issued}|${sig.toLowerCase()}`)).slice(2, 14);

/** A call submitted during hour H is sealed in hour H+1, after the next close. */
export const sealHourFor = (submittedAt: number): number => hourStart(submittedAt) + 3600;

export function validateCall(b: Partial<CallRequest> & { signature?: string }, nowSec: number): string | null {
  if (!b.caller || !isAddress(b.caller)) return "caller must be a wallet address";
  if (!MARKETS.some((m) => m.symbol === b.market)) return "unknown market";
  if (!CALLS.sides.includes(b.side as Side)) return "call must be up or down";
  if (!CALLS.horizons.includes(b.horizon as (typeof CALLS.horizons)[number])) return `horizon must be one of ${CALLS.horizons.join(", ")} hours`;
  if (typeof b.note !== "string" || cleanNote(b.note) !== b.note || b.note.length > CALLS.noteMax) return `note must be one line, at most ${CALLS.noteMax} characters`;
  if (!b.issued || !issuedOk(b.issued, nowSec)) return "the signature is too old, sign again";
  if (!b.signature || !isHex(b.signature)) return "signature missing";
  return null;
}

export interface CallRow {
  id: string; caller: string; market: string; side: Side; horizon: number; note: string; issued: string;
  message: string; signature: string; submitted_at: number; hour: number;
}

/** What gets sealed. Signature included, so anyone can re-check the wallet signed this exact text. */
export const callRecord = (c: CallRow): string =>
  canonicalize({ call: c.id, caller: c.caller, market: c.market, side: c.side, horizon_hours: c.horizon, note: c.note, issued: c.issued, message: c.message, signature: c.signature, paper: true });

export interface Outcome {
  state: "waiting_for_seal" | "open" | "resolved" | "no_price";
  entry: number | null;
  exit: number | null;
  move_pct: number | null;
  right: boolean | null;
  resolves_at: number;
}

/** Entry = close at the sealed hour, exit = close at hour + horizon. Weekend closes are as read. */
export function outcome(c: Pick<CallRow, "side" | "hour" | "horizon">, entry: number | null, exit: number | null, nowSec: number, sealed: boolean): Outcome {
  const resolves_at = c.hour + c.horizon * 3600;
  if (!sealed) return { state: "waiting_for_seal", entry, exit: null, move_pct: null, right: null, resolves_at };
  if (entry === null) return { state: "no_price", entry, exit: null, move_pct: null, right: null, resolves_at };
  if (nowSec < resolves_at || exit === null) return { state: "open", entry, exit: null, move_pct: null, right: null, resolves_at };
  const move = (exit / entry - 1) * 100;
  return { state: "resolved", entry, exit, move_pct: move, right: c.side === "up" ? move > 0 : move < 0, resolves_at };
}

type Json = (body: unknown, init?: { status?: number; maxAge?: number }) => Response;
const bad = (json: Json, error: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, ...extra }, { status, maxAge: 0 });

export const callRules = () => ({
  what: "Sign a call on a Robinhood Chain stock token. It is sealed in the next hourly root on chain, so it cannot be edited or backdated.",
  markets: MARKETS.map((m) => m.symbol),
  sides: CALLS.sides,
  horizons_hours: CALLS.horizons,
  note_max: CALLS.noteMax,
  limit: `${CALLS.perWalletPerDay} calls per wallet per UTC day`,
  entry: "Chainlink close of the hour the call is sealed in (the next hour after you sign)",
  result: "Chainlink close at entry hour + horizon. Up is right if it closed higher, down if lower.",
  cost: "Free. A signature, not a transaction. Paper only.",
});

async function closeAt(db: D1Database, market: string, hour: number): Promise<number | null> {
  const r = await db.prepare("SELECT price FROM price_hourly WHERE symbol = ? AND hour = ? AND status IN ('ok', 'backfill')").bind(market, hour).first<{ price: number }>();
  return r?.price ?? null;
}

export async function callView(db: D1Database, c: CallRow, nowSec: number) {
  const seal = await db.prepare("SELECT hour, root, status, tx_hash, block_number, timing FROM seals WHERE hour = ?").bind(c.hour).first<{ status: string; tx_hash: string | null; root: string; block_number: number | null; timing: string | null }>();
  const sealed = seal?.status === "confirmed";
  const o = outcome(c, await closeAt(db, c.market, c.hour), await closeAt(db, c.market, c.hour + c.horizon * 3600), nowSec, sealed);
  return {
    id: c.id, caller: c.caller, market: c.market, side: c.side, horizon_hours: c.horizon, note: c.note, issued: c.issued,
    submitted_at: new Date(c.submitted_at * 1000).toISOString(), sealed_hour: c.hour, sealed_hour_utc: new Date(c.hour * 1000).toISOString(),
    seal: seal ? { status: seal.status, root: seal.root, tx_hash: seal.tx_hash, block_number: seal.block_number, timing: seal.timing } : { status: "pending" },
    proof: `/api/v1/proof?hour=${c.hour}&subject=${c.id}`,
    outcome: { ...o, resolves_at: new Date(o.resolves_at * 1000).toISOString() },
    message: c.message, signature: c.signature, page: `/calls/${c.id}`,
  };
}

export async function getCall(db: D1Database, id: string): Promise<CallRow | null> {
  return db.prepare("SELECT * FROM calls WHERE id = ?").bind(id).first<CallRow>();
}

export async function listCalls(db: D1Database, caller: string | null, limit: number): Promise<CallRow[]> {
  const q = caller
    ? db.prepare("SELECT * FROM calls WHERE caller = ? ORDER BY submitted_at DESC LIMIT ?").bind(caller.toLowerCase(), limit)
    : db.prepare("SELECT * FROM calls ORDER BY submitted_at DESC LIMIT ?").bind(limit);
  return (await q.all<CallRow>()).results;
}

export async function callsRoute(path: string, req: Request, url: URL, db: D1Database, c: PublicClient, json: Json): Promise<Response | null> {
  const now = Math.floor(Date.now() / 1000);
  const one = path.match(/^\/api\/v1\/calls\/(call-[0-9a-f]{12})$/);
  if (one) {
    const row = await getCall(db, one[1]!);
    if (!row) return bad(json, "no call with this id", 404);
    return json(await callView(db, row, now), { maxAge: 60 });
  }
  if (path !== "/api/v1/calls") return null;

  if (req.method !== "POST") {
    const caller = url.searchParams.get("caller");
    if (caller && !isAddress(caller)) return bad(json, "caller must be a wallet address");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const rows = await listCalls(db, caller, limit);
    return json({ rules: callRules(), calls: await Promise.all(rows.map((r) => callView(db, r, now))) }, { maxAge: 30 });
  }

  const b = (await req.json().catch(() => ({}))) as Partial<CallRequest> & { signature?: string };
  const err = validateCall(b, now);
  if (err) return bad(json, err, 400, { rules: callRules() });
  const r: CallRequest = { caller: b.caller!.toLowerCase(), market: b.market!, side: b.side!, horizon: b.horizon!, note: b.note!, issued: b.issued! };
  const message = callMessage(r);
  const ok = await c.verifyMessage({ address: r.caller as Hex, message, signature: b.signature as Hex }).catch(() => false);
  if (!ok) return bad(json, "signature does not match this wallet and call", 401);

  const day = now - (now % 86400);
  const mine = await db.prepare("SELECT COUNT(*) AS n FROM calls WHERE caller = ? AND submitted_at >= ?").bind(r.caller, day).first<{ n: number }>();
  if ((mine?.n ?? 0) >= CALLS.perWalletPerDay) return bad(json, `${CALLS.perWalletPerDay} calls per wallet per day, try again tomorrow (UTC)`, 429);
  const all = await db.prepare("SELECT COUNT(*) AS n FROM calls WHERE submitted_at >= ?").bind(day).first<{ n: number }>();
  if ((all?.n ?? 0) >= CALLS.perDay) return bad(json, "the daily limit for all calls is reached, try again tomorrow (UTC)", 503);

  const id = callIdFor(r.caller, r.issued, b.signature!);
  const hour = sealHourFor(now);
  const res = await db
    .prepare("INSERT OR IGNORE INTO calls (id, caller, market, side, horizon, note, issued, message, signature, sig_hash, submitted_at, hour) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, r.caller, r.market, r.side, r.horizon, r.note, r.issued, message, b.signature, sigHash(b.signature!), now, hour)
    .run();
  if (!res.meta.changes) return bad(json, "this signature was already used", 409);
  return json({ id, sealed_hour_utc: new Date(hour * 1000).toISOString(), page: `/calls/${id}`, note: "Sealed in the next hourly root on Robinhood Chain. Entry is that hour's Chainlink close." }, { status: 201, maxAge: 0 });
}
