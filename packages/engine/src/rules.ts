/** Rules schema v0. An agent is one market plus these rules; the schema is frozen once an agent is created. */

export type Op = "lt" | "gt";

export type Condition =
  | { kind: "change"; hours: number; op: Op; pct: number }
  | { kind: "rsi"; period: number; op: Op; value: number }
  | { kind: "sma_cross"; fast: number; slow: number; dir: "above" | "below" }
  | { kind: "price_vs_sma"; period: number; op: Op; pct: number };

export interface Rules {
  version: 0;
  market: string;
  /** All entry conditions must hold to open a position. */
  entry: Condition[];
  /** Any exit condition closes the position. Stop loss and take profit are checked first. */
  exit: Condition[];
  stopLossPct: number;
  takeProfitPct?: number;
  maxHoldHours?: number;
  sizeUsd: number;
}

export type RulesError = { path: string; message: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPeriod = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 720;

function checkCondition(c: Condition, path: string, out: RulesError[]): void {
  switch (c.kind) {
    case "change":
      if (!isPeriod(c.hours)) out.push({ path: `${path}.hours`, message: "must be an integer from 1 to 720" });
      if (!isNum(c.pct)) out.push({ path: `${path}.pct`, message: "must be a number" });
      break;
    case "rsi":
      if (!isPeriod(c.period) || c.period < 2) out.push({ path: `${path}.period`, message: "must be an integer from 2 to 720" });
      if (!isNum(c.value) || c.value < 0 || c.value > 100) out.push({ path: `${path}.value`, message: "must be between 0 and 100" });
      break;
    case "sma_cross":
      if (!isPeriod(c.fast) || !isPeriod(c.slow) || c.fast >= c.slow)
        out.push({ path, message: "fast and slow must be periods with fast < slow" });
      break;
    case "price_vs_sma":
      if (!isPeriod(c.period)) out.push({ path: `${path}.period`, message: "must be an integer from 1 to 720" });
      if (!isNum(c.pct)) out.push({ path: `${path}.pct`, message: "must be a number" });
      break;
    default:
      out.push({ path, message: "unknown condition kind" });
  }
}

export function validateRules(r: Rules): RulesError[] {
  const out: RulesError[] = [];
  if (r.version !== 0) out.push({ path: "version", message: "must be 0" });
  if (typeof r.market !== "string" || r.market.length === 0) out.push({ path: "market", message: "required" });
  if (!Array.isArray(r.entry) || r.entry.length === 0) out.push({ path: "entry", message: "needs at least one condition" });
  else r.entry.forEach((c, i) => checkCondition(c, `entry[${i}]`, out));
  if (!Array.isArray(r.exit)) out.push({ path: "exit", message: "must be a list" });
  else r.exit.forEach((c, i) => checkCondition(c, `exit[${i}]`, out));
  if (!isNum(r.stopLossPct) || r.stopLossPct <= 0 || r.stopLossPct > 50)
    out.push({ path: "stopLossPct", message: "required, between 0 and 50" });
  if (r.takeProfitPct !== undefined && (!isNum(r.takeProfitPct) || r.takeProfitPct <= 0))
    out.push({ path: "takeProfitPct", message: "must be positive" });
  if (r.maxHoldHours !== undefined && !isPeriod(r.maxHoldHours))
    out.push({ path: "maxHoldHours", message: "must be an integer from 1 to 720" });
  if (!isNum(r.sizeUsd) || r.sizeUsd <= 0) out.push({ path: "sizeUsd", message: "must be positive" });
  return out;
}

/** Starting points offered in the studio. Users edit them before launch. */
export const TEMPLATES: Record<string, Omit<Rules, "market">> = {
  momentum: {
    version: 0,
    entry: [
      { kind: "sma_cross", fast: 6, slow: 24, dir: "above" },
      { kind: "change", hours: 6, op: "gt", pct: 0.5 },
    ],
    exit: [{ kind: "sma_cross", fast: 6, slow: 24, dir: "below" }],
    stopLossPct: 3,
    sizeUsd: 100,
  },
  mean_reversion: {
    version: 0,
    entry: [{ kind: "price_vs_sma", period: 24, op: "lt", pct: -2 }],
    exit: [{ kind: "price_vs_sma", period: 24, op: "gt", pct: 0 }],
    stopLossPct: 4,
    maxHoldHours: 48,
    sizeUsd: 100,
  },
  dip_hunter: {
    version: 0,
    entry: [
      { kind: "rsi", period: 14, op: "lt", value: 30 },
      { kind: "change", hours: 24, op: "lt", pct: -3 },
    ],
    exit: [{ kind: "rsi", period: 14, op: "gt", value: 55 }],
    stopLossPct: 5,
    takeProfitPct: 4,
    sizeUsd: 100,
  },
  breakout: {
    version: 0,
    entry: [
      { kind: "price_vs_sma", period: 48, op: "gt", pct: 2 },
      { kind: "change", hours: 3, op: "gt", pct: 1 },
    ],
    exit: [{ kind: "change", hours: 3, op: "lt", pct: -1 }],
    stopLossPct: 2.5,
    maxHoldHours: 12,
    sizeUsd: 100,
  },
};
