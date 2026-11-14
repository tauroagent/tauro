import status from "../../../status.json";
import { client } from "./chain.js";
import { runIngest } from "./ingest.js";
import { renderHome, type HomeData } from "./page.js";
import { MARKETS, UNIVERSE_SOURCES } from "./universe.js";

export interface Env {
  DB: D1Database;
  RPC_URL?: string;
  GIT_SHA?: string;
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

async function homeData(env: Env): Promise<HomeData> {
  try {
    const closes = await latestCloses(env.DB);
    const runs = await env.DB.prepare("SELECT hour, ok, failed FROM ingest_runs WHERE finished_at IS NOT NULL ORDER BY hour DESC LIMIT 1").first<{
      hour: number;
      ok: number;
      failed: number;
    }>();
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM ingest_runs WHERE finished_at IS NOT NULL").first<{ n: number }>();
    return {
      kind: "ok",
      lastRun: runs ?? null,
      hoursIngested: count?.n ?? 0,
      markets: MARKETS.map((m) => ({ symbol: m.symbol, name: m.name, feed: m.feed, close: closes.get(m.symbol) ?? null })),
      claims: status.claims,
    };
  } catch (e) {
    return { kind: "error", message: String(e).slice(0, 200), claims: status.claims };
  }
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method not allowed" }, { status: 405 });

  switch (url.pathname) {
    case "/":
      return new Response(renderHome(await homeData(env)), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
      });
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
    case "/api/v1/status":
      return json(status, { maxAge: 300 });
    case "/version":
      return json({ git_sha: env.GIT_SHA ?? null, repository: "https://github.com/tauroagent/tauro" }, { maxAge: 300 });
    case "/robots.txt":
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    default:
      return json({ error: "not found", routes: ROUTES }, { status: 404 });
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
    ctx.waitUntil(runIngest(env.DB, client(env.RPC_URL), Math.floor(Date.now() / 1000)).then((s) => console.log("ingest", JSON.stringify(s))));
  },
} satisfies ExportedHandler<Env>;
