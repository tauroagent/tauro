import { TEMPLATES, validateRules, type Rules } from "@tauro/engine";
import { canonicalize, payloadHash } from "@tauro/seal";
import { isAddress, isHex, type Hex, type PublicClient } from "viem";
import {
  agentIdFor, balancesOf, burnSlots, holdSlots, issuedOk, launchMessage, readBurn, retireMessage, sigHash, SLOTS, TEMPLATE_KEYS, tokens, type Credit,
} from "./holders.js";
import { TOKEN } from "./token.js";
import { MARKETS } from "./universe.js";

type Json = (body: unknown, init?: { status?: number; maxAge?: number }) => Response;

export const slotRules = () => ({
  token: TOKEN.address,
  chain_id: TOKEN.chain_id,
  hold: SLOTS.hold.map((t) => ({ min_tauro: tokens(t.min), slots: t.slots })),
  burn: { per_slot_tauro: tokens(SLOTS.burnPerSlot), slot_days: SLOTS.burnDays, to: "0x000000000000000000000000000000000000dEaD", counts_from: new Date(SLOTS.burnsCountFrom * 1000).toISOString() },
  checked: "Balances are read on chain at every hourly run. Agents beyond your slots wait (paused) and resume when slots return. Oldest agent first.",
  never: "No yield, no revenue share, no payouts. Holder agents are paper, like the house agents.",
  max_holder_agents: SLOTS.maxAgents,
});

async function tier(db: D1Database, c: PublicClient, address: string) {
  const owner = address.toLowerCase();
  const bal = (await balancesOf(c, [owner])).get(owner) ?? null;
  const now = Math.floor(Date.now() / 1000);
  const { results: credits } = await db.prepare("SELECT tx_hash, slots, expires_at, block_time, amount FROM burns WHERE owner = ? ORDER BY block_time DESC").bind(owner).all<Credit & { block_time: number; amount: string }>();
  const { results: agents } = await db
    .prepare("SELECT agent, market, template, status, status_reason, requested_at FROM launches WHERE owner = ? ORDER BY requested_at")
    .bind(owner)
    .all();
  const hold = bal === null ? null : holdSlots(bal);
  const burn = burnSlots(credits, now);
  return {
    address: owner,
    balance_tauro: bal === null ? null : tokens(bal),
    balance_read: bal !== null,
    hold_slots: hold,
    burn_slots: burn,
    slots: hold === null ? null : hold + burn,
    in_use: agents.filter((a) => (a as { status: string }).status !== "retired").length,
    burns: credits.map((b) => ({ tx_hash: b.tx_hash, tauro: tokens(BigInt(b.amount)), slots: b.slots, expires_at: new Date(b.expires_at * 1000).toISOString(), active: b.expires_at > now })),
    agents,
    rules: slotRules(),
  };
}

const bad = (json: Json, error: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, ...extra }, { status, maxAge: 0 });

export async function holdersRoute(path: string, req: Request, url: URL, db: D1Database, c: PublicClient, json: Json): Promise<Response | null> {
  const now = Math.floor(Date.now() / 1000);
  if (path === "/api/v1/tier") {
    const address = url.searchParams.get("address") ?? "";
    if (!isAddress(address)) return bad(json, "address must be a 0x wallet address", 400, { rules: slotRules() });
    return json(await tier(db, c, address), { maxAge: 0 });
  }

  if (path === "/api/v1/burns") {
    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { tx?: string };
      const tx = (body.tx ?? "").trim();
      if (!isHex(tx) || tx.length !== 66) return bad(json, "tx must be a 0x transaction hash");
      const seen = await db.prepare("SELECT tx_hash FROM burns WHERE tx_hash = ?").bind(tx.toLowerCase()).first();
      if (seen) return bad(json, "this burn is already recorded", 409);
      try {
        const b = await readBurn(c, tx as Hex);
        await db
          .prepare("INSERT OR IGNORE INTO burns (tx_hash, owner, amount, block_number, block_time, slots, expires_at, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(b.tx_hash, b.owner, b.amount.toString(), b.block_number, b.block_time, b.slots, b.expires_at, now)
          .run();
        return json({ recorded: true, owner: b.owner, tauro: tokens(b.amount), slots: b.slots, expires_at: new Date(b.expires_at * 1000).toISOString() }, { status: 201, maxAge: 0 });
      } catch (e) {
        return bad(json, (e as Error).message, 422);
      }
    }
    const { results } = await db.prepare("SELECT tx_hash, owner, amount, block_number, block_time, slots, expires_at FROM burns ORDER BY block_time DESC LIMIT 500").all<{ amount: string; block_time: number; expires_at: number }>();
    const total = results.reduce((s, r) => s + BigInt(r.amount), 0n);
    return json({
      note: "TAURO sent to 0x…dEaD to add holder agent slots. Every row is read from Robinhood Chain; check any tx_hash yourself.",
      total_tauro: tokens(total),
      burns: results.map((r) => ({ ...r, tauro: tokens(BigInt(r.amount)), block_time: new Date(r.block_time * 1000).toISOString(), expires_at: new Date(r.expires_at * 1000).toISOString() })),
    });
  }

  if (path === "/api/v1/agents/launch") {
    if (req.method !== "POST") return bad(json, "POST a signed launch request", 405, { rules: slotRules() });
    const b = (await req.json().catch(() => ({}))) as { owner?: string; template?: string; market?: string; stopLossPct?: number; sizeUsd?: number; issued?: string; signature?: string };
    if (!b.owner || !isAddress(b.owner)) return bad(json, "owner must be a wallet address");
    if (!TEMPLATE_KEYS.includes(b.template as (typeof TEMPLATE_KEYS)[number])) return bad(json, "unknown strategy", 400, { strategies: TEMPLATE_KEYS });
    if (!MARKETS.some((m) => m.symbol === b.market)) return bad(json, "unknown market");
    if (!Number.isFinite(b.stopLossPct) || b.stopLossPct! < 0.5 || b.stopLossPct! > 50) return bad(json, "stop loss must be between 0.5 and 50");
    if (!Number.isFinite(b.sizeUsd) || b.sizeUsd! < 10 || b.sizeUsd! > 1000) return bad(json, "order size must be between 10 and 1000");
    if (!b.issued || !issuedOk(b.issued, now)) return bad(json, "the signature is too old, sign again");
    if (!b.signature || !isHex(b.signature)) return bad(json, "signature missing");
    const owner = b.owner.toLowerCase();
    const req0 = { owner, template: b.template!, market: b.market!, stopLossPct: b.stopLossPct!, sizeUsd: b.sizeUsd!, issued: b.issued };
    const message = launchMessage(req0);
    const ok = await c.verifyMessage({ address: owner as Hex, message, signature: b.signature as Hex }).catch(() => false);
    if (!ok) return bad(json, "signature does not match this wallet and request", 401);

    const rules: Rules = { ...structuredClone(TEMPLATES[req0.template]!), market: req0.market, stopLossPct: req0.stopLossPct, sizeUsd: req0.sizeUsd };
    const errors = validateRules(rules);
    if (errors.length) return bad(json, "rules invalid", 400, { errors });
    const configHash = payloadHash(rules);
    const agent = agentIdFor(owner, req0.market, configHash);

    const total = await db.prepare("SELECT COUNT(*) AS n FROM launches WHERE status != 'retired'").first<{ n: number }>();
    if ((total?.n ?? 0) >= SLOTS.maxAgents) return bad(json, "holder agents are full for now", 503);
    const existing = await db.prepare("SELECT status FROM launches WHERE agent = ?").bind(agent).first<{ status: string }>();
    if (existing && existing.status !== "retired") return bad(json, "you already run this exact agent", 409, { agent });
    if (existing) return bad(json, "this exact agent was retired; change the stop loss or order size to start a new one", 409, { agent });

    const t = await tier(db, c, owner);
    if (t.slots === null) return bad(json, "could not read your TAURO balance, try again in a minute", 503);
    if (t.in_use >= t.slots) return bad(json, t.slots === 0 ? "this wallet has no slot: hold or burn TAURO first" : "all your slots are in use", 403, { slots: t.slots, in_use: t.in_use, rules: slotRules() });

    await db
      .prepare("INSERT INTO launches (agent, owner, template, market, rules, config_hash, requested_at, message, signature, sig_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')")
      .bind(agent, owner, req0.template, req0.market, canonicalize(rules), configHash, now, message, b.signature, sigHash(b.signature))
      .run();
    return json({ agent, status: "queued", starts: "at the next hourly run; its rules are sealed in that hour", page: `/agents/${agent}` }, { status: 201, maxAge: 0 });
  }

  if (path === "/api/v1/agents/retire") {
    if (req.method !== "POST") return bad(json, "POST a signed retire request", 405);
    const b = (await req.json().catch(() => ({}))) as { owner?: string; agent?: string; issued?: string; signature?: string };
    if (!b.owner || !isAddress(b.owner) || !b.agent || !b.issued || !b.signature || !isHex(b.signature)) return bad(json, "owner, agent, issued and signature are required");
    if (!issuedOk(b.issued, now)) return bad(json, "the signature is too old, sign again");
    const owner = b.owner.toLowerCase();
    const row = await db.prepare("SELECT owner, status FROM launches WHERE agent = ?").bind(b.agent).first<{ owner: string; status: string }>();
    if (!row || row.owner !== owner) return bad(json, "no agent of this wallet with that id", 404);
    if (row.status === "retired") return bad(json, "already retired", 409);
    const ok = await c.verifyMessage({ address: owner as Hex, message: retireMessage(owner, b.agent, b.issued), signature: b.signature as Hex }).catch(() => false);
    if (!ok) return bad(json, "signature does not match", 401);
    await db.prepare("UPDATE launches SET status = 'retired', status_reason = 'retired by owner', status_hour = ? WHERE agent = ?").bind(now - (now % 3600), b.agent).run();
    return json({ agent: b.agent, status: "retired", note: "It makes no more decisions. Its past decisions stay sealed and public." }, { maxAge: 0 });
  }
  return null;
}
