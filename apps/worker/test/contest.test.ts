import { describe, expect, it } from "vitest";
import { CONTEST, inContest, scoreContest } from "../src/contest.js";
import type { ScoredCall } from "../src/calls.js";

const T = CONTEST.start + 600;
const E = 10n ** 18n;
const call = (caller: string, move: number | null, horizon = 24, at = T): ScoredCall => ({
  id: `c${Math.random()}`, caller, market: "NVDA", side: "up", horizon, submitted_at: at,
  o: move === null ? { state: "open", entry: 1, exit: null, move_pct: null, right: null, resolves_at: 0 } : { state: "resolved", entry: 1, exit: 1, move_pct: move, right: move > 0, resolves_at: 0 },
});

describe("Call Week", () => {
  it("counts only short calls signed inside the window", () => {
    expect(inContest(call("a", 1))).toBe(true);
    expect(inContest(call("a", 1, 72))).toBe(false);
    expect(inContest(call("a", 1, 24, CONTEST.start - 1))).toBe(false);
    expect(inContest(call("a", 1, 24, CONTEST.end))).toBe(false);
  });

  it("voids flat results, needs 5 counted calls, and pays only holders outside the team", () => {
    const a = "0x" + "a".repeat(40), b = "0x" + "b".repeat(40), c = "0x" + "c".repeat(40), team = CONTEST.excluded[2];
    const items = [
      ...[1, 1, 1, 1, -1, 0, 0].map((m) => call(a, m)), // 4 of 5 counted, 2 void
      ...[1, 1, 1, 1, 1].map((m) => call(b, m)), // 5 of 5, holds too little
      ...[1, 1, 1, -1, -1].map((m) => call(c, m)), // 3 of 5
      ...[1, 1, 1, 1, 1].map((m) => call(team, m)),
      call(a, null),
    ];
    const bal = new Map<string, bigint | null>([[a, 100_000n * E], [b, 99_999n * E], [c, 2_000_000n * E], [team, 10n ** 30n]]);
    const out = scoreContest(items, bal);
    const by = Object.fromEntries(out.map((e) => [e.caller, e]));
    expect(by[a]).toMatchObject({ counted: 5, right: 4, void: 2, open: 1, qualified: true, eligible: true });
    expect(by[b]).toMatchObject({ hit_rate: 100, holds: false, eligible: false, prize: null });
    expect(by[team]).toMatchObject({ excluded: true, eligible: false, prize: null });
    expect(by[a]!.prize).toBe(3_000_000);
    expect(by[c]!.prize).toBe(2_000_000);
  });
});
