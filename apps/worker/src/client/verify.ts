// Runs in the browser. Rebuilds a sealed leaf from its public record and checks it against the
// root stored in SealRegistry, read straight from a public Robinhood Chain RPC.
import { concat, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, stringToBytes, type Hex } from "viem";

const REGISTRY = "0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14";
const RPCS = ["https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com"];
const ABI = [
  { type: "function", name: "sealOf", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "tuple", components: [{ name: "root", type: "bytes32" }, { name: "leafCount", type: "uint32" }, { name: "sealedAt", type: "uint64" }] }] },
  { type: "function", name: "verify", stateMutability: "view", inputs: [{ type: "uint64" }, { type: "bytes32" }, { type: "bytes32[]" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "onTime", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "bool" }] },
] as const;

async function call(data: Hex): Promise<Hex> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: REGISTRY, data }, "latest"] }) });
      const j = (await r.json()) as { result?: Hex; error?: { message: string } };
      if (j.result) return j.result;
      last = j.error?.message;
    } catch (e) { last = e; }
  }
  throw new Error(`RPC failed: ${String(last)}`);
}

const form = document.querySelector<HTMLFormElement>("[data-verify-form]")!;
const sel = document.getElementById("v-hour") as HTMLSelectElement;
const subj = document.getElementById("v-subject") as HTMLInputElement;
const out = document.querySelector<HTMLUListElement>("[data-verify-out]")!;
const rec = document.querySelector<HTMLPreElement>("[data-verify-record]")!;
const params = new URLSearchParams(location.search);
const fmt = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function line(ok: boolean | null, text: string, detail = ""): void {
  const li = document.createElement("li");
  li.className = ok === null ? "" : ok ? "ok" : "bad";
  li.innerHTML = `<span class="mk" aria-hidden="true">${ok === null ? "·" : ok ? "✓" : "✗"}</span><span></span>`;
  const span = li.lastElementChild as HTMLSpanElement;
  span.textContent = (ok === null ? "" : ok ? "Pass: " : "Fail: ") + text;
  if (detail) { const s = document.createElement("small"); s.textContent = detail; span.append(s); }
  out.append(li);
}

async function loadHours(): Promise<void> {
  try {
    const j = (await (await fetch("/api/v1/seals?hours=500")).json()) as { seals: { hour: number; status: string }[] };
    const ok = j.seals.filter((s) => s.status === "confirmed");
    sel.innerHTML = ok.length ? ok.map((s) => `<option value="${s.hour}">${fmt(s.hour)}</option>`).join("") : '<option value="">No sealed hours yet</option>';
    const want = params.get("hour");
    if (want && ok.some((s) => String(s.hour) === want)) sel.value = want;
  } catch {
    sel.innerHTML = '<option value="">Could not load hours</option>';
  }
}

async function run(hour: string, subject: string): Promise<void> {
  out.innerHTML = "";
  rec.textContent = "Loading…";
  try {
    const r = await fetch(`/api/v1/proof?hour=${encodeURIComponent(hour)}&subject=${encodeURIComponent(subject)}`);
    const p = (await r.json()) as { error?: string; kind: number; subject: string; hour: number; record_canonical: string; leaf: Hex; proof: Hex[]; root: Hex };
    if (!r.ok || p.error) { line(false, p.error ?? `HTTP ${r.status}`); rec.textContent = "Nothing."; return; }
    rec.textContent = JSON.stringify(JSON.parse(p.record_canonical), null, 2);
    line(true, "Fetched the public record and its proof", `${p.proof.length} proof steps`);

    const enc = encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }, { type: "uint64" }, { type: "bytes32" }], [p.kind, keccak256(stringToBytes(p.subject)), BigInt(p.hour), keccak256(stringToBytes(p.record_canonical))]);
    const leaf = keccak256(keccak256(enc));
    line(leaf === p.leaf, "Leaf rebuilt in your browser from the record", leaf);

    let h: Hex = leaf;
    for (const s of p.proof) h = BigInt(h) < BigInt(s) ? keccak256(concat([h, s])) : keccak256(concat([s, h]));
    line(h === p.root, "Proof walks to the hour's root", h);

    const seal = decodeFunctionResult({ abi: ABI, functionName: "sealOf", data: await call(encodeFunctionData({ abi: ABI, functionName: "sealOf", args: [BigInt(p.hour)] })) });
    line(seal.root.toLowerCase() === h.toLowerCase(), "Same root is stored on Robinhood Chain", `SealRegistry.sealOf: ${seal.root}`);

    const v = decodeFunctionResult({ abi: ABI, functionName: "verify", data: await call(encodeFunctionData({ abi: ABI, functionName: "verify", args: [BigInt(p.hour), leaf, p.proof] })) });
    line(v, "The contract's own verify() accepts the leaf");

    const t = decodeFunctionResult({ abi: ABI, functionName: "onTime", data: await call(encodeFunctionData({ abi: ABI, functionName: "onTime", args: [BigInt(p.hour)] })) });
    line(t, "Sealed before the next hourly close", `Sealed at ${fmt(Number(seal.sealedAt))}, deadline ${fmt(p.hour + 7200)}`);
  } catch (e) {
    line(false, "Could not finish the check", String(e));
  }
}

if (params.get("subject")) subj.value = params.get("subject")!;
form.addEventListener("submit", (e) => { e.preventDefault(); if (sel.value) void run(sel.value, subj.value.trim()); });
await loadHours();
if (params.get("hour") && sel.value) void run(sel.value, subj.value.trim());
