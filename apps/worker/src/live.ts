/**
 * One public real-money wallet. It mirrors one house agent (published below, chosen before any live result)
 * with small, published caps. Order of events, every hour:
 *   1. the agent decides in hour H (paper, as always) and the decision is sealed in the root of H;
 *   2. only after that root is confirmed on SealRegistry does this module act on the decision;
 *   3. the price gate (Chainlink vs the pool's own quote) must pass, then it swaps on Uniswap v3;
 *   4. the order (filled, blocked, skipped) is stored and sealed as a Fill leaf in the next root.
 * Modes: "off", "dry_run" (real quotes, no transaction, a simulated 200 USDG book) and "live".
 * The wallet holds team money only: no deposits from anyone, no payouts to anyone.
 */
import { checkGate } from "@tauro/gate";
import { createWalletClient, fallback, http, parseAbi, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PUBLIC_RPCS, robinhood } from "./chain.js";

export const LIVE = {
  agent: "house-mean-reversion-nvda",
  market: "NVDA",
  chainId: 4663,
  pool: "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3",
  fee: 500,
  usdg: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  token: { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18 },
  feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
  quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  router: "0xcaf681a66d020601342297493863e78c959e5cb2",
  registry: "0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14",
  caps: {
    startUsdg: 200,
    /** Live order = the paper agent's order size × scale. */
    scale: 0.2,
    maxOrderUsd: 40,
    maxDayUsd: 200,
    slippageBps: 50,
    maxGapBps: 200,
    maxFeedAgeSec: 3 * 3600,
    /** Halt when equity falls below start × (1 − drawdownStop). */
    drawdownStop: 0.2,
    /** Halt after this many orders in a row blocked by the gate. */
    gateFailStop: 6,
    /** A decision is acted on only within this many seconds after its hour closed. */
    actWithinSec: 2 * 3600,
  },
} as const;

/** Token amounts below this are dust (left by rounding a sell to 6 decimals) and count as no position. */
export const DUST = 1e-6;
export type Mode = "off" | "dry_run" | "live";
export interface Book { cash: number; qty: number }
export interface Decision { hour: number; action: "buy" | "sell" | "hold"; sizeUsd: number; leaf: string | null }
export type Plan =
  | { do: "buy"; usd: number }
  | { do: "sell"; qty: number }
  | { do: "skip"; reason: string };

/** What to do with one sealed decision. Pure. */
export function planOrder(d: Decision, book: Book, spentTodayUsd: number, halted: string | null): Plan {
  const c = LIVE.caps;
  if (halted) return { do: "skip", reason: `halted: ${halted}` };
  if (d.action === "buy") {
    if (book.qty > DUST) return { do: "skip", reason: "already holding" };
    const usd = Math.min(d.sizeUsd * c.scale, c.maxOrderUsd, book.cash, c.maxDayUsd - spentTodayUsd);
    if (usd < 1) return { do: "skip", reason: spentTodayUsd >= c.maxDayUsd ? "daily cap reached" : "no cash" };
    return { do: "buy", usd: Math.floor(usd * 1e6) / 1e6 };
  }
  if (d.action === "sell") return book.qty > DUST ? { do: "sell", qty: book.qty } : { do: "skip", reason: "nothing to sell" };
  return { do: "skip", reason: "hold" };
}

/** Reason to halt, or null. Checked after every order. Pure. */
export function haltReason(equity: number, gateBlockStreak: number): string | null {
  const c = LIVE.caps;
  if (equity < c.startUsdg * (1 - c.drawdownStop)) return `equity ${equity.toFixed(2)} USDG is below the ${c.drawdownStop * 100}% drawdown stop`;
  if (gateBlockStreak >= c.gateFailStop) return `${gateBlockStreak} orders in a row blocked by the price gate`;
  return null;
}

export const minOut = (quote: bigint): bigint => (quote * BigInt(10_000 - LIVE.caps.slippageBps)) / 10_000n;
const toUnits = (x: number, d: number): bigint => BigInt(Math.floor(x * 10 ** Math.min(d, 6))) * 10n ** BigInt(Math.max(0, d - 6));
const fromUnits = (x: bigint, d: number): number => Number(x) / 10 ** d;

const QUOTER = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
const ROUTER = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const FEED = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);
const SEAL_OF = parseAbi(["function sealOf(uint64 hour) view returns ((bytes32 root, uint32 leafCount, uint64 sealedAt))"]);


/** Real quote from QuoterV2 and the Chainlink price gate for one planned order. No transaction. */
export async function quoteAndGate(pub: PublicClient, plan: Extract<Plan, { do: "buy" | "sell" }>, nowSec: number) {
  const buy = plan.do === "buy";
  const tokenIn = buy ? LIVE.usdg : LIVE.token, tokenOut = buy ? LIVE.token : LIVE.usdg;
  const amountIn = buy ? toUnits(plan.usd, LIVE.usdg.decimals) : toUnits(plan.qty, LIVE.token.decimals);
  const { result: q } = await pub.simulateContract({ address: LIVE.quoter, abi: QUOTER, functionName: "quoteExactInputSingle", args: [{ tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn, fee: LIVE.fee, sqrtPriceLimitX96: 0n }] });
  const quoteOut = q[0];
  const inN = fromUnits(amountIn, tokenIn.decimals), outN = fromUnits(quoteOut, tokenOut.decimals);
  const poolPrice = outN > 0 && inN > 0 ? (buy ? inN / outN : outN / inN) : null;
  const rd = await pub.readContract({ address: LIVE.feed, abi: FEED, functionName: "latestRoundData" });
  const gate = checkGate({ poolPrice, feed: { roundId: rd[0], answer: rd[1], decimals: 8, updatedAt: Number(rd[3]) }, now: nowSec, maxFeedAgeSec: LIVE.caps.maxFeedAgeSec, maxGapBps: LIVE.caps.maxGapBps, halted: false });
  const quote = { amount_in: inN, quote_out: outN, min_out: fromUnits(minOut(quoteOut), tokenOut.decimals), pool_price: poolPrice, chainlink_price: gate.feedPrice, gap_bps: gate.gapBps, feed_age_sec: gate.feedAgeSec };
  return { tokenIn, tokenOut, amountIn, quoteOut, gate, quote, poolPrice, inN, outN };
}

export interface LiveEnv { DB: D1Database; LIVE_MODE?: string; LIVE_START_HOUR?: string; LIVE_KEY?: string }
export const liveMode = (env: LiveEnv): Mode => (env.LIVE_MODE === "live" || env.LIVE_MODE === "dry_run" ? env.LIVE_MODE : "off");

interface OrderRow { hour: number; mode: Mode; status: string; usd_in: number | null; cash_after: number; qty_after: number; equity_after: number | null }

async function bookOf(db: D1Database, mode: Mode): Promise<Book> {
  const r = await db.prepare("SELECT cash_after, qty_after FROM live_orders WHERE mode = ? ORDER BY hour DESC LIMIT 1").bind(mode).first<OrderRow>();
  return r ? { cash: r.cash_after, qty: r.qty_after } : { cash: LIVE.caps.startUsdg, qty: 0 };
}

async function haltedOf(db: D1Database, mode: Mode): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM live_state WHERE key = ?").bind(`halted:${mode}`).first<{ value: string }>();
  return r?.value ?? null;
}

/** Acts on every sealed, unhandled decision of the mirrored agent. Called by the hourly cron after sealing. */
export async function runLive(env: LiveEnv, pub: PublicClient, nowSec: number): Promise<unknown[]> {
  const mode = liveMode(env);
  if (mode === "off") return [];
  const start = Number(env.LIVE_START_HOUR ?? 0);
  const db = env.DB;
  const { results: pending } = await db
    .prepare(
      `SELECT d.hour, d.action, d.record, l.leaf, s.root FROM decisions d
         JOIN seals s ON s.hour = d.hour AND s.status = 'confirmed'
         LEFT JOIN leaves l ON l.hour = d.hour AND l.subject = d.agent
         LEFT JOIN live_orders o ON o.hour = d.hour AND o.mode = ?
        WHERE d.agent = ? AND d.hour >= ? AND d.hour >= ? AND o.hour IS NULL
        ORDER BY d.hour`,
    )
    .bind(mode, LIVE.agent, start, nowSec - 3600 - LIVE.caps.actWithinSec)
    .all<{ hour: number; action: string; record: string; leaf: string | null; root: string }>();
  const out: unknown[] = [];
  for (const p of pending) {
    const rec = JSON.parse(p.record) as { action: string; size_usd?: number };
    const d: Decision = { hour: p.hour, action: rec.action === "buy" || rec.action === "sell" ? rec.action : "hold", sizeUsd: Number(rec.size_usd ?? 0) || 100, leaf: p.leaf };
    if (d.action === "hold") continue; // nothing to record for a hold
    // The seal must be on chain, with the same root we stored, before we act.
    const onchain = await pub.readContract({ address: LIVE.registry, abi: SEAL_OF, functionName: "sealOf", args: [BigInt(p.hour)] });
    if (onchain.root.toLowerCase() !== p.root.toLowerCase()) { out.push({ hour: p.hour, skipped: "seal not on chain yet" }); continue; }
    out.push(await actOn(env, pub, mode, d, Number(onchain.sealedAt), nowSec));
  }
  return out;
}

async function actOn(env: LiveEnv, pub: PublicClient, mode: Mode, d: Decision, sealedAt: number, nowSec: number) {
  const db = env.DB;
  let book = await bookOf(db, mode);
  const live = mode === "live";
  const account = live && env.LIVE_KEY ? privateKeyToAccount(env.LIVE_KEY as Hex) : null;
  if (live && !account) return record(db, mode, d, nowSec, sealedAt, { status: "skipped", reason: "LIVE_KEY is not set" }, book, null);
  if (account) {
    const [u, t] = await Promise.all([
      pub.readContract({ address: LIVE.usdg.address, abi: ERC20, functionName: "balanceOf", args: [account.address] }),
      pub.readContract({ address: LIVE.token.address, abi: ERC20, functionName: "balanceOf", args: [account.address] }),
    ]);
    book = { cash: fromUnits(u, LIVE.usdg.decimals), qty: fromUnits(t, LIVE.token.decimals) };
  }
  const day = nowSec - (nowSec % 86400);
  const spent = (await db.prepare("SELECT COALESCE(SUM(usd_in), 0) AS s FROM live_orders WHERE mode = ? AND status = 'filled' AND action = 'buy' AND created_at >= ?").bind(mode, day).first<{ s: number }>())?.s ?? 0;
  const plan = planOrder(d, book, spent, await haltedOf(db, mode));
  if (plan.do === "skip") return record(db, mode, d, nowSec, sealedAt, { status: "skipped", reason: plan.reason }, book, null);

  const buy = plan.do === "buy";
  const { tokenIn, tokenOut, amountIn, quoteOut, gate, quote, poolPrice, inN, outN } = await quoteAndGate(pub, plan, nowSec);
  if (!gate.ok) {
    const res = await record(db, mode, d, nowSec, sealedAt, { status: "blocked", reason: `price gate: ${gate.reason}`, ...quote }, book, gate.feedPrice);
    await checkHalt(db, mode, book, gate.feedPrice ?? poolPrice ?? 0);
    return res;
  }

  let txHash: string | null = null, approveTx: string | null = null, gotOut = outN, gasUsed: number | null = null, blockNumber: number | null = null;
  if (account) {
    const wallet = createWalletClient({ account, chain: robinhood, transport: fallback(PUBLIC_RPCS.map((u) => http(u, { timeout: 15_000 }))) });
    const allowance = await pub.readContract({ address: tokenIn.address, abi: ERC20, functionName: "allowance", args: [account.address, LIVE.router] });
    if (allowance < amountIn) {
      // Approve exactly this order's amount: the router can never pull more than one order.
      approveTx = await wallet.writeContract({ address: tokenIn.address, abi: ERC20, functionName: "approve", args: [LIVE.router, amountIn] });
      await pub.waitForTransactionReceipt({ hash: approveTx as Hex, timeout: 45_000 });
    }
    const before = await pub.readContract({ address: tokenOut.address, abi: ERC20, functionName: "balanceOf", args: [account.address] });
    txHash = await wallet.writeContract({ address: LIVE.router, abi: ROUTER, functionName: "exactInputSingle", args: [{ tokenIn: tokenIn.address, tokenOut: tokenOut.address, fee: LIVE.fee, recipient: account.address, amountIn, amountOutMinimum: minOut(quoteOut), sqrtPriceLimitX96: 0n }] });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 45_000 });
    if (receipt.status !== "success") return record(db, mode, d, nowSec, sealedAt, { status: "failed", reason: "swap reverted", tx_hash: txHash, approve_tx: approveTx, ...quote }, book, gate.feedPrice);
    const after = await pub.readContract({ address: tokenOut.address, abi: ERC20, functionName: "balanceOf", args: [account.address] });
    gotOut = fromUnits(after - before, tokenOut.decimals);
    gasUsed = Number(receipt.gasUsed);
    blockNumber = Number(receipt.blockNumber);
  }
  const next: Book = buy ? { cash: book.cash - inN, qty: book.qty + gotOut } : { cash: book.cash + gotOut, qty: book.qty - inN > DUST ? book.qty - inN : 0 };
  const res = await record(db, mode, d, nowSec, sealedAt, { status: "filled", reason: null, tx_hash: txHash, approve_tx: approveTx, amount_out: gotOut, gas_used: gasUsed, block_number: blockNumber, ...quote }, next, gate.feedPrice, buy ? inN : null);
  await checkHalt(db, mode, next, gate.feedPrice ?? poolPrice ?? 0);
  return res;
}

async function checkHalt(db: D1Database, mode: Mode, book: Book, price: number) {
  if (!(price > 0)) return; // no trustworthy price: never halt on a guess
  const { results } = await db.prepare("SELECT status FROM live_orders WHERE mode = ? AND status IN ('filled', 'blocked') ORDER BY hour DESC LIMIT ?").bind(mode, LIVE.caps.gateFailStop).all<{ status: string }>();
  let streak = 0;
  for (const r of results) { if (r.status === "blocked") streak++; else break; }
  const why = haltReason(book.cash + book.qty * price, streak);
  if (why) await db.prepare("INSERT INTO live_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").bind(`halted:${mode}`, why).run();
}

async function record(db: D1Database, mode: Mode, d: Decision, nowSec: number, sealedAt: number, f: Record<string, unknown>, book: Book, price: number | null, usdIn: number | null = null) {
  const equity = price === null ? null : book.cash + book.qty * price;
  const row = {
    mode, agent: LIVE.agent, market: LIVE.market, decision_hour: d.hour, decision_leaf: d.leaf, decision_sealed_at: sealedAt, action: d.action,
    pool: LIVE.pool, caps: LIVE.caps, cash_after: round(book.cash), qty_after: round(book.qty, 9), equity_after: equity === null ? null : round(equity), ...f,
  };
  await db
    .prepare("INSERT INTO live_orders (hour, mode, action, status, reason, usd_in, tx_hash, cash_after, qty_after, equity_after, created_at, created_hour, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(d.hour, mode, d.action, String(f.status), (f.reason as string | null) ?? null, usdIn, (f.tx_hash as string | null) ?? null, row.cash_after, row.qty_after, row.equity_after, nowSec, nowSec - (nowSec % 3600), JSON.stringify(row))
    .run();
  return { hour: d.hour, status: f.status, reason: f.reason ?? null };
}

const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

/** Public view for /live and /api/v1/live. */
export async function liveView(env: LiveEnv) {
  const mode = liveMode(env);
  const wallet = env.LIVE_KEY ? privateKeyToAccount(env.LIVE_KEY as Hex).address : null;
  const books: Record<string, unknown> = {};
  for (const m of ["dry_run", "live"] as const) {
    const { results } = await env.DB.prepare("SELECT record FROM live_orders WHERE mode = ? ORDER BY hour DESC LIMIT 200").bind(m).all<{ record: string }>();
    if (!results.length && m !== mode) continue;
    const orders = results.map((r) => JSON.parse(r.record) as Record<string, unknown>);
    const last = orders[0] as { cash_after?: number; qty_after?: number; equity_after?: number | null } | undefined;
    books[m] = {
      start_usdg: LIVE.caps.startUsdg,
      cash_usdg: last?.cash_after ?? LIVE.caps.startUsdg,
      qty: last?.qty_after ?? 0,
      equity_usdg: last?.equity_after ?? LIVE.caps.startUsdg,
      halted: await haltedOf(env.DB, m),
      orders,
    };
  }
  return {
    mode,
    started_from_hour: Number(env.LIVE_START_HOUR ?? 0) || null,
    wallet,
    agent: LIVE.agent,
    market: LIVE.market,
    chain_id: LIVE.chainId,
    pool: LIVE.pool,
    venue: "Uniswap v3 NVDA/USDG 0.05% on Robinhood Chain",
    contracts: { usdg: LIVE.usdg.address, token: LIVE.token.address, feed: LIVE.feed, quoter: LIVE.quoter, router: LIVE.router, registry: LIVE.registry },
    caps: LIVE.caps,
    order_of_events: "Decision in hour H, sealed in the root of H, confirmed on SealRegistry, then the price gate, then the swap. The order is sealed as a Fill leaf in the next root.",
    team_money_only: "No deposits from anyone, no payouts to anyone. Not investment advice.",
    books,
  };
}
