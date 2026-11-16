import { describe, expect, it } from "vitest";
import { closeBefore, hoursToIngest, type Round, type RoundReader } from "../src/rounds.js";
import { renderHome, type HomeModel } from "../src/ui/home.js";
import { renderAgents, renderNotFound, renderStudio, renderVerify } from "../src/ui/pages.js";
import universe from "../src/universe.json";

const H = 1_763_215_200;
const PHASE = 1n << 64n;

/** A fake feed: rounds keyed by id, `latest` is the highest id. */
function feed(rounds: Round[]): RoundReader & { calls: number } {
  const byId = new Map(rounds.map((r) => [r.roundId, r]));
  const latest = rounds.reduce((a, b) => (b.roundId > a.roundId ? b : a));
  const fn = (async (ids) => {
    fn.calls++;
    return ids.map((id) => (id === "latest" ? latest : (byId.get(id) ?? null)));
  }) as RoundReader & { calls: number };
  fn.calls = 0;
  return fn;
}
const round = (n: number, updatedAt: number, answer = 100n): Round => ({ roundId: PHASE + BigInt(n), answer, updatedAt });

describe("closeBefore", () => {
  it("uses latest when it was updated before the hour ended", async () => {
    const f = feed([round(1, H - 10), round(2, H + 100)]);
    expect(await closeBefore(f, H + 3600)).toEqual({ status: "ok", round: round(2, H + 100) });
    expect(f.calls).toBe(1);
  });

  it("walks back past rounds updated after the hour", async () => {
    const f = feed([round(5, H + 3500, 7n), round(6, H + 3600), round(7, H + 5000)]);
    expect(await closeBefore(f, H + 3600)).toEqual({ status: "ok", round: round(5, H + 3500, 7n) });
  });

  it("gives up after maxSteps rounds", async () => {
    const f = feed(Array.from({ length: 10 }, (_, i) => round(i + 1, H + 3600 + i)));
    expect(await closeBefore(f, H + 3600, 3)).toMatchObject({ status: "no_round" });
  });

  it("stops at the start of a phase", async () => {
    expect(await closeBefore(feed([round(1, H + 4000)]), H + 3600)).toMatchObject({ status: "no_round", reason: expect.stringContaining("phase") });
  });

  it("reports unreadable rounds and failed latest reads", async () => {
    expect(await closeBefore(feed([round(3, H + 4000)]), H + 3600)).toMatchObject({ status: "no_round" });
    expect(await closeBefore(async () => [null], H + 3600)).toMatchObject({ status: "no_round", reason: "latestRoundData failed" });
  });

  it("rejects a non-positive answer", async () => {
    expect(await closeBefore(feed([round(2, H, 0n)]), H + 3600)).toMatchObject({ status: "no_round", reason: "non-positive answer" });
  });
});

describe("hoursToIngest", () => {
  const now = H + 2 * 3600 + 60; // one minute into hour H+2, so H+1 is the last closed hour
  it("starts with the last closed hour on a fresh database", () => {
    expect(hoursToIngest(now, null, 6)).toEqual([H + 3600]);
  });
  it("catches up the gap, oldest first", () => {
    expect(hoursToIngest(now, H - 3600, 6)).toEqual([H, H + 3600]);
  });
  it("does nothing when up to date", () => {
    expect(hoursToIngest(now, H + 3600, 6)).toEqual([]);
  });
  it("caps a long gap to the most recent hours", () => {
    expect(hoursToIngest(now, H - 100 * 3600, 3)).toEqual([H - 3600, H, H + 3600]);
  });
});

describe("universe", () => {
  it("lists each market once, with checksummed-looking addresses", () => {
    const syms = universe.markets.map((m) => m.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    for (const m of universe.markets) {
      expect(m.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(m.feed).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

describe("pages", () => {
  const claims = [{ id: "a", text: "x <b>", status: "planned" }];
  const empty: HomeModel = {
    now: H,
    stats: { markets: 35, agents: 0, decisions: 0, sealedOnTime: 0, sealsSinceFirst: 0, missedSinceFirst: 0, firstSealHour: null, lastSeal: null, lastIngest: null },
    agents: [], decisions: [], markets: [], featuredSeries: [], claims,
  };
  const agent = {
    id: "house-dip-hunter-tsla", template: "dip_hunter", market: "TSLA", paper: true, config_hash: "0xabc", created_hour: H, start_cash: 1000, start_price: 380,
    rules: {}, cash: 900, qty: 0.25, entry_price: 400, pending: null, last_hour: H, price: 412, equity: 1003.2, return_pct: 0.32, hold_return_pct: -1.5,
    vs_hold_pts: 1.82, last_action: "hold", decisions: 3, trades: 1,
  };
  const seal = { hour: H, root: "0x" + "ab".repeat(32), leaf_count: 56, status: "confirmed", tx_hash: "0x" + "cd".repeat(32), block_number: 1, block_time: H + 3700, timing: "on_time" };

  it("home renders empty states and escapes text", () => {
    const html = renderHome(empty);
    expect(html).toContain("first decision at the top of the next hour");
    expect(html).toContain("x &lt;b&gt;");
    expect(html).not.toContain("x <b>");
    expect(html).not.toContain("\u2014");
  });

  it("home renders the agent card, seal receipt, feed and leaderboard", () => {
    const html = renderHome({
      ...empty,
      stats: { ...empty.stats, agents: 20, decisions: 40, sealedOnTime: 12, sealsSinceFirst: 12, firstSealHour: H, lastSeal: seal, lastIngest: { hour: H, ok: 35, failed: 0 } },
      agents: [agent],
      decisions: [{ agent: agent.id, template: "dip_hunter", market: "TSLA", hour: H, action: "buy", record: { fired: ["entry:rsi(14)<30"], values: {} } }],
      featuredSeries: [1, 2, 3],
      markets: [{ symbol: "TSLA", name: "Tesla", price: 412, change24: 1.2, series: [1, 2], updatedAt: H }],
    });
    expect(html).toContain("Dip hunter · TSLA");
    expect(html).toContain("+0.32%");
    expect(html).toContain("+1.82 pts");
    expect(html).toContain("56");
    expect(html).toContain("Buy signal: rsi(14)&lt;30");
    expect(html).toContain("12<span");
    expect(html).toContain("/verify?hour=");
  });

  it("inner pages render with a single h1 and no em dash", () => {
    for (const html of [renderAgents([agent]), renderAgents([]), renderVerify(), renderStudio(), renderNotFound()]) {
      expect(html.match(/<h1/g)?.length).toBe(1);
      expect(html).not.toContain("\u2014");
    }
  });
});
