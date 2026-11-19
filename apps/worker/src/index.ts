import { TOKEN } from "./token.js";
import status from "../../../status.json";
import { client } from "./chain.js";
import { buildTree, getProof } from "@tauro/seal";
import type { Hex } from "viem";
import { HOUSE_MARKETS, runAgents } from "./agents.js";
import { runIngest } from "./ingest.js";
import { buildPending, sendPending } from "./seal-run.js";
import { callsRoute, callView, getCall, listCalls, callRules } from "./calls.js";
import { backtest, TEMPLATES } from "@tauro/engine";
import { agentSummaries, closes, equitySeries, hoursOfPrices, marketCards, recentDecisions, recentSeals, showcase, siteStats } from "./data.js";
import { renderHome, type HomeModel } from "./ui/home.js";
import { renderAgent, renderAgents, renderBounty, renderCall, renderCalls, renderMarket, renderMarkets, renderNotFound, renderStudio, renderToken, renderVerify } from "./ui/pages.js";
import { MARKETS, UNIVERSE_SOURCES } from "./universe.js";
import { holdersRoute, slotRules } from "./holders-api.js";

export interface Env {
  DB: D1Database;
  RPC_URL?: string;
  GIT_SHA?: string;
  SIGNER_KEY?: string;
  REGISTRY_ADDRESS?: string;
}

const json = (body: unknown, init: { status?: number; maxAge?: number } = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": `public, max-age=${init.maxAge ?? 60}`,
    },
  });

const ROUTES = {
  "/api/health": "Service health and the latest ingested hour.",
  "/api/v1/markets": "Stock tokens tracked, with token and Chainlink feed addresses and the latest hourly close.",
  "/api/v1/prices?symbol=TSLA&hours=48": "Hourly Chainlink closes for one market, newest first (max 720 hours).",
  "/api/v1/ingest?hours=48": "Every ingest run, including failed reads, newest first.",
  "/api/v1/seals?hours=48": "Hourly Merkle roots: built, sent, confirmed on SealRegistry, failed or missed.",
  "/api/v1/proof?hour=1794690000&subject=TSLA": "One leaf with its record, Merkle proof, root and seal status.",
  "/api/v1/agents": "All paper agents, house and holder: rules, config hash, paper book, equity vs buy-and-hold.",
  "/api/v1/decisions?agent=house-momentum-tsla&hours=24": "Every hourly decision of one agent, with the numbers its rules looked at and any paper fill.",
  "/api/v1/tier?address=0x…": "A wallet's TAURO balance, holder agent slots, burns and agents. Read from chain on each call.",
  "POST /api/v1/agents/launch": "Start your own paper agent with a wallet signature. Needs a free slot (hold or burn TAURO).",
  "POST /api/v1/agents/retire": "Stop one of your agents with a wallet signature. Its sealed history stays public.",
  "/api/v1/calls": "Sealed calls, newest first. POST a signed call (caller, market, side up|down, horizon 1|4|24|72|168 hours, note, issued, signature) to seal it in the next hourly root. ?caller=0x… for one wallet.",
  "/api/v1/calls/call-…": "One sealed call: the signed text, its seal, proof link, entry close and result.",
  "/api/v1/burns": "Every TAURO burn recorded for slots. POST {tx} to record yours; it is checked on chain.",
  "/api/v1/status": "Every public claim and its status (status.json).",
  "/version": "Deployed git commit.",
};

async function latestCloses(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT p.symbol, p.hour, p.price, p.round_id, p.updated_at, p.status
         FROM price_hourly p
         JOIN (SELECT symbol, MAX(hour) AS hour FROM price_hourly WHERE status = 'ok' GROUP BY symbol) l
           ON l.symbol = p.symbol AND l.hour = p.hour`,
    )
    .all<{ symbol: string; hour: number; price: number; round_id: string; updated_at: number; status: string }>();
  return new Map(results.map((r) => [r.symbol, r]));
}

const html = (body: string, status = 200, maxAge = 60): Response =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${maxAge}` } });

async function homeModel(env: Env): Promise<HomeModel> {
  const [stats, agents, decisions, markets, hours, runs, seals] = await Promise.all([
    siteStats(env.DB),
    agentSummaries(env.DB),
    recentDecisions(env.DB, 40),
    marketCards(env.DB),
    hoursOfPrices(env.DB),
    showcase(env.DB, TEMPLATES, HOUSE_MARKETS, (rules, candles) => backtest(rules as Parameters<typeof backtest>[0], candles, { feeBps: 50, lookback: 168, startUsd: 1000 })),
    recentSeals(env.DB, 24),
  ]);
  const top = agents[0];
  const featuredSeries = (await closes(env.DB, top?.market ?? "SPY", 48)).map((c) => c.price);
  return { now: Math.floor(Date.now() / 1000), stats, hoursOfPrices: hours, agents, decisions, markets, featuredSeries, showcase: runs, seals, claims: status.claims };
}

const LLMS = `# Tauro

> Paper trading agents for tokenized stocks on Robinhood Chain. Rules you can read, hourly Chainlink closes, and every hourly decision sealed on chain (SealRegistry 0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14, chain 4663) before the next close.

## What is live
- Hourly Chainlink closes for 35 Robinhood Chain stock tokens: https://tauroagent.com/api/v1/markets
- 20 house paper agents (momentum, mean reversion, dip hunter, breakout on SPY, QQQ, NVDA, TSLA, AAPL): https://tauroagent.com/api/v1/agents
- Hourly Merkle seals on chain: https://tauroagent.com/api/v1/seals
- Sealed calls: anyone signs a call on a stock token (up or down, 1 hour to 7 days). It is sealed in the next hourly root and scored against the Chainlink close at its horizon. Free: https://tauroagent.com/calls, https://tauroagent.com/api/v1/calls
- Seal bounty: 5,000,000 TAURO for the first valid way to fake a sealed record or rewrite a sealed hour, until 31 December 2026: https://tauroagent.com/bounty
- Holder agents: hold 1,000,000 TAURO for one paper agent slot, 5,000,000 for three, or burn 1,000,000 for one more slot for 30 days. Start one with a signed message, no transaction: https://tauroagent.com/token, https://tauroagent.com/api/v1/tier?address=<wallet>
- Proof for any leaf: https://tauroagent.com/api/v1/proof?hour=<unix hour>&subject=<agent id | symbol | status.json>
- Every public claim and its status: https://tauroagent.com/api/v1/status

## What Tauro is not
- No agent trades real money yet. All returns are paper.
- Not investment advice. Not for US persons.
- Built on Robinhood Chain; not affiliated with Robinhood, Chainlink or Uniswap.

Source (MIT): https://github.com/tauroagent/tauro
`;

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
  if (url.pathname === "/api/v1/calls" || url.pathname.startsWith("/api/v1/calls/")) {
    const r = await callsRoute(url.pathname, req, url, env.DB, client(env.RPC_URL), json);
    if (r) return r;
  }
  if (["/api/v1/tier", "/api/v1/burns", "/api/v1/agents/launch", "/api/v1/agents/retire"].includes(url.pathname)) {
    const r = await holdersRoute(url.pathname, req, url, env.DB, client(env.RPC_URL), json);
    if (r) return r;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, { status: 405 });

  switch (url.pathname) {
    case "/":
      return html(renderHome(await homeModel(env)));
    case "/agents":
      return html(renderAgents(await agentSummaries(env.DB)));
    case "/markets":
      return html(renderMarkets(await marketCards(env.DB)));
    case "/verify":
      return html(renderVerify(), 200, 3600);
    case "/studio":
      return html(renderStudio(), 200, 3600);
    case "/token": {
      const { results } = await env.DB.prepare("SELECT tx_hash, owner, amount, block_time, slots, expires_at FROM burns ORDER BY block_time DESC LIMIT 100").all<{ tx_hash: string; owner: string; amount: string; block_time: number; slots: number; expires_at: number }>();
      const running = await env.DB.prepare("SELECT COUNT(*) AS n FROM launches WHERE status = 'active'").first<{ n: number }>();
      const r = slotRules();
      const tk = (w: string) => Number(BigInt(w) / 10n ** 12n) / 1e6;
      return html(renderToken({
        address: TOKEN.address, hold: r.hold, burn: r.burn, holderAgents: running?.n ?? 0,
        totalBurned: results.reduce((s, b) => s + tk(b.amount), 0),
        burns: results.map((b) => ({ tx_hash: b.tx_hash, owner: b.owner, tauro: tk(b.amount), slots: b.slots, block_time: new Date(b.block_time * 1000).toISOString(), expires_at: new Date(b.expires_at * 1000).toISOString() })),
      }), 200, 60);
    }
    case "/bounty":
      return html(renderBounty());
    case "/calls": {
      const now = Math.floor(Date.now() / 1000);
      const rows = await listCalls(env.DB, null, 100);
      return html(renderCalls(await Promise.all(rows.map((r) => callView(env.DB, r, now))), callRules()));
    }
    case "/llms.txt":
      return new Response(LLMS, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    case "/api/v1":
    case "/api":
      return json({ routes: ROUTES, auth: "none" }, { maxAge: 3600 });
    case "/api/health": {
      const r = await env.DB.prepare("SELECT MAX(hour) AS h FROM ingest_runs WHERE finished_at IS NOT NULL").first<{ h: number | null }>();
      return json({ ok: true, markets: MARKETS.length, last_ingested_hour: r?.h ?? null }, { maxAge: 30 });
    }
    case "/api/v1/markets": {
      const closes = await latestCloses(env.DB);
      return json({
        chain_id: 4663,
        sources: UNIVERSE_SOURCES,
        markets: MARKETS.map((m) => {
          const c = closes.get(m.symbol);
          return { ...m, latest_close: c ? { hour: c.hour, price: c.price, round_id: c.round_id, updated_at: c.updated_at } : null };
        }),
      });
    }
    case "/api/v1/prices": {
      const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
      if (!MARKETS.some((m) => m.symbol === symbol)) return json({ error: "unknown symbol", symbols: MARKETS.map((m) => m.symbol) }, { status: 400 });
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 48) || 48, 1), 720);
      const { results } = await env.DB.prepare(
        "SELECT hour, price, answer, round_id, updated_at, status, read_at FROM price_hourly WHERE symbol = ? ORDER BY hour DESC LIMIT ?",
      )
        .bind(symbol, hours)
        .all();
      return json({ symbol, source: "chainlink", note: "close = last round updated before the hour ended", rows: results });
    }
    case "/api/v1/ingest": {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 48) || 48, 1), 720);
      const { results } = await env.DB.prepare("SELECT * FROM ingest_runs ORDER BY hour DESC LIMIT ?").bind(hours).all();
      return json({ runs: results });
    }
    case "/api/v1/seals": {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 48) || 48, 1), 720);
      const { results } = await env.DB.prepare(
        "SELECT hour, root, leaf_count, prev_root, status, tx_hash, block_number, block_time, timing, error FROM seals ORDER BY hour DESC LIMIT ?",
      )
        .bind(hours)
        .all();
      return json({ chain_id: 4663, registry: env.REGISTRY_ADDRESS ?? null, signer_configured: Boolean(env.SIGNER_KEY), seals: results });
    }
    case "/api/v1/proof": {
      const hour = Number(url.searchParams.get("hour"));
      const subject = url.searchParams.get("subject") ?? "";
      if (!Number.isInteger(hour) || hour % 3600 !== 0) return json({ error: "hour must be unix seconds at the start of an hour" }, { status: 400 });
      const seal = await env.DB.prepare("SELECT * FROM seals WHERE hour = ?").bind(hour).first<{ root: string }>();
      if (!seal) return json({ error: "no seal built for this hour" }, { status: 404 });
      const { results } = await env.DB.prepare("SELECT leaf, kind, subject, record FROM leaves WHERE hour = ?").bind(hour).all<{
        leaf: Hex;
        kind: number;
        subject: string;
        record: string;
      }>();
      const mine = results.find((l) => l.subject === subject);
      if (!mine) return json({ error: "no leaf for this subject", subjects: results.map((l) => l.subject) }, { status: 404 });
      const tree = buildTree(results.map((l) => l.leaf));
      return json({
        hour,
        subject,
        kind: mine.kind,
        record: JSON.parse(mine.record),
        record_canonical: mine.record,
        leaf: mine.leaf,
        proof: getProof(tree, mine.leaf),
        root: tree.root,
        root_matches_seal: tree.root === seal.root,
        seal,
        how_to_check:
          "leaf = keccak256(keccak256(abi.encode(uint8 kind, keccak256(subject), uint64 hour, keccak256(record_canonical)))); walk the sorted-pair proof to root; compare with SealRegistry.sealOf(hour).root",
      });
    }
    case "/api/v1/agents": {
      const agents = await agentSummaries(env.DB);
      return json({
        note: "All agents here are paper. Paper fills happen at the next hour's Chainlink close with a 0.5% fee, only while the feed is fresh. Returns are on paper.",
        markets: HOUSE_MARKETS,
        agents,
      });
    }
    case "/api/v1/decisions": {
      const agent = url.searchParams.get("agent") ?? "";
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? 24) || 24, 1), 720);
      const { results } = await env.DB.prepare("SELECT hour, action, record FROM decisions WHERE agent = ? ORDER BY hour DESC LIMIT ?")
        .bind(agent, hours)
        .all<{ hour: number; action: string; record: string }>();
      if (results.length === 0) return json({ error: "no decisions for this agent", see: "/api/v1/agents" }, { status: 404 });
      return json({
        agent,
        decisions: results.map((r) => ({ hour: r.hour, action: r.action, record: JSON.parse(r.record), proof: `/api/v1/proof?hour=${r.hour}&subject=${agent}` })),
      });
    }
    case "/api/v1/status":
      return json(status, { maxAge: 300 });
    case "/version":
      return json({ git_sha: env.GIT_SHA ?? null, repository: "https://github.com/tauroagent/tauro" }, { maxAge: 300 });
    case "/.well-known/tauro.json":
      return json({ token: TOKEN, site: "https://tauroagent.com", x: "https://x.com/Tauro_Agent", repository: "https://github.com/tauroagent/tauro" }, { maxAge: 300 });
    case "/robots.txt":
      return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n", { headers: { "content-type": "text/plain" } });
    default: {
      const ag = url.pathname.match(/^\/agents\/([a-z0-9-]{1,80})$/);
      if (ag) {
        const a = (await agentSummaries(env.DB)).find((x) => x.id === ag[1]);
        if (!a) return html(renderNotFound(), 404);
        const [series, decisions] = await Promise.all([equitySeries(env.DB, a.id, a.market, a.start_cash), recentDecisions(env.DB, 48, a.id)]);
        return html(renderAgent(a, series, decisions));
      }
      const cl = url.pathname.match(/^\/calls\/(call-[0-9a-f]{12})$/);
      if (cl) {
        const row = await getCall(env.DB, cl[1]!);
        if (!row) return html(renderNotFound(), 404);
        return html(renderCall(await callView(env.DB, row, Math.floor(Date.now() / 1000))));
      }
      const mk = url.pathname.match(/^\/markets\/([A-Za-z.]{1,10})$/);
      if (mk) {
        const sym = mk[1]!.toUpperCase();
        if (!MARKETS.some((m) => m.symbol === sym)) return html(renderNotFound(), 404);
        const agents = (await agentSummaries(env.DB)).filter((a) => a.market === sym);
        return html(renderMarket(sym, await closes(env.DB, sym, 168), agents));
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not found", routes: ROUTES }, { status: 404 });
      return html(renderNotFound(), 404);
    }
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (e) {
      return json({ error: "internal error", detail: String(e).slice(0, 200) }, { status: 500, maxAge: 0 });
    }
  },
  async scheduled(_event, env, ctx): Promise<void> {
    const c = client(env.RPC_URL);
    ctx.waitUntil(
      (async () => {
        const ingest = await runIngest(env.DB, c, Math.floor(Date.now() / 1000));
        const agents = [];
        for (const h of ingest.hours) agents.push(await runAgents(env.DB, h, env.GIT_SHA ?? "dev", c));
        const built = await buildPending(env.DB);
        const sent = await sendPending(env, c);
        console.log("hourly", JSON.stringify({ ingest, agents, built, sent }));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
