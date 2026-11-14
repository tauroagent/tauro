import { createPublicClient, defineChain, fallback, http, type PublicClient } from "viem";
import type { Round, RoundReader } from "./rounds.js";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

// Public mirrors first: the official endpoint refuses some Cloudflare egress IPs.
const PUBLIC_RPCS = ["https://robinhood-rpc.publicnode.com", "https://robinhood.drpc.org", "https://rpc.mainnet.chain.robinhood.com"];

export function client(rpcUrl?: string): PublicClient {
  const urls = [...(rpcUrl ? [rpcUrl] : []), ...PUBLIC_RPCS];
  return createPublicClient({
    chain: robinhood,
    transport: fallback(urls.map((u) => http(u, { timeout: 8_000, retryCount: 1 }))),
    batch: { multicall: true },
  }) as PublicClient;
}

const AGGREGATOR_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "_roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** A RoundReader for one feed. Failed calls come back as null instead of throwing. */
export function feedReader(c: PublicClient, feed: `0x${string}`): RoundReader {
  return async (ids) => {
    const res = await c.multicall({
      allowFailure: true,
      contracts: ids.map((id) =>
        id === "latest"
          ? { address: feed, abi: AGGREGATOR_ABI, functionName: "latestRoundData" as const }
          : { address: feed, abi: AGGREGATOR_ABI, functionName: "getRoundData" as const, args: [id] as const },
      ),
    });
    return res.map((r): Round | null => {
      if (r.status !== "success") return null;
      const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      return { roundId, answer, updatedAt: Number(updatedAt) };
    });
  };
}
