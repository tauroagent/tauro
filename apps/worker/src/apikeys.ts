/**
 * Read API limits. Anyone can read without a key, limited per IP. Holding TAURO raises the limit:
 * a wallet signs one message (no transaction) to get a key, and the key's tier follows the wallet's
 * TAURO balance, read on chain when the key is made and again at most once an hour.
 * Only /api/* and /mcp are limited; pages are not.
 */
import { isAddress, isHex, keccak256, toHex, type Hex, type PublicClient } from "viem";
import { balancesOf, issuedOk, sigHash, tokens } from "./holders.js";

const UNIT = 10n ** 18n;
export const API_TIERS = [
  { tier: "open", min: 0n, perMinute: 120 },
  { tier: "holder", min: 1_000_000n * UNIT, perMinute: 1_200 },
  { tier: "holder_plus", min: 5_000_000n * UNIT, perMinute: 6_000 },
] as const;
export type ApiTier = (typeof API_TIERS)[number]["tier"];
export const RECHECK_SEC = 3600;

export function tierFor(balance: bigint): (typeof API_TIERS)[number] {
  let t: (typeof API_TIERS)[number] = API_TIERS[0];
  for (const x of API_TIERS) if (balance >= x.min) t = x;
  return t;
}

export const limitRules = () => ({
  tiers: API_TIERS.map((t) => ({ tier: t.tier, min_tauro: tokens(t.min), requests_per_minute: t.perMinute })),
  limited: "Only /api/* and /mcp. Without a key the limit is per IP. Limits are approximate and counted per Cloudflare location, so short bursts can pass before a 429.",
  key: "POST /api/v1/keys with a signed message (no transaction). Send the key as the x-tauro-key header. The tier follows the wallet's TAURO balance, re-read on chain at most once an hour.",
  never: "Keys never unlock writes, data others cannot see, or anything paid. Holding TAURO only raises limits.",
});

export function keyMessage(address: string, issued: string): string {
  return ["Tauro: API key", `Wallet: ${address.toLowerCase()}`, `Issued: ${issued}`, "Read-only. This signature sends no transaction and costs nothing."].join("\n");
}

export const keyHash = (key: string): string => keccak256(toHex(key));
const newKey = (): string => "tk_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

export interface KeyRow { address: string; key_hash: string; tier: ApiTier; balance: string | null; checked_at: number; created_at: number }

type Json = (body: unknown, init?: { status?: number; maxAge?: number }) => Response;
type Balance = (address: string) => Promise<bigint | null>;
export const chainBalance = (c: PublicClient): Balance => async (a) => (await balancesOf(c, [a.toLowerCase()])).get(a.toLowerCase()) ?? null;

/** The key's tier, re-reading the balance if the last read is older than RECHECK_SEC. A failed read keeps the last tier. */
export async function currentTier(db: D1Database, row: KeyRow, balance: Balance, now: number): Promise<KeyRow> {
  if (now - row.checked_at < RECHECK_SEC) return row;
  const bal = await balance(row.address).catch(() => null);
  if (bal === null) return row;
  const t = tierFor(bal).tier;
  await db.prepare("UPDATE api_keys SET tier = ?, balance = ?, checked_at = ? WHERE address = ?").bind(t, bal.toString(), now, row.address).run();
  return { ...row, tier: t, balance: bal.toString(), checked_at: now };
}

export async function lookupKey(db: D1Database, key: string): Promise<KeyRow | null> {
  return db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").bind(keyHash(key)).first<KeyRow>();
}

const view = (r: KeyRow) => {
  const t = API_TIERS.find((x) => x.tier === r.tier)!;
  return { address: r.address, tier: r.tier, requests_per_minute: t.perMinute, balance_tauro: r.balance === null ? null : tokens(BigInt(r.balance)), checked_at: new Date(r.checked_at * 1000).toISOString() };
};

export async function keysRoute(req: Request, db: D1Database, c: PublicClient, json: Json, balance: Balance = chainBalance(c)): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  if (req.method === "GET") {
    const key = req.headers.get("x-tauro-key") ?? "";
    if (!key) return json({ ...limitRules(), message_format: keyMessage("0x<your wallet>", "<ISO time>") }, { maxAge: 300 });
    const row = await lookupKey(db, key);
    if (!row) return json({ error: "unknown key" }, { status: 401, maxAge: 0 });
    return json(view(await currentTier(db, row, balance, now)), { maxAge: 0 });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, { status: 405, maxAge: 0 });
  const b = (await req.json().catch(() => ({}))) as { address?: string; issued?: string; signature?: string };
  const address = (b.address ?? "").toLowerCase();
  if (!isAddress(address)) return json({ error: "address must be a 0x wallet address" }, { status: 400, maxAge: 0 });
  if (!b.issued || !issuedOk(b.issued, now)) return json({ error: "issued must be an ISO time from the last 10 minutes" }, { status: 400, maxAge: 0 });
  if (!b.signature || !isHex(b.signature)) return json({ error: "signature missing" }, { status: 400, maxAge: 0 });
  const ok = await c.verifyMessage({ address: address as Hex, message: keyMessage(address, b.issued), signature: b.signature as Hex }).catch(() => false);
  if (!ok) return json({ error: "signature does not match this wallet and text", message: keyMessage(address, b.issued) }, { status: 401, maxAge: 0 });
  const used = await db.prepare("SELECT 1 FROM api_keys WHERE sig_hash = ?").bind(sigHash(b.signature)).first();
  if (used) return json({ error: "this signature was already used; sign a new message" }, { status: 409, maxAge: 0 });
  const bal = await balance(address);
  if (bal === null) return json({ error: "could not read the TAURO balance on chain; try again" }, { status: 503, maxAge: 0 });
  const t = tierFor(bal);
  if (t.tier === "open") return json({ error: `This wallet holds ${tokens(bal).toLocaleString("en-US")} TAURO. A key needs at least 1,000,000; without one the API is open at 120 requests a minute.`, ...limitRules() }, { status: 403, maxAge: 0 });
  const key = newKey();
  await db
    .prepare("INSERT INTO api_keys (address, key_hash, sig_hash, tier, balance, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET key_hash = excluded.key_hash, sig_hash = excluded.sig_hash, tier = excluded.tier, balance = excluded.balance, checked_at = excluded.checked_at, created_at = excluded.created_at")
    .bind(address, keyHash(key), sigHash(b.signature), t.tier, bal.toString(), now, now)
    .run();
  return json({ key, note: "Shown once; only its hash is stored. Send it as the x-tauro-key header. Making a new key replaces this one.", ...view({ address, key_hash: "", tier: t.tier, balance: bal.toString(), checked_at: now, created_at: now }) }, { status: 201, maxAge: 0 });
}

export interface Limiters { open?: RateLimit | undefined; holder?: RateLimit | undefined; holder_plus?: RateLimit | undefined }

/** null = go ahead; otherwise the 401/429 response. Also returns the tier, for a response header. */
export async function limit(req: Request, db: D1Database, rl: Limiters, balance: Balance): Promise<{ deny: Response | null; tier: ApiTier; perMinute: number; checked?: boolean }> {
  const key = req.headers.get("x-tauro-key");
  let tier: ApiTier = "open", id = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (key) {
    const row = await lookupKey(db, key);
    if (!row) return { deny: new Response(JSON.stringify({ error: "unknown key", ...limitRules() }), { status: 401, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }), tier, perMinute: 120 };
    const cur = await currentTier(db, row, balance, Math.floor(Date.now() / 1000));
    tier = cur.tier;
    id = cur.address;
  }
  const perMinute = API_TIERS.find((t) => t.tier === tier)!.perMinute;
  const limiter = rl[tier];
  if (limiter) {
    const { success } = await limiter.limit({ key: `${tier}:${id}` });
    if (!success)
      return {
        deny: new Response(JSON.stringify({ error: `rate limit: ${perMinute} requests a minute for tier ${tier}`, ...limitRules() }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60", "access-control-allow-origin": "*", "x-tauro-tier": tier } }),
        tier,
        perMinute,
      };
  }
  return { deny: null, tier, perMinute, checked: Boolean(limiter) };
}
