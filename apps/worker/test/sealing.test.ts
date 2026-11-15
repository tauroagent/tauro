import { describe, expect, it } from "vitest";
import { getProof, leafHash, LeafKind, verifyProof } from "@tauro/seal";
import { keccak256, stringToBytes, type Hex } from "viem";
import { buildHour, decideSeal, type PriceRow } from "../src/sealing.js";

const H = 1_794_690_000;
const feeds = new Map([
  ["TSLA", "0x4A1166a659A55625345e9515b32adECea5547C38"],
  ["AAPL", "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0"],
]);
const rows: PriceRow[] = [
  { symbol: "TSLA", hour: H, round_id: "18446744073709553761", answer: "38705000000", updated_at: 1_794_613_088, status: "ok" },
  { symbol: "AAPL", hour: H, round_id: null, answer: null, updated_at: null, status: "read_error" },
];
const status = { claims: [{ id: "x", status: "live" }] };

describe("buildHour", () => {
  it("makes one leaf per market plus one for status.json, and is deterministic", () => {
    const a = buildHour(H, rows, feeds, status);
    expect(a.leaves.map((l) => l.subject)).toEqual(["TSLA", "AAPL", "status.json"]);
    expect(buildHour(H, [...rows].reverse(), feeds, status).root).toBe(a.root);
  });

  it("each stored record rebuilds its leaf and proves against the root", () => {
    const { leaves, root, tree } = buildHour(H, rows, feeds, status);
    for (const l of leaves) {
      const rebuilt = leafHash({ kind: l.kind as LeafKind, subject: l.subject, hour: H, record: JSON.parse(l.record) });
      expect(rebuilt).toBe(l.leaf);
      expect(verifyProof(root, l.leaf, getProof(tree, l.leaf))).toBe(true);
    }
  });

  it("matches the documented leaf formula byte for byte", () => {
    const { leaves } = buildHour(H, rows, feeds, status);
    const tsla = leaves[0]!;
    expect(tsla.record).toBe(
      '{"answer":"38705000000","feed":"0x4A1166a659A55625345e9515b32adECea5547C38","hour":1794690000,"round_id":"18446744073709553761","status":"ok","symbol":"TSLA","updated_at":1794613088}',
    );
    expect(keccak256(stringToBytes(tsla.record))).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tsla.kind).toBe(LeafKind.Price);
  });

  it("seals failed reads too, and any change moves the root", () => {
    const base = buildHour(H, rows, feeds, status).root;
    const edited = rows.map((r) => (r.symbol === "TSLA" ? { ...r, answer: "38705000001" } : r));
    expect(buildHour(H, edited, feeds, status).root).not.toBe(base);
    expect(buildHour(H, rows, feeds, { claims: [] }).root).not.toBe(base);
  });
});

describe("decideSeal", () => {
  const root = ("0x" + "11".repeat(32)) as Hex;
  const zero = ("0x" + "00".repeat(32)) as Hex;
  it("sends the first seal with a zero prevRoot", () => {
    expect(decideSeal(H, root, { lastHour: 0, lastRoot: zero, sealCount: 0, rootAtHour: zero }, H + 3700)).toEqual({ action: "send", prevRoot: zero });
  });
  it("chains to the registry's last root", () => {
    const last = ("0x" + "22".repeat(32)) as Hex;
    expect(decideSeal(H, root, { lastHour: H - 3600, lastRoot: last, sealCount: 4, rootAtHour: zero }, H + 3700)).toEqual({ action: "send", prevRoot: last });
  });
  it("recognises a root already on chain", () => {
    expect(decideSeal(H, root, { lastHour: H, lastRoot: root, sealCount: 1, rootAtHour: root }, H + 9999).action).toBe("already");
  });
  it("marks an hour missed once the registry has moved past it", () => {
    expect(decideSeal(H, root, { lastHour: H + 3600, lastRoot: zero, sealCount: 2, rootAtHour: zero }, H + 3700).action).toBe("missed");
  });
  it("never sends after the deadline", () => {
    const c = { lastHour: H - 3600, lastRoot: zero, sealCount: 1, rootAtHour: zero };
    expect(decideSeal(H, root, c, H + 7199).action).toBe("send");
    expect(decideSeal(H, root, c, H + 7200)).toEqual({ action: "missed", reason: "deadline passed before the seal was sent" });
  });
});
