import { buildTree, canonicalize, LeafKind, leafHash } from "@tauro/seal";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { mcpRoute, TOOLS } from "../src/mcp.js";

const H = 1_795_125_600;
const records = [
  { kind: LeafKind.Price, subject: "TSLA", record: { symbol: "TSLA", hour: H, answer: "37250000000" } },
  { kind: LeafKind.Status, subject: "status.json", record: { status_json_keccak256: "0x01" } },
];
const leaves = records.map((r) => ({ kind: r.kind, subject: r.subject, leaf: leafHash({ kind: r.kind, subject: r.subject, hour: H, record: r.record }), record_canonical: canonicalize(r.record) }));
const root = buildTree(leaves.map((l) => l.leaf)).root;

const api = async (path: string) => {
  if (path.startsWith("/api/v1/hour")) return { leaves };
  if (path.startsWith("/api/v1/markets")) return { markets: [{ symbol: "TSLA" }] };
  return { path };
};
const chain = (r: string, count = 2, sealedAt = H + 3660) => ({ readContract: async () => ({ root: r, leafCount: count, sealedAt: BigInt(sealedAt) }) }) as unknown as PublicClient;
const rpc = async (body: unknown, pub = chain(root)) => {
  const res = await mcpRoute(new Request("https://x/mcp", { method: "POST", body: JSON.stringify(body) }), api, pub, "abcdef1234");
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};
const call = async (name: string, args: Record<string, unknown>, pub?: PublicClient) => {
  const r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }, pub);
  const out = (r.body as { result: { content: { text: string }[]; isError: boolean } }).result;
  return { isError: out.isError, data: out.isError ? out.content[0]!.text : JSON.parse(out.content[0]!.text) };
};

describe("mcp", () => {
  it("initializes with the client's protocol version and lists read-only tools", async () => {
    const init = (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).body as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("tauro");
    const list = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("answers notifications with 202 and no body, and GET with 405", async () => {
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await mcpRoute(new Request("https://x/mcp"), api, chain(root), "")).status).toBe(405);
  });

  it("maps tools to the public API", async () => {
    expect((await call("get_prices", { symbol: "tsla", hours: 5 })).data).toEqual({ path: "/api/v1/prices?symbol=TSLA&hours=5" });
    expect((await call("get_proof", { hour: "2026-11-19T22:00Z", subject: "TSLA" })).data).toEqual({ path: `/api/v1/proof?hour=${H}&subject=TSLA` });
    expect((await call("get_proof", { hour: "2026-11-19T22:30Z", subject: "TSLA" })).isError).toBe(true);
  });

  it("verify_hour passes when the rebuilt root is on chain on time, and fails otherwise", async () => {
    expect((await call("verify_hour", { hour: H })).data.pass).toBe(true);
    expect((await call("verify_hour", { hour: H }, chain("0x" + "ab".repeat(32)))).data.pass).toBe(false);
    expect((await call("verify_hour", { hour: H }, chain(root, 2, H + 7300))).data.chain.timing).toBe("late");
  });
});
