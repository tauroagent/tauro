import data from "./universe.json";

export interface Market {
  symbol: string;
  name: string;
  token: `0x${string}`;
  feed: `0x${string}`;
  feedDecimals: number;
  heartbeatSec: number;
  deviationPct: number;
  marketHours: string | null;
}

export const MARKETS = data.markets as Market[];
export const UNIVERSE_SOURCES = data.sources;
