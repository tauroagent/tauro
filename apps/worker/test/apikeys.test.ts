import type { PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { API_TIERS, keyHash, keyMessage, keysRoute, limit, tierFor, type KeyRow } from "../src/apikeys.js";

const UNIT = 10n ** 18n;
const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const addr = acct.address.toLowerCase();

/** In-memory stand-in for the four api_keys queries. */
function fakeDb() {
  const rows = new Map<string, KeyRow & { sig_hash: string }>();
  const db = {
    rows,
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              if (sql.startsWith("SELECT 1 FROM api_keys WHERE sig_hash")) return [...rows.values()].some((r) => r.sig_hash === a[0]) ? { 1: 1 } : null;
              if (sql.startsWith("SELECT * FROM api_keys WHERE key_hash")) return [...rows.values()].find((r) => r.key_hash === a[0]) ?? null;
              throw new Error(sql);
            },
            async run() {
              if (sql.startsWith("INSERT INTO api_keys")) {
                const [address, key_hash, sig_hash, tier, balance, checked_at, created_at] = a as [string, string, string, KeyRow["tier"], string, number, number];
                rows.set(address, { address, key_hash, sig_hash, tier, balance, checked_at, created_at });
              } else if (sql.startsWith("UPDATE api_keys")) {
                const [tier, balance, checked_at, address] = a as [KeyRow["tier"], string, number, string];
                Object.assign(rows.get(address)!, { tier, balance, checked_at });
              } else throw new Error(sql);
              return {};
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database & { rows: typeof rows };
}
const json = (body: unknown, init: { status?: number } = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200 });
const chain = { verifyMessage: async ({ address, message, signature }: { address: string; message: string; signature: string }) => (await import("viem")).verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }) } as unknown as PublicClient;

async function ask(db: D1Database, balance: bigint | null, opts: { issued?: string; sign?: string } = {}) {
  const issued = opts.issued ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const signature = await acct.signMessage({ message: opts.sign ?? keyMessage(addr, issued) });
  const req = new Request("https://x/api/v1/keys", { method: "POST", body: JSON.stringify({ address: addr, issued, signature }) });
  const res = await keysRoute(req, db, chain, json, async () => balance);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("api keys", () => {
  it("maps balances to tiers", () => {
    expect(tierFor(0n).tier).toBe("open");
    expect(tierFor(999_999n * UNIT).tier).toBe("open");
    expect(tierFor(1_000_000n * UNIT).tier).toBe("holder");
    expect(tierFor(5_000_000n * UNIT).tier).toBe("holder_plus");
    expect(API_TIERS.map((t) => t.perMinute)).toEqual([120, 1200, 6000]);
  });

  it("gives a holder a key once per signature and stores only its hash", async () => {
    const db = fakeDb();
    const r = await ask(db, 2_000_000n * UNIT);
    expect(r.status).toBe(201);
    expect(r.body.tier).toBe("holder");
    expect(String(r.body.key)).toMatch(/^tk_[0-9a-f]{48}$/);
    expect(db.rows.get(addr)!.key_hash).toBe(keyHash(String(r.body.key)));
    expect(JSON.stringify([...db.rows.values()])).not.toContain(String(r.body.key));
  });

  it("refuses wallets under 1,000,000 TAURO, wrong text and stale times", async () => {
    expect((await ask(fakeDb(), 10n * UNIT)).status).toBe(403);
    expect((await ask(fakeDb(), 2_000_000n * UNIT, { sign: "something else" })).status).toBe(401);
    expect((await ask(fakeDb(), 2_000_000n * UNIT, { issued: "2020-01-01T00:00:00Z" })).status).toBe(400);
  });

  it("limits by tier: open per IP, holders per wallet, unknown keys refused", async () => {
    const db = fakeDb();
    const { body } = await ask(db, 6_000_000n * UNIT);
    const seen: string[] = [];
    const rl = (ok: boolean) => ({ limit: async ({ key }: { key: string }) => (seen.push(key), { success: ok }) }) as RateLimit;
    const bal = async () => 6_000_000n * UNIT;
    const open = await limit(new Request("https://x/api/v1/markets", { headers: { "cf-connecting-ip": "1.2.3.4" } }), db, { open: rl(true) }, bal);
    expect([open.deny, open.tier]).toEqual([null, "open"]);
    const plus = await limit(new Request("https://x/api/v1/markets", { headers: { "x-tauro-key": String(body.key) } }), db, { holder_plus: rl(true) }, bal);
    expect([plus.deny, plus.tier, plus.perMinute]).toEqual([null, "holder_plus", 6000]);
    expect(seen).toEqual(["open:1.2.3.4", `holder_plus:${addr}`]);
    expect((await limit(new Request("https://x/api/v1/markets", { headers: { "x-tauro-key": "tk_nope" } }), db, {}, bal)).deny!.status).toBe(401);
    expect((await limit(new Request("https://x/api/v1/markets"), db, { open: rl(false) }, bal)).deny!.status).toBe(429);
  });

  it("re-reads the balance after an hour and lowers the tier when it drops", async () => {
    const db = fakeDb();
    const { body } = await ask(db, 2_000_000n * UNIT);
    db.rows.get(addr)!.checked_at -= 3601;
    const l = await limit(new Request("https://x/api/v1/markets", { headers: { "x-tauro-key": String(body.key) } }), db, {}, async () => 10n * UNIT);
    expect(l.tier).toBe("open");
  });
});
