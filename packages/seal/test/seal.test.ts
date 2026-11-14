import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { keccak256, type Hex } from "viem";
import { buildTree, canonicalize, getProof, hourStart, leafHash, LeafKind, sealTiming, verifyProof, type LeafInput } from "../src/index.js";

const HOUR = 1_763_215_200; // 2025-11-15T14:00:00Z, a whole hour
const decision = (agent: string, action: string, price: number): LeafInput => ({
  kind: LeafKind.Decision,
  subject: agent,
  hour: HOUR,
  record: { agent, action, price, fired: ["entry:rsi(14)<30"], gate: { ok: true, gapBps: 12 } },
});

describe("canonicalize", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 0, y: -0 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":0}}');
  });

  it("gives one encoding regardless of key order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.string(), fc.boolean())), (o) => {
        const reversed = Object.fromEntries(Object.entries(o).reverse());
        return canonicalize(o) === canonicalize(reversed);
      }),
    );
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [10n], [undefined], [() => 1], [{ a: undefined }]])("rejects %s", (v) => {
    expect(() => canonicalize(v)).toThrow();
  });
});

describe("leafHash", () => {
  it("only accepts whole hours", () => {
    expect(() => leafHash({ ...decision("a", "buy", 1), hour: HOUR + 1 })).toThrow();
    expect(() => leafHash({ ...decision("a", "buy", 1), hour: -3600 })).toThrow();
  });

  it("changes when any field changes", () => {
    const base = leafHash(decision("agent-1", "buy", 250.5));
    expect(leafHash(decision("agent-1", "buy", 250.5))).toBe(base);
    expect(leafHash(decision("agent-2", "buy", 250.5))).not.toBe(base);
    expect(leafHash(decision("agent-1", "sell", 250.5))).not.toBe(base);
    expect(leafHash(decision("agent-1", "buy", 250.51))).not.toBe(base);
    expect(leafHash({ ...decision("agent-1", "buy", 250.5), hour: HOUR + 3600 })).not.toBe(base);
    expect(leafHash({ ...decision("agent-1", "buy", 250.5), kind: LeafKind.Fill })).not.toBe(base);
  });
});

describe("merkle tree", () => {
  const leaves = ["a", "b", "c", "d", "e"].map((a, i) => leafHash(decision(a, "hold", 100 + i)));

  it("proves every leaf, for every tree size from 1 to 9", () => {
    for (let n = 1; n <= 9; n++) {
      const ls = Array.from({ length: n }, (_, i) => leafHash(decision(`agent-${i}`, "hold", i)));
      const tree = buildTree(ls);
      for (const l of ls) expect(verifyProof(tree.root, l, getProof(tree, l))).toBe(true);
    }
  });

  it("does not depend on input order and ignores duplicates", () => {
    expect(buildTree([...leaves].reverse()).root).toBe(buildTree(leaves).root);
    expect(buildTree([...leaves, leaves[0]!]).root).toBe(buildTree(leaves).root);
  });

  it("a single leaf is its own root", () => {
    expect(buildTree([leaves[0]!]).root).toBe(leaves[0]);
    expect(getProof(buildTree([leaves[0]!]), leaves[0]!)).toEqual([]);
  });

  it("rejects an empty hour and unknown leaves", () => {
    expect(() => buildTree([])).toThrow();
    expect(() => getProof(buildTree(leaves), keccak256("0x01"))).toThrow();
  });

  it("an edited decision fails its proof", () => {
    const tree = buildTree(leaves);
    const original = decision("c", "hold", 102);
    const proof = getProof(tree, leafHash(original));
    expect(verifyProof(tree.root, leafHash(original), proof)).toBe(true);
    expect(verifyProof(tree.root, leafHash({ ...original, record: { ...(original.record as object), action: "buy" } }), proof)).toBe(false);
  });

  it("a flipped bit in any proof element fails", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 40 }), fc.nat(), fc.nat(), fc.integer({ min: 0, max: 63 }), (n, li, pi, nib) => {
        const ls = Array.from({ length: n }, (_, i) => leafHash(decision(`x${i}`, "hold", i)));
        const tree = buildTree(ls);
        const leaf = ls[li % n]!;
        const proof = getProof(tree, leaf);
        if (proof.length === 0) return true;
        const k = pi % proof.length;
        const p = proof[k]!;
        const pos = 2 + nib;
        const flipped = (p.slice(0, pos) + ((parseInt(p[pos]!, 16) ^ 1).toString(16)) + p.slice(pos + 1)) as Hex;
        const bad = proof.map((x, i) => (i === k ? flipped : x));
        return !verifyProof(tree.root, leaf, bad);
      }),
    );
  });
});

describe("timing", () => {
  it("rounds down to the hour", () => {
    expect(hourStart(HOUR + 1799)).toBe(HOUR);
    expect(hourStart(HOUR)).toBe(HOUR);
  });

  it("is on time only between the hour's close and the next close", () => {
    expect(sealTiming(HOUR, HOUR + 3599)).toBe("too_early");
    expect(sealTiming(HOUR, HOUR + 3600)).toBe("on_time");
    expect(sealTiming(HOUR, HOUR + 7199)).toBe("on_time");
    expect(sealTiming(HOUR, HOUR + 7200)).toBe("late");
  });
});
