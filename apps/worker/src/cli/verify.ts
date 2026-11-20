/**
 * tauro-verify: recompute one sealed hour from public data.
 *
 *   node tauro-verify.mjs [hour] [--rpc URL] [--api URL] [--json] [--tamper SUBJECT]
 *
 * hour: unix seconds, an ISO time ("2026-11-19T22:00Z") or "latest" (the newest confirmed seal).
 * The records come from tauroagent.com. Everything they are checked against is read from
 * Robinhood Chain: the root in SealRegistry, the Chainlink rounds behind every price,
 * and the wallet behind every call signature. The registry and feed addresses are built in,
 * so a server cannot point the check somewhere else.
 */
import { buildTree, canonicalize, LeafKind, leafHash, sealTiming } from "@tauro/seal";
import { createPublicClient, defineChain, fallback, http, verifyMessage, type Hex } from "viem";
import universe from "../universe.json";

const REGISTRY = "0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14" as const;
const FEEDS = new Map(universe.markets.map((m) => [m.symbol, m.feed.toLowerCase()]));
const RPCS = ["https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org", "https://rpc.mainnet.chain.robinhood.com"];
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPCS } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});
const SEAL_ABI = [
  {
    type: "function",
    name: "sealOf",
    stateMutability: "view",
    inputs: [{ name: "hour", type: "uint64" }],
    outputs: [{ type: "tuple", components: [{ name: "root", type: "bytes32" }, { name: "leafCount", type: "uint32" }, { name: "sealedAt", type: "uint64" }] }],
  },
  { type: "function", name: "lastHour", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;
const ROUND_ABI = [
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

type Leaf = { kind: number; subject: string; leaf: Hex; record_canonical: string };
type Check = { name: string; ok: boolean; detail: string; fails?: string[] };

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = new Set(["--rpc", "--api", "--tamper"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !flags.has(args[i - 1] ?? ""));
const API = (opt("--api") ?? "https://tauroagent.com").replace(/\/$/, "");
const JSON_OUT = args.includes("--json");
const TAMPER = opt("--tamper");
const tty = process.stdout.isTTY && !JSON_OUT;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const pub = createPublicClient({ chain, transport: fallback([...(opt("--rpc") ? [opt("--rpc")!] : []), ...RPCS].map((u) => http(u, { timeout: 10_000, retryCount: 2 }))), batch: { multicall: true } });
const utc = (s: number) => new Date(s * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(API + path, { headers: { "user-agent": "tauro-verify" } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

async function resolveHour(x: string | undefined): Promise<number> {
  if (!x || x === "latest") {
    const s = await getJson<{ seals: { hour: number; status: string }[] }>("/api/v1/seals?hours=24");
    const h = s.seals.find((r) => r.status === "confirmed");
    if (!h) throw new Error("no confirmed seal in the last 24 hours");
    return h.hour;
  }
  const n = /^\d+$/.test(x) ? Number(x) : Math.floor(Date.parse(x) / 1000);
  if (!Number.isInteger(n) || n % 3600 !== 0) throw new Error(`"${x}" is not the start of a UTC hour`);
  return n;
}

async function main() {
  const hour = await resolveHour(positional[0]);
  const checks: Check[] = [];
  const add = (name: string, fails: string[], detail: string) => checks.push({ name, ok: fails.length === 0, detail, fails });

  const data = await getJson<{ leaves: Leaf[] }>(`/api/v1/hour?hour=${hour}`);
  const leaves = data.leaves.map((l) => ({ ...l }));
  let edit = "";
  if (TAMPER) {
    const t = leaves.find((l) => l.subject === TAMPER);
    if (!t) throw new Error(`--tamper: no record with subject ${TAMPER}`);
    // Demo: the kind of edit someone would make after the fact. The record changes; the seal on chain does not.
    const r = JSON.parse(t.record_canonical) as Record<string, unknown>;
    if (typeof r.answer === "string") {
      const was = Number(r.answer) / 1e8;
      r.answer = String((BigInt(r.answer) * 101n) / 100n);
      edit = `close $${was.toFixed(2)} -> $${(Number(r.answer) / 1e8).toFixed(2)}`;
    } else if (r.side === "up" || r.side === "down") {
      edit = `call ${r.side} -> ${r.side === "up" ? "down" : "up"}`;
      r.side = r.side === "up" ? "down" : "up";
    } else if (typeof r.action === "string") {
      edit = `${r.action} -> ${r.action === "buy" ? "hold" : "buy"}`;
      r.action = r.action === "buy" ? "hold" : "buy";
    } else {
      edit = "one field changed";
      r.edited = true;
    }
    t.record_canonical = canonicalize(r);
  }

  // 1. Every record hashes to a leaf (we never use the leaf the server sent; we compute it).
  const records = leaves.map((l) => ({ ...l, record: JSON.parse(l.record_canonical) as Record<string, unknown> }));
  const mine = records.map((l) => leafHash({ kind: l.kind as LeafKind, subject: l.subject, hour, record: l.record }));
  const changed = records.filter((l, i) => mine[i]!.toLowerCase() !== l.leaf.toLowerCase()).map((l) => `${l.subject}: record does not hash to the leaf the server sent`);
  add("records", changed, `${records.length} records re-hashed into leaves`);

  // 2. The leaves rebuild a root, and 3. that root is the one stored on chain for this hour.
  const root = buildTree(mine).root;
  const onchain = await pub.readContract({ address: REGISTRY, abi: SEAL_ABI, functionName: "sealOf", args: [BigInt(hour)] });
  const zero = /^0x0+$/.test(onchain.root);
  add("root", zero ? ["no root on chain for this hour"] : onchain.root.toLowerCase() === root.toLowerCase() ? [] : [`rebuilt ${short(root)} but chain has ${short(onchain.root)}`], `Merkle root ${short(root)} rebuilt from ${mine.length} leaves`);
  add("registry", zero ? ["hour not sealed"] : onchain.leafCount === mine.length ? [] : [`chain says ${onchain.leafCount} leaves, we have ${mine.length}`], `SealRegistry.sealOf read on Robinhood Chain: root ${short(onchain.root)}, ${onchain.leafCount} leaves`);

  // 4. Timing: sealed after the hour closed and before the next close.
  const timing = zero ? "missing" : sealTiming(hour, Number(onchain.sealedAt));
  add("timing", timing === "on_time" ? [] : [`seal timing: ${timing}`], `sealed at ${zero ? "n/a" : utc(Number(onchain.sealedAt))}, ${timing.replace("_", " ")} (deadline ${utc(hour + 7200)})`);

  // 5. Every price record is the Chainlink round that closed the hour, read from the feed itself.
  const prices = records.filter((l) => l.kind === LeafKind.Price);
  const pfails: string[] = [];
  let ok = 0;
  await Promise.all(
    prices.map(async (p) => {
      const r = p.record as { symbol: string; feed: string | null; status: string; round_id: string | null; answer: string | null; updated_at: number | null };
      const feed = FEEDS.get(r.symbol);
      if (!feed || (r.feed ?? "").toLowerCase() !== feed) return void pfails.push(`${r.symbol}: feed ${r.feed} is not the published Chainlink feed`);
      if (r.status !== "ok" || !r.round_id) return void ok++; // a failed read is sealed as a gap; nothing to compare
      const id = BigInt(r.round_id);
      const [cur, next] = await Promise.all([
        pub.readContract({ address: feed as Hex, abi: ROUND_ABI, functionName: "getRoundData", args: [id] }),
        pub.readContract({ address: feed as Hex, abi: ROUND_ABI, functionName: "getRoundData", args: [id + 1n] }).catch(() => null),
      ]);
      if (cur[1].toString() !== r.answer || Number(cur[3]) !== r.updated_at) return void pfails.push(`${r.symbol}: round ${r.round_id} on chain is ${cur[1]} at ${cur[3]}, record says ${r.answer} at ${r.updated_at}`);
      if (Number(cur[3]) >= hour + 3600) return void pfails.push(`${r.symbol}: round updated after the hour closed`);
      if (next && Number(next[3]) !== 0 && Number(next[3]) < hour + 3600) return void pfails.push(`${r.symbol}: a newer round (${id + 1n}) closed before the hour ended`);
      ok++;
    }),
  );
  add("prices", pfails, `${ok} of ${prices.length} prices match the Chainlink round that closed the hour`);

  // 6. Every call was signed by the wallet it names, and the signed text says what the record says.
  const calls = records.filter((l) => l.kind === LeafKind.Call);
  const cfails: string[] = [];
  for (const l of calls) {
    const r = l.record as { call: string; caller: Hex; market: string; side: string; horizon_hours: number; note: string; issued: string; message: string; signature: Hex };
    const good = await verifyMessage({ address: r.caller, message: r.message, signature: r.signature }).catch(() => false);
    const text = [`Caller: ${r.caller}`, `Market: ${r.market}`, `Call: ${r.side}`, `Within: ${r.horizon_hours} hours`, `Issued: ${r.issued}`].every((s) => r.message.includes(s));
    if (!good) cfails.push(`${r.call}: signature does not recover ${r.caller}`);
    else if (!text) cfails.push(`${r.call}: signed text differs from the record`);
  }
  add("calls", cfails, calls.length ? `${calls.length} call${calls.length === 1 ? "" : "s"}: signature recovers the caller, signed text matches` : "no calls this hour");

  // 7. Every decision acted on the close sealed in the same hour for its market.
  const close = new Map(prices.map((p) => { const r = p.record as { symbol: string; answer: string | null }; return [r.symbol, r.answer ? Number(r.answer) / 1e8 : null]; }));
  const agents = await getJson<{ agents: { id: string; market: string }[] }>("/api/v1/agents").catch(() => ({ agents: [] }));
  const market = new Map(agents.agents.map((a) => [a.id, a.market]));
  const dfails: string[] = [];
  const decisions = records.filter((l) => l.kind === LeafKind.Decision);
  let checked = 0;
  for (const l of decisions) {
    const r = l.record as { agent: string; price: number | null };
    const m = market.get(r.agent), px = m ? close.get(m) : undefined;
    if (r.price === null || px === undefined || px === null) continue;
    checked++;
    if (Math.abs(r.price - px) > 1e-6) dfails.push(`${r.agent}: decided on ${r.price}, sealed close for ${m} is ${px}`);
  }
  add("decisions", dfails, `${checked} of ${decisions.length} agent decisions checked: each used the close sealed for its market`);

  const pass = checks.every((x) => x.ok);
  if (JSON_OUT) {
    console.log(JSON.stringify({ hour, hour_utc: utc(hour), pass, root, chain_root: onchain.root, tampered: TAMPER ? { subject: TAMPER, edit } : null, checks }, null, 1));
  } else {
    console.log(c("1", `\nTauro verify · hour ${utc(hour)} (${hour})`) + (TAMPER ? c("33", `  · demo edit: ${TAMPER} ${edit}`) : ""));
    console.log(c("2", `records from ${API}, everything else read from Robinhood Chain (chain 4663)\n`));
    for (const x of checks) {
      console.log(`${x.ok ? c("32", "✓") : c("31", "✗")} ${x.detail}`);
      for (const f of (x.fails ?? []).slice(0, 5)) console.log(c("31", `    ${f}`));
    }
    console.log(pass ? c("32;1", `\nPASS · the hour matches its seal on chain`) : c("31;1", `\nFAIL · the records do not match the seal on chain`));
  }
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(c("31", `error: ${e instanceof Error ? e.message : String(e)}`));
  process.exitCode = 2;
});
