export {};
// Holder agents: connect a wallet, read its slots, sign a launch message. Also the /token page forms.
// The message text must match launchMessage() in src/holders.ts exactly; the server rebuilds it.

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const eth = (): Eth | undefined => (window as unknown as { ethereum?: Eth }).ethereum;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s);
const fmt = (n: number | null | undefined) => (n == null ? "n/a" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Tier {
  address: string; balance_tauro: number | null; hold_slots: number | null; burn_slots: number; slots: number | null; in_use: number;
  agents: { agent: string; market: string; template: string; status: string; status_reason: string | null }[];
}

async function getTier(address: string): Promise<Tier> {
  const r = await fetch(`/api/v1/tier?address=${encodeURIComponent(address)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "lookup failed");
  return j as Tier;
}

function tierHtml(t: Tier): string {
  const agents = t.agents.length
    ? `<ul style="margin:8px 0 0;padding-left:18px">${t.agents.map((a) => `<li><a href="/agents/${esc(a.agent)}">${esc(a.template.replace(/_/g, " "))} · ${esc(a.market)}</a>: ${esc(a.status)}${a.status_reason ? ` <span class="dim">(${esc(a.status_reason)})</span>` : ""}</li>`).join("")}</ul>`
    : "";
  return `<dl class="facts"><dt>TAURO held</dt><dd>${fmt(t.balance_tauro)}</dd><dt>Slots</dt><dd>${t.slots ?? "n/a"} (${t.hold_slots ?? 0} from holding, ${t.burn_slots} from burns)</dd><dt>In use</dt><dd>${t.in_use}</dd></dl>${agents}`;
}

// ---- studio: run it as your agent
const panel = $<HTMLElement>("[data-holder]");
if (panel) {
  const msg = $<HTMLElement>("[data-holder-msg]")!;
  const walletEl = $<HTMLElement>("[data-wallet]")!;
  const launchBtn = $<HTMLButtonElement>("[data-launch]")!;
  let account = "";
  const say = (text: string, ok = false, html = false) => { msg.className = ok ? "holder-ok" : "holder-err"; if (html) msg.innerHTML = text; else msg.textContent = text; };

  const refresh = async () => {
    const t = await getTier(account);
    walletEl.textContent = `${account.slice(0, 6)}…${account.slice(-4)} · ${fmt(t.balance_tauro)} TAURO · ${t.in_use}/${t.slots ?? "?"} slots used`;
    launchBtn.hidden = false;
    launchBtn.disabled = t.slots === null || t.in_use >= t.slots;
    if (t.slots === 0) say("This wallet has no slot yet. Hold 1,000,000 TAURO, or burn TAURO on the $TAURO page.");
    else if (t.slots !== null && t.in_use >= t.slots) say("All your slots are in use. Retire an agent or add a slot.");
    else msg.textContent = "";
  };

  $<HTMLButtonElement>("[data-connect]")!.addEventListener("click", async () => {
    const e = eth();
    if (!e) return say("No wallet found in this browser. Open this page in a browser with a wallet extension, or a wallet app's browser.");
    try {
      account = ((await e.request({ method: "eth_requestAccounts" })) as string[])[0]!.toLowerCase();
      await refresh();
    } catch (err) { say((err as Error).message || "Wallet connection was declined."); }
  });

  launchBtn.addEventListener("click", async () => {
    const e = eth(); if (!e || !account) return;
    const template = document.querySelector<HTMLElement>('[data-template][aria-pressed="true"]')?.dataset.template ?? "momentum";
    const market = $<HTMLSelectElement>("#s-market")!.value;
    const stopLossPct = Number($<HTMLInputElement>("#s-stop")!.value) || 3;
    const sizeUsd = Number($<HTMLInputElement>("#s-size")!.value) || 100;
    const issued = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const message = [
      "Tauro: run my paper agent", `Owner: ${account}`, `Strategy: ${template}`, `Market: ${market}`, `Stop loss: ${stopLossPct}%`, `Order size: $${sizeUsd}`,
      `Issued: ${issued}`, "Paper only. This signature sends no transaction and costs nothing.",
    ].join("\n");
    try {
      launchBtn.disabled = true;
      const signature = (await e.request({ method: "personal_sign", params: [message, account] })) as string;
      const r = await fetch("/api/v1/agents/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: account, template, market, stopLossPct, sizeUsd, issued, signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "launch failed");
      say(`Queued: <code>${esc(j.agent)}</code>. It starts at the next hourly run, and its rules are sealed in that hour.`, true, true);
      await refresh();
    } catch (err) {
      say((err as Error).message || "Signing was declined.");
      launchBtn.disabled = false;
    }
  });
}

// ---- /token: check a wallet, record a burn
const tierForm = $<HTMLFormElement>("[data-tier-form]");
tierForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = $<HTMLElement>("[data-tier-out]")!;
  const addr = (new FormData(tierForm).get("address") as string).trim();
  out.textContent = "Reading from chain…";
  try { out.innerHTML = tierHtml(await getTier(addr)); } catch (e) { out.innerHTML = `<span class="holder-err">${esc((e as Error).message)}</span>`; }
});

const burnForm = $<HTMLFormElement>("[data-burn-form]");
burnForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = $<HTMLElement>("[data-burn-out]")!;
  const tx = (new FormData(burnForm).get("tx") as string).trim();
  out.textContent = "Checking the transaction on chain…";
  try {
    const r = await fetch("/api/v1/burns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "not recorded");
    out.innerHTML = `<span class="holder-ok">Recorded: ${fmt(j.tauro)} TAURO from ${esc(j.owner.slice(0, 6))}…${esc(j.owner.slice(-4))}, ${j.slots} slot${j.slots > 1 ? "s" : ""} until ${esc(j.expires_at.slice(0, 10))}.</span>`;
  } catch (e) { out.innerHTML = `<span class="holder-err">${esc((e as Error).message)}</span>`; }
});
