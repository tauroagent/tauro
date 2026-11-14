import { concat, encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { canonicalize } from "./canonical.js";

/** What a leaf commits to. The numbers are part of the leaf encoding and never change meaning. */
export const LeafKind = {
  Decision: 1,
  AgentConfig: 2,
  Status: 3,
  Prereg: 4,
  Fill: 5,
} as const;
export type LeafKind = (typeof LeafKind)[keyof typeof LeafKind];

export interface LeafInput {
  kind: LeafKind;
  /** Agent id, file path or other subject, hashed into bytes32. */
  subject: string;
  /** Unix seconds at the start of the sealed hour. */
  hour: number;
  /** The public record. Its canonical JSON is hashed into the leaf. */
  record: unknown;
}

export const payloadHash = (record: unknown): Hex => keccak256(stringToBytes(canonicalize(record)));
export const subjectHash = (subject: string): Hex => keccak256(stringToBytes(subject));

/**
 * leaf = keccak256(keccak256(abi.encode(uint8 kind, bytes32 subject, uint64 hour, bytes32 payload)))
 * The double hash matches OpenZeppelin's StandardMerkleTree, so a leaf can never pass as an inner node.
 */
export function leafHash(l: LeafInput): Hex {
  if (!Number.isInteger(l.hour) || l.hour < 0 || l.hour % 3600 !== 0) throw new Error("hour must be a whole UTC hour in unix seconds");
  const encoded = encodeAbiParameters(
    [{ type: "uint8" }, { type: "bytes32" }, { type: "uint64" }, { type: "bytes32" }],
    [l.kind, subjectHash(l.subject), BigInt(l.hour), payloadHash(l.record)],
  );
  return keccak256(keccak256(encoded));
}

const hashPair = (a: Hex, b: Hex): Hex => (BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

export interface Tree {
  root: Hex;
  /** Leaves in tree order (sorted by hash, duplicates removed). */
  leaves: Hex[];
  layers: Hex[][];
}

/** Sorted-pair Merkle tree. An odd node at the end of a layer moves up unchanged. */
export function buildTree(leafHashes: readonly Hex[]): Tree {
  if (leafHashes.length === 0) throw new Error("a sealed hour needs at least one leaf");
  const leaves = [...new Set(leafHashes.map((h) => h.toLowerCase() as Hex))].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const layers: Hex[][] = [leaves];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i]!, prev[i + 1]!) : prev[i]!);
    layers.push(next);
  }
  return { root: layers[layers.length - 1]![0]!, leaves, layers };
}

export function getProof(tree: Tree, leaf: Hex): Hex[] {
  let index = tree.leaves.indexOf(leaf.toLowerCase() as Hex);
  if (index < 0) throw new Error("leaf is not in this tree");
  const proof: Hex[] = [];
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level]!;
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < layer.length) proof.push(layer[sibling]!);
    index = Math.floor(index / 2);
  }
  return proof;
}

/** Same algorithm as OpenZeppelin MerkleProof.verify. */
export function verifyProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  let h = leaf.toLowerCase() as Hex;
  for (const p of proof) h = hashPair(h, p.toLowerCase() as Hex);
  return h === root.toLowerCase();
}
