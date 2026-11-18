import { decodeEventLog, keccak256, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import { TOKEN } from "./token.js";

const UNIT = 10n ** 18n;
export const DEAD = "0x000000000000000000000000000000000000dead";

/**
 * Holder slots. A slot is one paper agent of your own that runs every hour next to the house agents
 * and is sealed the same way. Balances are read on chain at every hourly run.
 */
export const SLOTS = {
  hold: [
    { min: 1_000_000n * UNIT, slots: 1 },
    { min: 5_000_000n * UNIT, slots: 3 },
  ],
  /** Burning this much TAURO to the dead address adds one slot for `burnDays`. */
  burnPerSlot: 1_000_000n * UNIT,
  burnDays: 30,
  /** Burns before this time (the dev burn at launch, for example) do not count. 18 November 2026 00:00 UTC. */
  burnsCountFrom: 1_794_960_000,
  /** Hard cap on holder agents, to keep the hourly run inside the Worker's limits. */
  maxAgents: 200,
  /** A signed request is accepted for this long after its `Issued` time. */
  signatureTtlSec: 600,
} as const;

export function holdSlots(balance: bigint): number {
  let n = 0;
  for (const t of SLOTS.hold) if (balance >= t.min) n = t.slots;
  return n;
}

export interface Credit {
  tx_hash: string;
  slots: number;
  expires_at: number;
}

export function burnSlots(credits: Credit[], at: number): number {
  return credits.filter((c) => c.expires_at > at).reduce((s, c) => s + c.slots, 0);
}

export const tokens = (wei: bigint): number => Number(wei / 10n ** 12n) / 1e6;

export const TEMPLATE_KEYS = ["momentum", "mean_reversion", "dip_hunter", "breakout"] as const;

export interface LaunchRequest {
  owner: string;
  template: string;
  market: string;
  stopLossPct: number;
  sizeUsd: number;
  issued: string;
}

/** The exact text a wallet signs to start an agent. The server rebuilds it from the request fields. */
export function launchMessage(r: LaunchRequest): string {
  return [
    "Tauro: run my paper agent",
    `Owner: ${r.owner.toLowerCase()}`,
    `Strategy: ${r.template}`,
    `Market: ${r.market}`,
    `Stop loss: ${r.stopLossPct}%`,
    `Order size: $${r.sizeUsd}`,
    `Issued: ${r.issued}`,
    "Paper only. This signature sends no transaction and costs nothing.",
  ].join("\n");
}

export function retireMessage(owner: string, agent: string, issued: string): string {
  return ["Tauro: retire my paper agent", `Owner: ${owner.toLowerCase()}`, `Agent: ${agent}`, `Issued: ${issued}`].join("\n");
}

/** `Issued` must be an ISO time no more than the TTL in the past and at most a minute ahead. */
export function issuedOk(issued: string, nowSec: number): boolean {
  const t = Date.parse(issued);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(issued)) return false;
  const s = Math.floor(t / 1000);
  return s <= nowSec + 60 && nowSec - s <= SLOTS.signatureTtlSec;
}

export const sigHash = (sig: string): string => keccak256(toHex(sig.toLowerCase()));

export interface LaunchRow {
  agent: string;
  owner: string;
  requested_at: number;
  status: "queued" | "active" | "paused" | "retired";
}

export interface Allocation {
  agent: string;
  status: LaunchRow["status"];
  reason: string | null;
}

/**
 * Decides which holder agents run this hour. Oldest first per owner: the first `slots` run,
 * the rest wait. An owner whose balance could not be read keeps the previous statuses.
 */
export function allocate(rows: LaunchRow[], balances: Map<string, bigint | null>, credits: Map<string, Credit[]>, at: number): Allocation[] {
  const byOwner = new Map<string, LaunchRow[]>();
  for (const r of rows) if (r.status !== "retired") byOwner.set(r.owner, [...(byOwner.get(r.owner) ?? []), r]);
  const out: Allocation[] = [];
  for (const [owner, list] of byOwner) {
    list.sort((a, b) => a.requested_at - b.requested_at || a.agent.localeCompare(b.agent));
    const bal = balances.get(owner);
    if (bal === null || bal === undefined) {
      for (const r of list) out.push({ agent: r.agent, status: r.status, reason: "balance read failed, kept the last status" });
      continue;
    }
    const slots = holdSlots(bal) + burnSlots(credits.get(owner) ?? [], at);
    list.forEach((r, i) => {
      if (i < slots) out.push({ agent: r.agent, status: "active", reason: null });
      else out.push({ agent: r.agent, status: r.status === "queued" ? "queued" : "paused", reason: `needs ${i + 1} slot${i ? "s" : ""}, wallet has ${slots} at this hour` });
    });
  }
  return out;
}

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);

/** TAURO balances, one multicall. A failed read is null, never zero. */
export async function balancesOf(c: PublicClient, owners: string[]): Promise<Map<string, bigint | null>> {
  const out = new Map<string, bigint | null>();
  if (owners.length === 0) return out;
  try {
    const res = await c.multicall({
      allowFailure: true,
      contracts: owners.map((o) => ({ address: TOKEN.address as Hex, abi: ERC20, functionName: "balanceOf" as const, args: [o as Hex] as const })),
    });
    owners.forEach((o, i) => out.set(o, res[i]!.status === "success" ? (res[i]!.result as bigint) : null));
  } catch {
    for (const o of owners) out.set(o, null);
  }
  return out;
}

export interface Burn {
  tx_hash: string;
  owner: string;
  amount: bigint;
  block_number: number;
  block_time: number;
  slots: number;
  expires_at: number;
}

/**
 * Reads a burn from chain: TAURO Transfer logs in a successful tx, sent by the tx signer to the dead
 * address. Several transfers in one tx add up. Throws a readable message when it does not qualify.
 */
export async function readBurn(c: Pick<PublicClient, "getTransactionReceipt" | "getBlock">, txHash: Hex): Promise<Burn> {
  const receipt = await c.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new Error("transaction not found on Robinhood Chain (yet)");
  if (receipt.status !== "success") throw new Error("transaction failed on chain");
  const from = receipt.from.toLowerCase();
  let amount = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== TOKEN.address) continue;
    try {
      const ev = decodeEventLog({ abi: ERC20, data: log.data, topics: log.topics });
      if (ev.eventName !== "Transfer") continue;
      const a = ev.args as { from: string; to: string; value: bigint };
      if (a.from.toLowerCase() === from && a.to.toLowerCase() === DEAD) amount += a.value;
    } catch {
      /* not a Transfer */
    }
  }
  if (amount === 0n) throw new Error("no TAURO sent from the signer to 0x…dEaD in this transaction");
  const block = await c.getBlock({ blockNumber: receipt.blockNumber });
  const blockTime = Number(block.timestamp);
  if (blockTime < SLOTS.burnsCountFrom) throw new Error("burns before 18 November 2026 00:00 UTC do not count");
  const slots = Number(amount / SLOTS.burnPerSlot);
  if (slots < 1) throw new Error(`burn at least ${tokens(SLOTS.burnPerSlot).toLocaleString("en-US")} TAURO for one slot`);
  return { tx_hash: txHash.toLowerCase(), owner: from, amount, block_number: Number(receipt.blockNumber), block_time: blockTime, slots, expires_at: blockTime + SLOTS.burnDays * 86_400 };
}

export function agentIdFor(owner: string, market: string, configHash: string): string {
  return `holder-${owner.slice(2, 8).toLowerCase()}-${market.toLowerCase()}-${configHash.slice(2, 8).toLowerCase()}`;
}
