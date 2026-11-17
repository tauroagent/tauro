// The "Try to fake a trade" editor on /verify re-serializes the record a visitor edits and checks it
// against the sealed proof. These properties pin down what that page relies on.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildTree, canonicalize, getProof, leafHash, LeafKind, verifyProof, type Json } from "../src/index.js";

const HOUR = 1_763_215_200;
// what the page does with the text in the editor
const browserSerialize = (o: unknown) => canonicalize(JSON.parse(JSON.stringify(o, null, 2)));

const scalar = fc.oneof(fc.integer({ min: -1e9, max: 1e9 }), fc.string({ maxLength: 12 }), fc.boolean(), fc.constant(null));
const record = fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.oneof(scalar, fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), scalar, { maxKeys: 4 })), { minKeys: 1, maxKeys: 8 });

// every path to a scalar inside a record
function paths(o: Json, at: string[] = []): string[][] {
  if (o && typeof o === "object" && !Array.isArray(o)) return Object.entries(o).flatMap(([k, v]) => paths(v as Json, [...at, k]));
  return [at];
}
const edit = (o: Json, path: string[], v: Json): Json => {
  const c = structuredClone(o) as Record<string, Json>;
  let p = c;
  path.slice(0, -1).forEach((k) => (p = p[k] as Record<string, Json>));
  p[path[path.length - 1]!] = v;
  return c;
};

function sealedHour(target: Json) {
  const leaves = Array.from({ length: 20 }, (_, i) => ({ kind: LeafKind.Decision, subject: `agent-${i}`, hour: HOUR, record: i === 7 ? target : { agent: `agent-${i}`, action: "hold" } }));
  const tree = buildTree(leaves.map(leafHash));
  const leaf = leafHash(leaves[7]!);
  return { root: tree.root, proof: getProof(tree, leaf), leaf };
}

describe("try to fake a trade", () => {
  it("an untouched record re-serializes to the sealed bytes", () => {
    fc.assert(fc.property(record, (r) => canonicalize(JSON.parse(JSON.stringify(JSON.parse(canonicalize(r)), null, 2))) === canonicalize(r)));
  });

  it("changing any single value breaks the proof", () => {
    fc.assert(
      fc.property(record, fc.nat(), scalar, (r, pick, value) => {
        const all = paths(r as Json).filter((p) => p.length > 0);
        fc.pre(all.length > 0);
        const path = all[pick % all.length]!;
        const edited = edit(r as Json, path, value);
        fc.pre(canonicalize(edited) !== canonicalize(r)); // the visitor actually changed something
        const { root, proof, leaf } = sealedHour(r as Json);
        const fake = leafHash({ kind: LeafKind.Decision, subject: "agent-7", hour: HOUR, record: JSON.parse(browserSerialize(edited)) });
        return verifyProof(root, leaf, proof) && fake !== leaf && !verifyProof(root, fake, proof);
      }),
      { numRuns: 300 },
    );
  });

  it("the real example from the film: hold → buy", () => {
    const sealed = { action: "hold", agent: "house-dip-hunter-nvda", fill: null, paper: true, position_after: { cash: 1000, qty: 0 } };
    const { root, proof, leaf } = sealedHour(sealed);
    const fake = leafHash({ kind: LeafKind.Decision, subject: "agent-7", hour: HOUR, record: { ...sealed, action: "buy" } });
    expect(verifyProof(root, leaf, proof)).toBe(true);
    expect(verifyProof(root, fake, proof)).toBe(false);
  });
});
