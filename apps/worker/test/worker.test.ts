import { describe, expect, it } from "vitest";
import { closeBefore, hoursToIngest, type Round, type RoundReader } from "../src/rounds.js";
import { renderHome } from "../src/page.js";
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

describe("renderHome", () => {
  const claims = [{ id: "a", text: "x <b>", status: "planned" }];
  it("escapes text and shows the empty state", () => {
    const html = renderHome({ kind: "ok", lastRun: null, hoursIngested: 0, markets: [{ symbol: "T", name: "<i>", feed: "0x", close: null }], claims, agents: [] });
    expect(html).toContain("No hour has been ingested yet");
    expect(html).toContain("house agents start at the next full hour");
    expect(html).toContain("x &lt;b&gt;");
    expect(html).not.toContain("<i>");
  });
  it("shows the error state", () => {
    expect(renderHome({ kind: "error", message: "boom", claims })).toContain('role="alert"');
  });
  it("renders closes and contains no em dash", () => {
    const html = renderHome({
      kind: "ok",
      lastRun: { hour: H, ok: 35, failed: 0 },
      hoursIngested: 1,
      markets: [{ symbol: "TSLA", name: "Tesla", feed: "0x", close: { hour: H, price: 387, round_id: "1", updated_at: H + 10 } }],
      claims,
      agents: [{ id: "house-dip-hunter-tsla", template: "dip_hunter", market: "TSLA", qty: 0.5, equity: 1003.2, return_pct: 0.32, hold_return_pct: -1.5, last_action: "hold", decisions: 3 }],
    });
    expect(html).toContain("Dip hunter");
    expect(html).toContain("+0.32%");
    expect(html).toContain("-1.50%");
    expect(html).toContain("Holding");
    expect(html).toContain("387.00");
    expect(html).toContain("35 of 35 feeds read");
    expect(html).not.toContain("—");
  });
});
