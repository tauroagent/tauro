import { describe, expect, it } from "vitest";
import { TEMPLATES, type Rules } from "@tauro/engine";
import { getProof, LeafKind, verifyProof } from "@tauro/seal";
import { equity, feedCheck, stepAgent, type AgentState } from "../src/paper.js";
import { houseAgents } from "../src/agents.js";
import { buildHour } from "../src/sealing.js";

const H = 1_794_690_000;
const momentum: Rules = { ...structuredClone(TEMPLATES.momentum!), market: "TSLA" };
const rising = (n: number, end = H) => Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * 3600, close: 100 + i }));
const flat: AgentState = { cash: 1000, qty: 0, entryPrice: null, openedAt: null, pending: null };
const fresh = { ok: true, reason: "ok", feedAgeSec: 60 };

describe("stepAgent", () => {
  it("decides buy at H and fills at the close of H+1, with the fee", () => {
    const s1 = stepAgent(momentum, flat, rising(30), H, fresh);
    expect(s1.decision.action).toBe("buy");
    expect(s1.fill).toBeNull();
    expect(s1.state.pending).toEqual({ action: "buy", sizeUsd: 100, decidedHour: H });

    const s2 = stepAgent(momentum, s1.state, rising(31, H + 3600), H + 3600, fresh);
    expect(s2.fill).toMatchObject({ status: "filled", side: "buy", price: 130, usd: 100, feeUsd: 0.5 });
    expect(s2.state.cash).toBe(900);
    expect(s2.state.qty).toBeCloseTo(99.5 / 130, 12);
    expect(s2.state.entryPrice).toBe(130);
  });

  it("holds an order while the feed is stale, then drops it", () => {
    const s1 = stepAgent(momentum, flat, rising(30), H, fresh);
    const s2 = stepAgent(momentum, s1.state, rising(31, H + 3600), H + 3600, { ok: false, reason: "stale_feed", feedAgeSec: 99_999 });
    expect(s2.fill).toEqual({ status: "held", side: "buy", reason: "stale_feed" });
    expect(s2.state.qty).toBe(0);
    expect(s2.state.cash).toBe(1000);
  });

  it("expires an order that is more than one hour old", () => {
    const old: AgentState = { ...flat, pending: { action: "buy", sizeUsd: 100, decidedHour: H - 7200 } };
    expect(stepAgent(momentum, old, rising(30), H, fresh).fill).toMatchObject({ status: "expired" });
  });

  it("sells the whole position on a stop loss and books the fee", () => {
    const holding: AgentState = { cash: 900, qty: 1, entryPrice: 100, openedAt: H - 7200, pending: null };
    const down = [...rising(29, H - 3600), { t: H, close: 90 }];
    const s1 = stepAgent(momentum, holding, down, H, fresh);
    expect(s1.decision.fired).toEqual(["stop_loss"]);
    const s2 = stepAgent(momentum, s1.state, [...down, { t: H + 3600, close: 88 }], H + 3600, fresh);
    expect(s2.fill).toMatchObject({ status: "filled", side: "sell", price: 88, usd: 88, feeUsd: 0.44 });
    expect(s2.state).toMatchObject({ qty: 0, entryPrice: null, cash: 900 + 88 - 0.44 });
  });

  it("expires an order with nothing to act on", () => {
    const s: AgentState = { ...flat, pending: { action: "sell", sizeUsd: 0, decidedHour: H - 3600 } };
    expect(stepAgent(momentum, s, rising(30), H, fresh).fill).toMatchObject({ status: "expired", reason: "nothing to do for this order" });
  });

  it("refuses candles that do not end at the stepped hour", () => {
    expect(() => stepAgent(momentum, flat, rising(5, H - 3600), H, fresh)).toThrow();
  });

  it("values the book at the close", () => {
    expect(equity({ ...flat, cash: 900, qty: 2 }, 50)).toBe(1000);
  });
});

describe("feedCheck", () => {
  it("is fresh within heartbeat plus slack, stale beyond, and missing without a round", () => {
    expect(feedCheck(H, H + 3000, 86_400).ok).toBe(true);
    expect(feedCheck(H, H + 3600 - 86_400 - 3600, 86_400)).toMatchObject({ ok: true });
    expect(feedCheck(H, H + 3600 - 86_400 - 3601, 86_400)).toMatchObject({ ok: false, reason: "stale_feed" });
    expect(feedCheck(H, null, 86_400)).toEqual({ ok: false, reason: "no_close", feedAgeSec: null });
  });
});

describe("house agents", () => {
  it("are 20 valid, uniquely named paper configurations", () => {
    const a = houseAgents();
    expect(a).toHaveLength(20);
    expect(new Set(a.map((x) => x.id)).size).toBe(20);
    expect(a[0]!.id).toBe("house-momentum-spy");
  });

  it("decision and config leaves prove against the hour's root", () => {
    const extra = [
      { kind: LeafKind.Decision, subject: "house-momentum-tsla", record: '{"action":"hold","agent":"house-momentum-tsla","values":{"close":385.516115}}' },
      { kind: LeafKind.AgentConfig, subject: "house-momentum-tsla", record: '{"agent":"house-momentum-tsla","config_hash":"0x01"}' },
    ];
    const { leaves, root, tree } = buildHour(H, [], new Map(), {}, extra);
    expect(leaves.map((l) => l.kind)).toEqual([LeafKind.Decision, LeafKind.AgentConfig, LeafKind.Status]);
    expect(leaves[0]!.record).toBe(extra[0]!.record);
    for (const l of leaves) expect(verifyProof(root, l.leaf, getProof(tree, l.leaf))).toBe(true);
  });
});
