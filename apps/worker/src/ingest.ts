import type { PublicClient } from "viem";
import { feedReader } from "./chain.js";
import { closeBefore, hoursToIngest } from "./rounds.js";
import { MARKETS, type Market } from "./universe.js";

export interface IngestSummary {
  hours: number[];
  ok: number;
  failed: number;
}

const MAX_HOURS_PER_RUN = 6;

async function syncMarkets(db: D1Database): Promise<void> {
  await db.batch(
    MARKETS.map((m) =>
      db
        .prepare("INSERT OR IGNORE INTO markets (symbol, name, token, feed, feed_decimals, heartbeat_sec) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(m.symbol, m.name, m.token, m.feed, m.feedDecimals, m.heartbeatSec),
    ),
  );
}

async function ingestHour(db: D1Database, c: PublicClient, hour: number, now: number): Promise<{ ok: number; failed: number }> {
  await db.prepare("INSERT OR IGNORE INTO ingest_runs (hour, started_at) VALUES (?, ?)").bind(hour, now).run();
  const results = await Promise.all(
    MARKETS.map(async (m: Market) => {
      try {
        return { m, r: await closeBefore(feedReader(c, m.feed), hour + 3600) };
      } catch (e) {
        return { m, r: { status: "read_error" as const, reason: String(e).slice(0, 200) } };
      }
    }),
  );
  const stmts = results.map(({ m, r }) =>
    r.status === "ok"
      ? db
          .prepare("INSERT OR IGNORE INTO price_hourly (symbol, hour, round_id, answer, price, updated_at, status, read_at) VALUES (?, ?, ?, ?, ?, ?, 'ok', ?)")
          .bind(m.symbol, hour, r.round.roundId.toString(), r.round.answer.toString(), Number(r.round.answer) / 10 ** m.feedDecimals, r.round.updatedAt, now)
      : db
          .prepare("INSERT OR IGNORE INTO price_hourly (symbol, hour, status, read_at) VALUES (?, ?, ?, ?)")
          .bind(m.symbol, hour, r.status, now),
  );
  await db.batch(stmts);
  const ok = results.filter((x) => x.r.status === "ok").length;
  const failed = results.length - ok;
  const firstError = results.find((x) => x.r.status !== "ok");
  await db
    .prepare("UPDATE ingest_runs SET finished_at = ?, ok = ?, failed = ?, error = ? WHERE hour = ?")
    .bind(Math.floor(Date.now() / 1000), ok, failed, firstError && "reason" in firstError.r ? `${firstError.m.symbol}: ${firstError.r.reason}` : null, hour)
    .run();
  return { ok, failed };
}

/** Runs from cron. Catches up missed hours (up to 6 per run); hours further back stay missing. */
export async function runIngest(db: D1Database, c: PublicClient, nowSec: number): Promise<IngestSummary> {
  await syncMarkets(db);
  const last = await db.prepare("SELECT MAX(hour) AS h FROM ingest_runs WHERE finished_at IS NOT NULL").first<{ h: number | null }>();
  const hours = hoursToIngest(nowSec, last?.h ?? null, MAX_HOURS_PER_RUN);
  let ok = 0;
  let failed = 0;
  for (const h of hours) {
    const r = await ingestHour(db, c, h, nowSec);
    ok += r.ok;
    failed += r.failed;
  }
  return { hours, ok, failed };
}
