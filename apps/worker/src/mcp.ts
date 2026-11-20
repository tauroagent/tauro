/**
 * Remote MCP server at /mcp (Streamable HTTP, stateless, JSON responses). Read-only: every tool reads
 * the same public API anyone can call, plus verify_hour, which rebuilds an hour's root and compares it
 * with SealRegistry on Robinhood Chain. Nothing here signs, trades or writes.
 */
import { buildTree, LeafKind, leafHash, sealTiming } from "@tauro/seal";
import type { Hex, PublicClient } from "viem";
import status from "../../../status.json";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const REGISTRY = "0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14" as const;
const SEAL_OF = [
  {
    type: "function",
    name: "sealOf",
    stateMutability: "view",
    inputs: [{ name: "hour", type: "uint64" }],
    outputs: [{ type: "tuple", components: [{ name: "root", type: "bytes32" }, { name: "leafCount", type: "uint32" }, { name: "sealedAt", type: "uint64" }] }],
  },
] as const;

type Api = (path: string) => Promise<unknown>;
type Tool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; run: (a: Record<string, unknown>, api: Api, pub: PublicClient) => Promise<unknown> };

const str = (d?: string) => ({ type: "string", ...(d ? { description: d } : {}) });
const int = (d: string, min: number, max: number) => ({ type: "integer", description: d, minimum: min, maximum: max });
const obj = (props: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const q = (v: unknown) => encodeURIComponent(String(v));
const hourArg = (a: Record<string, unknown>) => {
  const h = a.hour;
  const n = typeof h === "number" ? h : /^\d+$/.test(String(h)) ? Number(h) : Math.floor(Date.parse(String(h)) / 1000);
  if (!Number.isInteger(n) || n % 3600 !== 0) throw new Error("hour must be the start of a UTC hour, as unix seconds or ISO time like 2026-11-19T22:00Z");
  return n;
};

export const TOOLS: Tool[] = [
  { name: "list_markets", title: "Markets", description: "The 35 Robinhood Chain stock tokens Tauro tracks, with token and Chainlink feed addresses and the latest hourly close.", inputSchema: obj(), run: (_a, api) => api("/api/v1/markets") },
  {
    name: "get_prices",
    title: "Hourly closes",
    description: "Hourly Chainlink closes for one market, newest first. A close is the last Chainlink round updated before the hour ended, stored as read.",
    inputSchema: obj({ symbol: str("Ticker, e.g. TSLA, NVDA, SPY"), hours: int("How many hours back (default 48)", 1, 720) }, ["symbol"]),
    run: (a, api) => api(`/api/v1/prices?symbol=${q(String(a.symbol).toUpperCase())}&hours=${q(a.hours ?? 48)}`),
  },
  { name: "list_agents", title: "Paper agents", description: "All paper agents (house and holder): rules, config hash, paper book, equity and return against buy-and-hold of the same market. Paper money only.", inputSchema: obj(), run: (_a, api) => api("/api/v1/agents") },
  {
    name: "get_decisions",
    title: "Agent decisions",
    description: "Every hourly decision of one paper agent, with the values its rules looked at and any paper fill. Each decision is a leaf in that hour's sealed root.",
    inputSchema: obj({ agent: str("Agent id, e.g. house-momentum-tsla (see list_agents)"), hours: int("How many hours back (default 24)", 1, 720) }, ["agent"]),
    run: (a, api) => api(`/api/v1/decisions?agent=${q(a.agent)}&hours=${q(a.hours ?? 24)}`),
  },
  {
    name: "list_seals",
    title: "Hourly seals",
    description: "Hourly Merkle roots and their state on SealRegistry (Robinhood Chain): confirmed with tx, block and timing, or missed with the reason. Missed hours are never back-filled.",
    inputSchema: obj({ hours: int("How many hours back (default 48)", 1, 720) }),
    run: (a, api) => api(`/api/v1/seals?hours=${q(a.hours ?? 48)}`),
  },
  {
    name: "get_proof",
    title: "Merkle proof",
    description: "One sealed record with its leaf, Merkle proof and the hour's root. Subject is a ticker, an agent id, a call id or status.json.",
    inputSchema: obj({ hour: str("Start of the UTC hour: unix seconds or ISO time"), subject: str("Ticker, agent id, call id or status.json") }, ["hour", "subject"]),
    run: (a, api) => api(`/api/v1/proof?hour=${hourArg(a)}&subject=${q(a.subject)}`),
  },
  {
    name: "list_calls",
    title: "Sealed calls",
    description: "Signed calls on stock tokens (up or down within 1 hour to 7 days), each sealed in the next hourly root and scored on Chainlink closes. Optionally for one caller wallet.",
    inputSchema: obj({ caller: str("Optional wallet address 0x…") }),
    run: (a, api) => api(`/api/v1/calls${a.caller ? `?caller=${q(a.caller)}` : ""}`),
  },
  { name: "get_call", title: "One call", description: "One sealed call: the exact signed text, its seal and proof, entry close and result.", inputSchema: obj({ id: str("Call id, e.g. call-8da95dbcafa7") }, ["id"]), run: (a, api) => api(`/api/v1/calls/${q(a.id)}`) },
  { name: "call_leaderboard", title: "Call leaderboard", description: "Every caller ranked by hit rate, then average move in the called direction. Ranked after 3 resolved calls; misses count.", inputSchema: obj(), run: (_a, api) => api("/api/v1/calls/leaderboard") },
  { name: "get_status", title: "Public claims", description: "Every public claim Tauro makes and its status (live, in testing, planned), with the proof for live ones.", inputSchema: obj(), run: async () => status },
  {
    name: "verify_hour",
    title: "Verify an hour",
    description:
      "Rebuilds one sealed hour's Merkle root from all its records and compares it with SealRegistry.sealOf(hour) read from Robinhood Chain, plus the seal timing. For a check that does not trust this server at all, run tauro-verify.mjs yourself (https://tauroagent.com/tauro-verify.mjs).",
    inputSchema: obj({ hour: str("Start of the UTC hour: unix seconds, ISO time, or 'latest'") }, ["hour"]),
    run: async (a, api, pub) => {
      let hour: number;
      if (a.hour === "latest") {
        const s = (await api("/api/v1/seals?hours=24")) as { seals: { hour: number; status: string }[] };
        const c = s.seals.find((x) => x.status === "confirmed");
        if (!c) throw new Error("no confirmed seal in the last 24 hours");
        hour = c.hour;
      } else hour = hourArg(a);
      const data = (await api(`/api/v1/hour?hour=${hour}`)) as { leaves?: { kind: number; subject: string; leaf: Hex; record_canonical: string }[]; error?: string };
      if (!data.leaves) throw new Error(data.error ?? "no records for this hour");
      const leaves = data.leaves.map((l) => leafHash({ kind: l.kind as LeafKind, subject: l.subject, hour, record: JSON.parse(l.record_canonical) }));
      const mismatched = data.leaves.filter((l, i) => leaves[i]!.toLowerCase() !== l.leaf.toLowerCase()).map((l) => l.subject);
      const root = buildTree(leaves).root;
      const s = await pub.readContract({ address: REGISTRY, abi: SEAL_OF, functionName: "sealOf", args: [BigInt(hour)] });
      const sealed = !/^0x0+$/.test(s.root);
      const timing = sealed ? sealTiming(hour, Number(s.sealedAt)) : "missing";
      const pass = sealed && mismatched.length === 0 && s.root.toLowerCase() === root.toLowerCase() && s.leafCount === leaves.length && timing === "on_time";
      return {
        hour,
        hour_utc: new Date(hour * 1000).toISOString(),
        pass,
        records: leaves.length,
        records_not_matching_their_leaf: mismatched,
        rebuilt_root: root,
        chain: { registry: REGISTRY, chain_id: 4663, root: s.root, leaf_count: s.leafCount, sealed_at: Number(s.sealedAt), timing },
        not_checked_here: "Chainlink rounds behind each price and call signatures; tauro-verify.mjs checks those too, from your own machine.",
      };
    },
  },
];

const INSTRUCTIONS =
  "Tauro: paper trading agents for stock tokens on Robinhood Chain. Every hour, Chainlink closes, agent decisions and signed calls are hashed into one Merkle root and sealed on SealRegistry before the next close. All tools are read-only. Paper money only; nothing here is investment advice. Prefer verify_hour or get_proof when a user asks whether a record is real.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function one(m: Rpc, api: Api, pub: PublicClient, sha: string): Promise<object | null> {
  if (m.id === undefined || m.id === null) return null; // notifications get no reply
  switch (m.method) {
    case "initialize": {
      const want = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tauro", title: "Tauro", version: sha.slice(0, 7) || "dev" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } })) });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === m.params?.name);
      if (!t) return err(m.id, -32602, `unknown tool: ${String(m.params?.name)}`);
      try {
        const out = await t.run((m.params?.arguments as Record<string, unknown>) ?? {}, api, pub);
        const text = JSON.stringify(out);
        return ok(m.id, { content: [{ type: "text", text: text.length > 90_000 ? text.slice(0, 90_000) + "…(truncated; ask for fewer hours)" : text }], isError: false });
      } catch (e) {
        return ok(m.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    case "resources/list":
      return ok(m.id, { resources: [] });
    case "prompts/list":
      return ok(m.id, { prompts: [] });
    default:
      return err(m.id, -32601, `method not found: ${m.method}`);
  }
}

const HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function mcpRoute(req: Request, api: Api, pub: PublicClient, sha: string): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE")
    return new Response(JSON.stringify({ error: "This MCP server is stateless: POST JSON-RPC to /mcp. No SSE stream, no sessions.", tools: TOOLS.map((t) => t.name) }), { status: 405, headers: { ...HEADERS, allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
  let body: Rpc | Rpc[];
  try {
    body = (await req.json()) as Rpc | Rpc[];
  } catch {
    return new Response(JSON.stringify(err(null, -32700, "parse error")), { status: 400, headers: HEADERS });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => one(m, api, pub, sha)))).filter(Boolean);
    return out.length ? new Response(JSON.stringify(out), { headers: HEADERS }) : new Response(null, { status: 202, headers: HEADERS });
  }
  const out = await one(body, api, pub, sha);
  return out ? new Response(JSON.stringify(out), { headers: HEADERS }) : new Response(null, { status: 202, headers: HEADERS });
}
