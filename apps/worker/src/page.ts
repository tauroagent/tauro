// Server-rendered home page. Every number on it comes from D1 rows written by the ingester.

export interface Claim {
  id: string;
  text: string;
  status: string;
}

export interface MarketRow {
  symbol: string;
  name: string;
  feed: string;
  close: { hour: number; price: number; round_id: string; updated_at: number } | null;
}

export type HomeData =
  | { kind: "ok"; lastRun: { hour: number; ok: number; failed: number } | null; hoursIngested: number; markets: MarketRow[]; claims: Claim[] }
  | { kind: "error"; message: string; claims: Claim[] };

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const utc = (sec: number): string => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const STATUS_LABEL: Record<string, string> = { live: "Live", in_testing: "In testing", planned: "Planned" };

const price = (p: number): string => (p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toFixed(4));

function marketsSection(d: HomeData): string {
  if (d.kind === "error") {
    return `<p class="state" role="alert">The price table could not be loaded right now. The API at <a href="/api/v1/markets">/api/v1/markets</a> returns the same data.</p>`;
  }
  const withClose = d.markets.filter((m) => m.close);
  if (withClose.length === 0) {
    return `<p class="state">No hour has been ingested yet. The first close is written a minute after the next full hour.</p>`;
  }
  const rows = d.markets
    .map((m) => {
      const c = m.close;
      return `<tr>
  <th scope="row">${esc(m.symbol)}</th>
  <td class="name">${esc(m.name)}</td>
  <td class="num">${c ? price(c.price) : "no close"}</td>
  <td class="num dim">${c ? utc(c.updated_at) : ""}</td>
</tr>`;
    })
    .join("\n");
  const run = d.lastRun;
  return `<p class="meta">${d.hoursIngested} hour${d.hoursIngested === 1 ? "" : "s"} ingested so far.${
    run ? ` Last hour: ${utc(run.hour)}, ${run.ok} of ${run.ok + run.failed} feeds read.` : ""
  }</p>
<div class="scroll" tabindex="0" role="region" aria-label="Hourly closes table">
<table>
  <caption>Chainlink close of the last ingested hour, USD per share</caption>
  <thead><tr><th scope="col">Token</th><th scope="col">Company or fund</th><th scope="col" class="num">Close</th><th scope="col" class="num">Feed updated</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>`;
}

function claimsSection(claims: Claim[]): string {
  const rows = claims
    .map((c) => `<tr><td>${esc(c.text)}</td><td class="st st-${esc(c.status)}">${esc(STATUS_LABEL[c.status] ?? c.status)}</td></tr>`)
    .join("\n");
  return `<div class="scroll" tabindex="0" role="region" aria-label="Claims and status">
<table>
  <caption>Every public claim, from <a href="/api/v1/status">status.json</a></caption>
  <thead><tr><th scope="col">Claim</th><th scope="col">Status</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>`;
}

export function renderHome(d: HomeData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tauro: trading agents for Robinhood Chain stock tokens</title>
<meta name="description" content="Trading agents for Robinhood Chain stock tokens. Each hour's decisions will be sealed on chain before the next close. Open source.">
<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>
:root{
  --bg:#f7f5f0; --fg:#1b1a17; --dim:#57534b; --line:#d9d4c8; --accent:#7a1f12; --panel:#fffdf8;
  --live:#14532d; --testing:#7a4a00; --planned:#57534b;
  color-scheme: light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#141311; --fg:#ece8df; --dim:#a8a296; --line:#34312b; --accent:#f08a6c; --panel:#1b1a17;
    --live:#7fd19b; --testing:#e6b35a; --planned:#a8a296; color-scheme: dark;
  }
}
:root[data-theme="dark"]{
  --bg:#141311; --fg:#ece8df; --dim:#a8a296; --line:#34312b; --accent:#f08a6c; --panel:#1b1a17;
  --live:#7fd19b; --testing:#e6b35a; --planned:#a8a296; color-scheme: dark;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent);text-underline-offset:2px}
a:hover{text-decoration-thickness:2px}
a,button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px}
.mark{font-weight:700;font-size:18px;letter-spacing:.01em;color:var(--fg);text-decoration:none}
nav ul{list-style:none;display:flex;gap:4px;margin:0;padding:0;align-items:center}
nav a,nav button{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;color:var(--fg);font:inherit;font-size:15px}
nav button{background:none;border:1px solid var(--line);border-radius:6px;min-width:44px;justify-content:center}
nav button:hover{border-color:var(--fg)}
main{padding:40px 0 24px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.15;margin:0 0 16px;max-width:22ch}
.lead{font-size:18px;max-width:62ch;margin:0 0 12px}
.lead + p{max-width:62ch;color:var(--dim);margin:0}
section{margin-top:48px}
h2{font-size:20px;margin:0 0 8px}
.meta,.state{color:var(--dim);margin:0 0 12px}
.state{padding:16px;border:1px dashed var(--line);border-radius:6px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:15px}
caption{text-align:left;padding:10px 12px;color:var(--dim);font-size:14px;border-bottom:1px solid var(--line)}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
thead th{font-size:13px;color:var(--dim);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dim{color:var(--dim)}
.name{min-width:10ch}
.st{white-space:nowrap;font-weight:600}
.st-live{color:var(--live)} .st-in_testing{color:var(--testing)} .st-planned{color:var(--planned)}
ol{padding-left:20px;max-width:62ch} li{margin:6px 0}
footer{border-top:1px solid var(--line);margin-top:56px;padding:20px 0 32px;color:var(--dim);font-size:14px}
footer p{margin:4px 0;max-width:70ch}
@media (max-width:560px){ .name{display:none} th,td{padding:9px 10px} }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <a class="mark" href="/">Tauro</a>
    <nav aria-label="Main">
      <ul>
        <li><a href="https://github.com/tauroagent/tauro">GitHub</a></li>
        <li><a href="https://x.com/Tauro_Agent">X</a></li>
        <li><a href="/api/v1">API</a></li>
        <li><button type="button" id="theme" aria-label="Switch color theme">Theme</button></li>
      </ul>
    </nav>
  </div>
</header>
<main class="wrap">
  <h1>Trading agents for Robinhood Chain stock tokens.</h1>
  <p class="lead">Agents follow rules you can read. Each hour's decisions get sealed on chain before the next hour closes, so the log you see later is the one that existed at the time.</p>
  <p>This is being built in public. Live today: hourly closes for ${d.kind === "ok" ? d.markets.length : 35} stock tokens, read from Chainlink feeds on Robinhood Chain, with each hour's closes sealed on chain (<a href="/api/v1/seals">seals</a>). Agent decisions are not running yet.</p>

  <section aria-labelledby="closes">
    <h2 id="closes">Hourly closes</h2>
    ${marketsSection(d)}
  </section>

  <section aria-labelledby="hour">
    <h2 id="hour">What happens each hour, once agents run</h2>
    <ol>
      <li>The hour closes. Each agent's rules run on the closing prices and return buy, sell or hold, with the numbers they looked at.</li>
      <li>A real trade only goes ahead if the pool price is within 2% of Chainlink and the feed is fresh. Otherwise it is held, with the reason logged.</li>
      <li>Every decision becomes a leaf in a Merkle tree. The root is written to a contract on Robinhood Chain before the next close.</li>
      <li>Anyone can rebuild a decision, check its proof against that root, and see when the root landed.</li>
    </ol>
  </section>

  <section aria-labelledby="status">
    <h2 id="status">What is live and what is not</h2>
    ${claimsSection(d.claims)}
  </section>
</main>
<footer>
  <div class="wrap">
    <p>Open source under MIT: <a href="https://github.com/tauroagent/tauro">github.com/tauroagent/tauro</a>. Prices: <a href="/api/v1/markets">/api/v1/markets</a>, no key needed.</p>
    <p>Not affiliated with Robinhood or Chainlink. Not investment advice. Not available to US persons.</p>
  </div>
</footer>
<script>
document.getElementById("theme").addEventListener("click",function(){
  var r=document.documentElement,cur=r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),next=cur==="dark"?"light":"dark";
  r.dataset.theme=next;try{localStorage.setItem("theme",next)}catch(e){}
});
</script>
</body>
</html>`;
}
