// Sealed calls: connect a wallet, sign a call, POST it. The text must match callMessage() in src/calls.ts.
type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const eth = (): Eth | undefined => (window as unknown as { ethereum?: Eth }).ethereum;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const root = $<HTMLElement>("[data-call]");
if (root) {
  const msg = $<HTMLElement>("[data-call-msg]")!;
  const walletEl = $<HTMLElement>("[data-wallet]")!;
  const signBtn = $<HTMLButtonElement>("[data-sign]")!;
  let account = "";
  let side = "up";
  const say = (t: string, ok = false, html = false) => { msg.className = ok ? "holder-ok" : "holder-err"; if (html) msg.innerHTML = t; else msg.textContent = t; };
  document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((b) => b.addEventListener("click", () => {
    side = b.dataset.side!;
    document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  $<HTMLButtonElement>("[data-connect]")!.addEventListener("click", async () => {
    const e = eth();
    if (!e) return say("No wallet found in this browser. Open this page in a browser with a wallet extension, or a wallet app's browser.");
    try {
      account = ((await e.request({ method: "eth_requestAccounts" })) as string[])[0]!.toLowerCase();
      walletEl.textContent = `Signing as ${account.slice(0, 6)}…${account.slice(-4)}`;
      signBtn.hidden = false;
    } catch (err) { say((err as Error).message || "Wallet connection was declined."); }
  });
  signBtn.addEventListener("click", async () => {
    const e = eth(); if (!e || !account) return;
    const market = $<HTMLSelectElement>("#c-market")!.value;
    const horizon = Number($<HTMLSelectElement>("#c-horizon")!.value);
    const note = $<HTMLInputElement>("#c-note")!.value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    const issued = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const message = ["Tauro: seal my call", `Caller: ${account}`, `Market: ${market}`, `Call: ${side}`, `Within: ${horizon} hours`, `Note: ${note || "-"}`, `Issued: ${issued}`, "Paper only. This signature sends no transaction and costs nothing."].join("\n");
    try {
      signBtn.disabled = true;
      const signature = (await e.request({ method: "personal_sign", params: [message, account] })) as string;
      const r = await fetch("/api/v1/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caller: account, market, side, horizon, note, issued, signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "not sealed");
      say(`Signed. It is sealed in the ${esc(j.sealed_hour_utc.slice(11, 16))} UTC root. <a href="${esc(j.page)}">Your call page</a> (share it).`, true, true);
    } catch (err) { say((err as Error).message || "Signing was declined."); }
    finally { signBtn.disabled = false; }
  });
}
