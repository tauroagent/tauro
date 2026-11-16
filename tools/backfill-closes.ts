// One-off history fill: hourly Chainlink closes for the last N days, read on chain round by round.
// Writes SQL to stdout. Rows are marked status 'backfill' so they are never confused with closes
// read live at the hour, and INSERT OR IGNORE never touches an existing row.
//   npx tsx tools/backfill-closes.ts --days 7 > backfill.sql
//   npx wrangler d1 execute tauro --remote --file backfill.sql
import { client, feedReader } from "../apps/worker/src/chain.js";
import type { Round } from "../apps/worker/src/rounds.js";
import { MARKETS } from "../apps/worker/src/universe.js";

const days = Number(process.argv[process.argv.indexOf("--days") + 1] ?? 7) || 7;
const now = Math.floor(Date.now() / 1000);
const lastClosed = now - (now % 3600) - 3600;
const from = lastClosed - days * 24 * 3600;
const c = client();
const readAt = now;
const lines: string[] = [];

for (const m of MARKETS) {
  const read = feedReader(c, m.feed);
  const [latest] = await read(["latest"]);
  if (!latest) {
    console.error(`${m.symbol}: latestRoundData failed`);
    continue;
  }
  // Walk back until a round older than the window start, in batches of 20 ids.
  const rounds: Round[] = [latest];
  let next = latest.roundId - 1n;
  while (rounds[rounds.length - 1]!.updatedAt >= from && (next & ((1n << 64n) - 1n)) > 0n) {
    const ids = Array.from({ length: 20 }, (_, i) => next - BigInt(i)).filter((id) => (id & ((1n << 64n) - 1n)) > 0n);
    const got = await read(ids);
    let stop = false;
    for (const r of got) {
      if (!r || r.updatedAt === 0) { stop = true; break; }
      rounds.push(r);
      if (r.updatedAt < from) { stop = true; break; }
    }
    next -= BigInt(ids.length);
    if (stop) break;
  }
  rounds.sort((a, b) => a.updatedAt - b.updatedAt);
  let n = 0;
  for (let h = from; h <= lastClosed; h += 3600) {
    const end = h + 3600;
    let r: Round | undefined;
    for (const x of rounds) if (x.updatedAt < end) r = x; else break;
    if (!r || r.answer <= 0n) continue;
    lines.push(
      `INSERT OR IGNORE INTO price_hourly (symbol, hour, round_id, answer, price, updated_at, status, read_at) VALUES ('${m.symbol}', ${h}, '${r.roundId}', '${r.answer}', ${Number(r.answer) / 10 ** m.feedDecimals}, ${r.updatedAt}, 'backfill', ${readAt});`,
    );
    n++;
  }
  console.error(`${m.symbol}: ${rounds.length} rounds, ${n} hours`);
}
console.log(lines.join("\n"));
