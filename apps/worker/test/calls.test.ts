import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { callIdFor, callMessage, callRecord, cleanNote, edgeOf, outcome, scoreCallers, sealHourFor, validateCall, type ScoredCall } from "../src/calls.js";

const acct = privateKeyToAccount(generatePrivateKey());
const NOW = 1_795_100_000;
const issued = new Date((NOW - 30) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const req = { caller: acct.address.toLowerCase(), market: "NVDA", side: "up" as const, horizon: 24, note: "earnings drift", issued };

describe("sealed calls", () => {
  it("builds the exact signed text and verifies a real signature", async () => {
    const message = callMessage(req);
    expect(message.split("\n")).toEqual([
      "Tauro: seal my call", `Caller: ${req.caller}`, "Market: NVDA", "Call: up", "Within: 24 hours", "Note: earnings drift", `Issued: ${issued}`,
      "Paper only. This signature sends no transaction and costs nothing.",
    ]);
    const signature = await acct.signMessage({ message });
    expect(await verifyMessage({ address: acct.address, message, signature })).toBe(true);
    expect(await verifyMessage({ address: acct.address, message: callMessage({ ...req, side: "down" }), signature })).toBe(false);
  });

  it("rejects bad fields and stale signatures", () => {
    const sig = "0x" + "11".repeat(65);
    expect(validateCall({ ...req, signature: sig }, NOW)).toBeNull();
    expect(validateCall({ ...req, market: "XYZ", signature: sig }, NOW)).toMatch(/market/);
    expect(validateCall({ ...req, side: "sideways" as never, signature: sig }, NOW)).toMatch(/up or down/);
    expect(validateCall({ ...req, horizon: 5, signature: sig }, NOW)).toMatch(/horizon/);
    expect(validateCall({ ...req, note: "a\nb", signature: sig }, NOW)).toMatch(/one line/);
    expect(validateCall({ ...req, note: "x".repeat(141), signature: sig }, NOW)).toMatch(/140/);
    expect(validateCall({ ...req, signature: sig }, NOW + 3600)).toMatch(/too old/);
    expect(validateCall({ ...req }, NOW)).toMatch(/signature/);
    expect(cleanNote("  two   spaces\tand tab ")).toBe("two spaces and tab");
  });

  it("seals in the next hour, never the current one", () => {
    expect(sealHourFor(1_795_100_000)).toBe(1_795_100_000 - (1_795_100_000 % 3600) + 3600);
    expect(sealHourFor(1_795_100_400 - 1)).toBe(1_795_100_400 - 1 - ((1_795_100_400 - 1) % 3600) + 3600);
  });

  it("scores from the sealed entry close and the close at the horizon", () => {
    const c = { side: "up" as const, hour: 1_795_100_400, horizon: 24 };
    const end = c.hour + 24 * 3600;
    expect(outcome(c, 100, null, end, false).state).toBe("waiting_for_seal");
    expect(outcome(c, 100, 105, end - 1, true).state).toBe("open");
    expect(outcome(c, 100, 105, end, true)).toMatchObject({ state: "resolved", right: true });
    expect(outcome({ ...c, side: "down" }, 100, 105, end, true)).toMatchObject({ state: "resolved", right: false });
    expect(outcome(c, 100, 100, end, true).right).toBe(false); // flat is not up
  });

  it("gives stable ids and a canonical record that includes the signature", () => {
    const id = callIdFor(req.caller, issued, "0xAB");
    expect(id).toMatch(/^call-[0-9a-f]{12}$/);
    expect(callIdFor(req.caller.toUpperCase(), issued, "0xab")).toBe(id);
    const rec = callRecord({ id, ...req, message: "m", signature: "0xab", submitted_at: NOW, hour: 1 });
    expect(JSON.parse(rec)).toMatchObject({ call: id, market: "NVDA", side: "up", horizon_hours: 24, signature: "0xab", paper: true });
  });

  it("ranks callers by hit rate after 3 resolved calls and keeps misses", () => {
    const res = (caller: string, id: string, side: "up" | "down", move: number): ScoredCall => ({ id, caller, market: "NVDA", side, horizon: 1, submitted_at: NOW,
      o: outcome({ side, hour: NOW - 7200, horizon: 1 }, 100, 100 * (1 + move / 100), NOW, true) });
    const open: ScoredCall = { ...res("0xb", "b4", "up", 1), o: outcome({ side: "up", hour: NOW, horizon: 24 }, 100, null, NOW, true) };
    const board = scoreCallers([
      res("0xa", "a1", "up", 2), res("0xa", "a2", "down", 1), res("0xa", "a3", "down", -3),
      res("0xb", "b1", "up", 1), res("0xb", "b2", "up", 1), res("0xb", "b3", "down", -1), open,
      res("0xc", "c1", "up", 9),
    ]);
    expect(board.map((c) => c.caller)).toEqual(["0xb", "0xa", "0xc"]);
    const [b, a, c] = board;
    expect(b).toMatchObject({ ranked: true, right: 3, resolved: 3, open: 1, hit_rate: 100 });
    expect(a).toMatchObject({ ranked: true, right: 2, wrong: 1, resolved: 3 });
    expect(a!.hit_rate).toBeCloseTo(66.67, 1);
    expect(a!.avg_edge_pct).toBeCloseTo((2 - 1 + 3) / 3, 6);
    expect(a!.best).toMatchObject({ id: "a3", side: "down" });
    expect(c).toMatchObject({ ranked: false, right: 1, hit_rate: 100 });
    expect(edgeOf("down", -2)).toBe(2);
  });
});
