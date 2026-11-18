import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, pad, toHex, verifyMessage, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { allocate, burnSlots, DEAD, holdSlots, issuedOk, launchMessage, readBurn, SLOTS, type LaunchRow } from "../src/holders.js";
import { renderToken } from "../src/ui/pages.js";
import { TOKEN } from "../src/token.js";

const M = 10n ** 24n; // one million TAURO in wei
const T0 = SLOTS.burnsCountFrom + 3600;

describe("slots", () => {
  it("counts holding tiers", () => {
    expect(holdSlots(0n)).toBe(0);
    expect(holdSlots(M - 1n)).toBe(0);
    expect(holdSlots(M)).toBe(1);
    expect(holdSlots(5n * M - 1n)).toBe(1);
    expect(holdSlots(5n * M)).toBe(3);
  });
  it("counts only unexpired burn credits", () => {
    expect(burnSlots([{ tx_hash: "a", slots: 2, expires_at: T0 + 10 }, { tx_hash: "b", slots: 5, expires_at: T0 }], T0)).toBe(2);
  });
});

describe("allocate", () => {
  const row = (agent: string, owner: string, requested_at: number, status: LaunchRow["status"] = "queued"): LaunchRow => ({ agent, owner, requested_at, status });
  it("runs the oldest agents first and pauses the rest", () => {
    const rows = [row("b", "0x1", 20, "active"), row("a", "0x1", 10, "active"), row("c", "0x1", 30)];
    const out = allocate(rows, new Map([["0x1", M]]), new Map(), T0);
    expect(out).toEqual([
      { agent: "a", status: "active", reason: null },
      { agent: "b", status: "paused", reason: expect.stringContaining("needs 2 slots") },
      { agent: "c", status: "queued", reason: expect.stringContaining("needs 3 slots") },
    ]);
  });
  it("adds burn slots and ignores retired agents", () => {
    const rows = [row("a", "0x2", 1), row("b", "0x2", 2), row("x", "0x2", 0, "retired")];
    const out = allocate(rows, new Map([["0x2", 0n]]), new Map([["0x2", [{ tx_hash: "t", slots: 2, expires_at: T0 + 1 }]]]), T0);
    expect(out.map((o) => o.status)).toEqual(["active", "active"]);
  });
  it("keeps the last status when a balance read failed", () => {
    const out = allocate([row("a", "0x3", 1, "active")], new Map([["0x3", null]]), new Map(), T0);
    expect(out[0]).toMatchObject({ status: "active", reason: expect.stringContaining("read failed") });
  });
});

describe("launch signatures", () => {
  it("a wallet signature over launchMessage verifies, and any edit breaks it", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const req = { owner: acct.address.toLowerCase(), template: "dip_hunter", market: "NVDA", stopLossPct: 2.5, sizeUsd: 100, issued: "2026-11-18T06:00:00Z" };
    const signature = await acct.signMessage({ message: launchMessage(req) });
    expect(await verifyMessage({ address: acct.address, message: launchMessage(req), signature })).toBe(true);
    expect(await verifyMessage({ address: acct.address, message: launchMessage({ ...req, sizeUsd: 1000 }), signature })).toBe(false);
  });
  it("accepts a fresh Issued time only", () => {
    const now = Date.parse("2026-11-18T06:05:00Z") / 1000;
    expect(issuedOk("2026-11-18T06:00:00Z", now)).toBe(true);
    expect(issuedOk("2026-11-18T05:50:00Z", now)).toBe(false);
    expect(issuedOk("2026-11-18T06:07:00Z", now)).toBe(false);
    expect(issuedOk("yesterday", now)).toBe(false);
  });
});

describe("readBurn", () => {
  const signer = "0x1111111111111111111111111111111111111111";
  const transfer = (from: string, to: string, value: bigint, address: string = TOKEN.address) => ({
    address,
    topics: [keccak256(toHex("Transfer(address,address,uint256)")), pad(from as Hex), pad(to as Hex)] as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  });
  const chain = (logs: ReturnType<typeof transfer>[], time = T0, status: "success" | "reverted" = "success") => ({
    getTransactionReceipt: async () => ({ status, from: signer, blockNumber: 7n, logs }) as never,
    getBlock: async () => ({ timestamp: BigInt(time) }) as never,
  });
  const tx = `0x${"ab".repeat(32)}` as Hex;

  it("credits one slot per full million burned by the signer", async () => {
    const b = await readBurn(chain([transfer(signer, DEAD, 2n * M + 5n), transfer(signer, "0x2222222222222222222222222222222222222222", 9n * M)]), tx);
    expect(b).toMatchObject({ owner: signer, amount: 2n * M + 5n, slots: 2, expires_at: T0 + 30 * 86_400 });
  });
  it("rejects other tokens, other senders, small or early burns, failed txs", async () => {
    await expect(readBurn(chain([transfer(signer, DEAD, M, "0x3333333333333333333333333333333333333333")]), tx)).rejects.toThrow("no TAURO");
    await expect(readBurn(chain([transfer("0x4444444444444444444444444444444444444444", DEAD, M)]), tx)).rejects.toThrow("no TAURO");
    await expect(readBurn(chain([transfer(signer, DEAD, M - 1n)]), tx)).rejects.toThrow("at least");
    await expect(readBurn(chain([transfer(signer, DEAD, M)], SLOTS.burnsCountFrom - 1), tx)).rejects.toThrow("do not count");
    await expect(readBurn(chain([transfer(signer, DEAD, M)], T0, "reverted"), tx)).rejects.toThrow("failed");
  });
});

describe("token page", () => {
  it("renders the rules and the burn list", () => {
    const html = renderToken({
      address: TOKEN.address, hold: [{ min_tauro: 1_000_000, slots: 1 }, { min_tauro: 5_000_000, slots: 3 }], burn: { per_slot_tauro: 1_000_000, slot_days: 30 },
      totalBurned: 2_000_000, holderAgents: 1,
      burns: [{ tx_hash: `0x${"cd".repeat(32)}`, owner: "0x1111111111111111111111111111111111111111", tauro: 2_000_000, slots: 2, block_time: "2026-11-18T07:00:00.000Z", expires_at: "2026-12-18T07:00:00.000Z" }],
    });
    expect(html).toContain("1,000,000");
    expect(html).toContain("2,000,000 TAURO in total");
    expect(html).toContain("pays nothing");
    expect(html).not.toMatch(/yield|profit|APY/i);
  });
});
