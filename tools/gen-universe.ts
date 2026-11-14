// Builds apps/worker/src/universe.json: Robinhood Chain stock tokens that have an official
// Chainlink "Robinhood <SYMBOL> / USD" feed. Inputs are the two public lists below; pass
// local copies with --feeds <file> --registry <file> when the URLs are not reachable.
import { readFileSync, writeFileSync } from "node:fs";

const FEEDS = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const REGISTRY = "https://api.robinhood.com/rhj/assets";

interface Feed { name: string; proxyAddress: string; heartbeat: number; decimals: number; threshold: number; docs?: { marketHours?: string } }
interface Asset { tokenSymbol: string; tokenName: string; status: string; deployments: { chainId: number; contractAddress: string }[] }

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const load = async (url: string, file?: string): Promise<unknown> => (file ? JSON.parse(readFileSync(file, "utf8")) : (await fetch(url)).json());

const feeds = (await load(FEEDS, arg("--feeds"))) as Feed[];
const assets = ((await load(REGISTRY, arg("--registry"))) as { assets: Asset[] }).assets;

const tokens = new Map<string, { address: string; name: string }>();
for (const a of assets) {
  if (a.status !== "ASSET_STATUS_ACTIVE") continue;
  const d = a.deployments.find((x) => x.chainId === 4663);
  if (d) tokens.set(a.tokenSymbol, { address: d.contractAddress, name: a.tokenName.replace(/\s*•\s*Robinhood Token$/, "") });
}

const markets = feeds
  .filter((f) => /^Robinhood [A-Z.]+ ?(\/ |-)USD$/.test(f.name))
  .map((f) => {
    const symbol = f.name.replace(/^Robinhood /, "").replace(/ ?(\/ |-)USD$/, "");
    const t = tokens.get(symbol);
    return t && {
      symbol,
      name: t.name,
      token: t.address,
      feed: f.proxyAddress,
      feedDecimals: f.decimals,
      heartbeatSec: f.heartbeat,
      deviationPct: f.threshold,
      marketHours: f.docs?.marketHours ?? null,
    };
  })
  .filter((m): m is NonNullable<typeof m> => Boolean(m))
  .sort((a, b) => a.symbol.localeCompare(b.symbol));

writeFileSync(new URL("../apps/worker/src/universe.json", import.meta.url), JSON.stringify({ chainId: 4663, sources: [FEEDS, REGISTRY], markets }, null, 2) + "\n");
console.log(`${markets.length} markets`);
