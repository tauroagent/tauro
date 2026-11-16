import { buildTree, canonicalize, leafHash, LeafKind, payloadHash, sealDeadline, sealTiming } from "@tauro/seal";
import type { Hex } from "viem";

export interface PriceRow {
  symbol: string;
  hour: number;
  round_id: string | null;
  answer: string | null;
  updated_at: number | null;
  status: string;
}

export interface BuiltLeaf {
  leaf: Hex;
  kind: number;
  subject: string;
  /** Canonical JSON. keccak256 of this string is the payload inside the leaf. */
  record: string;
}

/**
 * Leaves for one hour: one per market close (failed reads included, so a gap is sealed as a gap),
 * one per agent decision and per agent created this hour (`extra`), plus one for the hash of status.json, which timestamps every change to the public claims.
 * Pure: the same rows and status give the same root.
 */
export interface ExtraLeaf {
  kind: number;
  subject: string;
  /** Canonical JSON as stored; it is parsed and re-canonicalized, which gives the same string. */
  record: string;
}

export function buildHour(hour: number, rows: readonly PriceRow[], feeds: ReadonlyMap<string, string>, status: unknown, extra: readonly ExtraLeaf[] = []) {
  const leaves: BuiltLeaf[] = rows.map((r) => {
    const record = {
      symbol: r.symbol,
      hour,
      feed: feeds.get(r.symbol) ?? null,
      status: r.status,
      round_id: r.round_id,
      answer: r.answer,
      updated_at: r.updated_at,
    };
    return { leaf: leafHash({ kind: LeafKind.Price, subject: r.symbol, hour, record }), kind: LeafKind.Price, subject: r.symbol, record: canonicalize(record) };
  });
  for (const e of extra) {
    const record = JSON.parse(e.record) as unknown;
    leaves.push({ leaf: leafHash({ kind: e.kind as LeafKind, subject: e.subject, hour, record }), kind: e.kind, subject: e.subject, record: canonicalize(record) });
  }
  const statusRecord = { status_json_keccak256: payloadHash(status) };
  leaves.push({
    leaf: leafHash({ kind: LeafKind.Status, subject: "status.json", hour, record: statusRecord }),
    kind: LeafKind.Status,
    subject: "status.json",
    record: canonicalize(statusRecord),
  });
  const tree = buildTree(leaves.map((l) => l.leaf));
  return { leaves, root: tree.root, tree };
}

export type SealDecision =
  | { action: "send"; prevRoot: Hex }
  | { action: "missed"; reason: string }
  | { action: "already"; reason: string };

/**
 * What to do with a built hour, given the registry's current state and the time.
 * We never send a late seal: once the deadline (close of the following hour) has passed,
 * the hour is recorded as missed, with the reason, and stays missed.
 */
export function decideSeal(
  hour: number,
  root: Hex,
  chain: { lastHour: number; lastRoot: Hex; sealCount: number; rootAtHour: Hex },
  nowSec: number,
): SealDecision {
  if (chain.rootAtHour.toLowerCase() === root.toLowerCase()) return { action: "already", reason: "root already on chain" };
  if (chain.sealCount > 0 && hour <= chain.lastHour) return { action: "missed", reason: `registry is already at hour ${chain.lastHour}` };
  if (nowSec >= sealDeadline(hour)) return { action: "missed", reason: "deadline passed before the seal was sent" };
  return { action: "send", prevRoot: chain.lastRoot };
}

export { sealTiming };
