import type { PublicClient } from "viem";
import { edgeOf, scoredCalls, type ScoredCall } from "./calls.js";
import { balancesOf, tokens } from "./holders.js";

/**
 * Call Week 1. Calls signed inside the window, on the short horizons, scored like the main board.
 * A call that ends with no price change (stock feeds pause on weekends) is void: neither right nor wrong.
 * Prizes are sent by the team wallet after the final hour; this module only publishes the standings.
 */
export const CONTEST = {
  id: "call-week-1",
  name: "Call Week 1",
  start: 1_795_255_200, // 21 November 2026, 10:00 UTC
  end: 1_795_860_000, // 28 November 2026, 10:00 UTC
  horizons: [1, 4, 24] as readonly number[],
  minCounted: 5,
  holdMin: 100_000,
  prizes: [3_000_000, 2_000_000, 1_000_000],
  /** Team wallets cannot win: seal signer, deployer, live wallet. */
  excluded: [
    "0xa6f3f0702ccc817436983e78250df00b28d4ba17",
    "0x0e28e7ead47d030cb54ed1630f4cf249ddaed928",
    "0x08fe445291ad2372b0c1032c53328f0d91342079",
  ],
} as const;

/** Standings are final once the last counted call (signed before the end, 24 h horizon) has resolved. */
export const finalAt = (): number => CONTEST.end + Math.max(...CONTEST.horizons) * 3600 + 3600;

export const inContest = (c: Pick<ScoredCall, "submitted_at" | "horizon">): boolean =>
  c.submitted_at >= CONTEST.start && c.submitted_at < CONTEST.end && CONTEST.horizons.includes(c.horizon);

export interface Entrant {
  caller: string; calls: number; counted: number; right: number; wrong: number; void: number; open: number;
  hit_rate: number | null; avg_edge_pct: number | null; qualified: boolean;
  balance: number | null; holds: boolean | null; excluded: boolean; eligible: boolean; prize: number | null;
}

export function scoreContest(items: ScoredCall[], balances: Map<string, bigint | null>): Entrant[] {
  const by = new Map<string, ScoredCall[]>();
  for (const it of items.filter(inContest)) by.set(it.caller, [...(by.get(it.caller) ?? []), it]);
  const out: Entrant[] = [];
  for (const [caller, cs] of by) {
    const res = cs.filter((c) => c.o.state === "resolved" && c.o.move_pct !== null);
    const voided = res.filter((c) => c.o.move_pct === 0);
    const counted = res.filter((c) => c.o.move_pct !== 0);
    const right = counted.filter((c) => c.o.right).length;
    const edges = counted.map((c) => edgeOf(c.side, c.o.move_pct!));
    const bal = balances.get(caller);
    const balance = bal === undefined || bal === null ? null : tokens(bal);
    const holds = balance === null ? null : balance >= CONTEST.holdMin;
    const excluded = (CONTEST.excluded as readonly string[]).includes(caller);
    const qualified = counted.length >= CONTEST.minCounted;
    out.push({
      caller, calls: cs.length, counted: counted.length, right, wrong: counted.length - right, void: voided.length,
      open: cs.filter((c) => c.o.state === "open" || c.o.state === "waiting_for_seal").length,
      hit_rate: counted.length ? (right / counted.length) * 100 : null,
      avg_edge_pct: edges.length ? edges.reduce((s, x) => s + x, 0) / edges.length : null,
      qualified, balance, holds, excluded, eligible: qualified && holds === true && !excluded, prize: null,
    });
  }
  const n = (v: number | null) => v ?? -Infinity;
  out.sort((a, b) => Number(b.qualified) - Number(a.qualified) || n(b.hit_rate) - n(a.hit_rate) || n(b.avg_edge_pct) - n(a.avg_edge_pct) || b.counted - a.counted);
  let p = 0;
  for (const e of out) if (e.eligible && p < CONTEST.prizes.length) e.prize = CONTEST.prizes[p++]!;
  return out;
}

export const contestRules = () => ({
  id: CONTEST.id,
  name: CONTEST.name,
  window: `${new Date(CONTEST.start * 1000).toISOString()} to ${new Date(CONTEST.end * 1000).toISOString()}`,
  counts: `Calls signed inside the window with a ${CONTEST.horizons.join(", ")} hour horizon. Longer horizons are sealed as usual but do not count here.`,
  void: "A call that ends with no price change is void and does not count. Stock feeds pause when the market is closed, so a call that starts and ends on a weekend is void.",
  ranking: `Hit rate on counted calls, then average move in the called direction. A wallet needs ${CONTEST.minCounted} counted calls to qualify.`,
  limit: "3 calls per wallet per UTC day, as on the main board.",
  prizes: CONTEST.prizes.map((t, i) => `#${i + 1}: ${t.toLocaleString("en-US")} TAURO`),
  eligibility: `To win a prize a wallet must hold at least ${CONTEST.holdMin.toLocaleString("en-US")} TAURO when the standings are final, read on chain. Anyone can play and appear on the board. Team wallets cannot win.`,
  final: new Date(finalAt() * 1000).toISOString(),
  payout: "Prizes are sent in TAURO from the team wallet after the final hour, and the transfer hashes are added to this page.",
  not_advice: "Paper calls only. No purchase is needed to play. Not investment advice.",
});

export async function contestView(db: D1Database, c: PublicClient, nowSec: number) {
  const items = (await scoredCalls(db, nowSec)).filter(inContest);
  const callers = [...new Set(items.map((i) => i.caller))].slice(0, 300);
  const entrants = scoreContest(items, await balancesOf(c, callers));
  const state = nowSec < CONTEST.start ? "not_started" : nowSec < CONTEST.end ? "open" : nowSec < finalAt() ? "resolving" : "final";
  return { rules: contestRules(), state, now: new Date(nowSec * 1000).toISOString(), calls: items.length, entrants };
}
