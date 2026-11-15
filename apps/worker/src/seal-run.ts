import { createWalletClient, fallback, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import status from "../../../status.json";
import { robinhood } from "./chain.js";
import { buildHour, decideSeal, sealTiming, type PriceRow } from "./sealing.js";
import { MARKETS } from "./universe.js";

export const REGISTRY_ABI = [
  { type: "function", name: "lastHour", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "lastRoot", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "sealCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "sealOf",
    stateMutability: "view",
    inputs: [{ name: "hour", type: "uint64" }],
    outputs: [{ type: "tuple", components: [{ name: "root", type: "bytes32" }, { name: "leafCount", type: "uint32" }, { name: "sealedAt", type: "uint64" }] }],
  },
  {
    type: "function",
    name: "seal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "hour", type: "uint64" },
      { name: "root", type: "bytes32" },
      { name: "prevRoot", type: "bytes32" },
      { name: "leafCount", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

const FEEDS = new Map(MARKETS.map((m) => [m.symbol, m.feed as string]));
const now = () => Math.floor(Date.now() / 1000);

/** Builds and stores the leaves and root for every ingested hour that has no seal row yet. */
export async function buildPending(db: D1Database): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT r.hour FROM ingest_runs r LEFT JOIN seals s ON s.hour = r.hour WHERE r.finished_at IS NOT NULL AND s.hour IS NULL ORDER BY r.hour")
    .all<{ hour: number }>();
  const built: number[] = [];
  for (const { hour } of results) {
    const rows = (
      await db.prepare("SELECT symbol, hour, round_id, answer, updated_at, status FROM price_hourly WHERE hour = ? ORDER BY symbol").bind(hour).all<PriceRow>()
    ).results;
    const { leaves, root } = buildHour(hour, rows, FEEDS, status);
    const t = now();
    await db.batch([
      ...leaves.map((l) =>
        db.prepare("INSERT OR IGNORE INTO leaves (hour, leaf, kind, subject, record) VALUES (?, ?, ?, ?, ?)").bind(hour, l.leaf, l.kind, l.subject, l.record),
      ),
      db
        .prepare("INSERT OR IGNORE INTO seals (hour, root, leaf_count, status, built_at, updated_at) VALUES (?, ?, ?, 'built', ?, ?)")
        .bind(hour, root, leaves.length, t, t),
    ]);
    built.push(hour);
  }
  return built;
}

export interface SealEnv {
  DB: D1Database;
  SIGNER_KEY?: string;
  REGISTRY_ADDRESS?: string;
  RPC_URL?: string;
}

/**
 * Sends every built hour to SealRegistry, oldest first. Without SIGNER_KEY and REGISTRY_ADDRESS
 * the hours stay "built": computed and published, but not on chain, and the API says so.
 */
export async function sendPending(env: SealEnv, pub: PublicClient): Promise<{ hour: number; status: string }[]> {
  if (!env.SIGNER_KEY || !env.REGISTRY_ADDRESS) return [];
  const registry = env.REGISTRY_ADDRESS as Hex;
  const account = privateKeyToAccount(env.SIGNER_KEY as Hex);
  const urls = [...(env.RPC_URL ? [env.RPC_URL] : []), "https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org"];
  const wallet = createWalletClient({ account, chain: robinhood, transport: fallback(urls.map((u) => http(u, { timeout: 10_000 }))) });

  const { results } = await env.DB.prepare("SELECT hour, root, leaf_count, status, tx_hash FROM seals WHERE status IN ('built', 'sent') ORDER BY hour").all<{
    hour: number;
    root: Hex;
    leaf_count: number;
    status: string;
    tx_hash: Hex | null;
  }>();
  const out: { hour: number; status: string }[] = [];

  for (const s of results) {
    const read = async () => {
      const [lastHour, lastRoot, sealCount, at] = await Promise.all([
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "lastHour" }),
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "lastRoot" }),
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "sealCount" }),
        pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "sealOf", args: [BigInt(s.hour)] }),
      ]);
      return { lastHour: Number(lastHour), lastRoot, sealCount: Number(sealCount), rootAtHour: at.root, sealedAt: Number(at.sealedAt) };
    };
    const chain = await read();
    const d = decideSeal(s.hour, s.root, chain, now());

    if (d.action === "already") {
      await env.DB.prepare("UPDATE seals SET status = 'confirmed', block_time = ?, timing = ?, updated_at = ? WHERE hour = ?")
        .bind(chain.sealedAt, sealTiming(s.hour, chain.sealedAt), now(), s.hour)
        .run();
      out.push({ hour: s.hour, status: "confirmed" });
      continue;
    }
    if (d.action === "missed") {
      await env.DB.prepare("UPDATE seals SET status = 'missed', error = ?, updated_at = ? WHERE hour = ?").bind(d.reason, now(), s.hour).run();
      out.push({ hour: s.hour, status: "missed" });
      continue;
    }
    if (s.status === "sent" && s.tx_hash) {
      // Sent in an earlier run and not on chain yet. Reverted: mark failed. Still unknown: leave it, never double-send.
      const receipt = await pub.getTransactionReceipt({ hash: s.tx_hash }).catch(() => null);
      if (receipt?.status === "reverted") {
        await env.DB.prepare("UPDATE seals SET status = 'failed', error = 'transaction reverted', updated_at = ? WHERE hour = ?").bind(now(), s.hour).run();
        out.push({ hour: s.hour, status: "failed" });
        continue;
      }
      break;
    }

    try {
      const hash = await wallet.writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "seal",
        args: [BigInt(s.hour), s.root, d.prevRoot, s.leaf_count],
      });
      await env.DB.prepare("UPDATE seals SET status = 'sent', tx_hash = ?, prev_root = ?, updated_at = ? WHERE hour = ?").bind(hash, d.prevRoot, now(), s.hour).run();
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 45_000 });
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      const ok = receipt.status === "success";
      await env.DB.prepare("UPDATE seals SET status = ?, block_number = ?, block_time = ?, timing = ?, error = ?, updated_at = ? WHERE hour = ?")
        .bind(
          ok ? "confirmed" : "failed",
          Number(receipt.blockNumber),
          Number(block.timestamp),
          sealTiming(s.hour, Number(block.timestamp)),
          ok ? null : "transaction reverted",
          now(),
          s.hour,
        )
        .run();
      out.push({ hour: s.hour, status: ok ? "confirmed" : "failed" });
      if (!ok) break;
    } catch (e) {
      await env.DB.prepare("UPDATE seals SET error = ?, updated_at = ? WHERE hour = ?").bind(String(e).slice(0, 300), now(), s.hour).run();
      out.push({ hour: s.hour, status: "error" });
      break; // keep order: never seal a later hour past one that failed to send
    }
  }
  return out;
}
