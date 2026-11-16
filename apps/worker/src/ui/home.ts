import { agentName, explain, type AgentSummary, type DecisionRow, type MarketCard, type SiteStats } from "../data.js";
import { layout } from "./layout.js";
import { ago, esc, int, pct, price, pts, short, spark, tone, usd, utcHour, utcStamp } from "./util.js";

export interface Claim {
  id: string;
  text: string;
  status: string;
}

export interface HomeModel {
  now: number;
  stats: SiteStats;
  agents: AgentSummary[];
  decisions: DecisionRow[];
  markets: MarketCard[];
  featuredSeries: number[];
  claims: Claim[];
}

const EXPLORER = "https://robinhoodchain.blockscout.com";
const STATUS_LABEL: Record<string, string> = { live: "Live", in_testing: "In testing", planned: "Planned" };

function hero(m: HomeModel): string {
  const a = m.agents[0];
  const s = m.stats.lastSeal;
  const lastDecision = a ? m.decisions.find((d) => d.agent === a.id) : undefined;
  const card = a
    ? `<article class="card agent-card" aria-label="Top house agent right now">
  <header>
    <div><div class="name">${esc(agentName(a))}</div><div class="meta">House agent · decides every hour</div></div>
    <span class="tag paper">Paper</span>
  </header>
  <dl class="kpis">
    <div><dt>Value</dt><dd>${a.equity === null ? "n/a" : usd(a.equity)}</dd></div>
    <div><dt>Return</dt><dd class="${tone(a.return_pct)}">${pct(a.return_pct)}</dd></div>
    <div><dt>vs holding</dt><dd class="${tone(a.vs_hold_pts)}">${pts(a.vs_hold_pts)}</dd></div>
  </dl>
  ${spark(m.featuredSeries, 300, 88, true, `${a.market} Chainlink closes, last 48 hours`)}
  <p class="decision">${lastDecision ? `<span class="act">${esc(lastDecision.action)}</span> at ${utcHour(lastDecision.hour)}. ${esc(explain(lastDecision))}` : "First decision at the top of the next hour."}</p>
</article>`
    : `<div class="card agent-card"><p class="state" style="margin:0">The house agents make their first decision at the top of the next hour.</p></div>`;
  const receipt = s
    ? `<aside class="card receipt" aria-label="Latest sealed hour">
  <div class="row"><span>Hour sealed</span><strong>${esc(utcStamp(s.hour))}</strong></div>
  <div class="row"><span>Leaves</span><strong>${int(s.leaf_count)}</strong></div>
  <div class="row"><span>Root</span><a class="mono" href="/api/v1/seals">${esc(short(s.root, 8, 6))}</a></div>
  <div class="row"><span>Transaction</span>${s.tx_hash ? `<a class="mono" href="${EXPLORER}/tx/${esc(s.tx_hash)}">${esc(short(s.tx_hash, 8, 6))}</a>` : "<span>n/a</span>"}</div>
  <div class="row"><span>Landed</span><strong>${s.block_time ? esc(utcHour(s.block_time)) : "n/a"}</strong></div>
  <p class="sealed-line">Sealed on Robinhood Chain, ${s.timing === "on_time" ? "before the next close" : esc(s.timing ?? "")}</p>
</aside>`
    : "";
  return `<section class="hero">
  <div class="wrap">
    <div>
      <p class="eyebrow">Paper trading agents on Robinhood Chain</p>
      <h1>Trading agents for tokenized stocks. <em>Sealed every hour.</em></h1>
      <p class="lead">Each agent follows rules you can read. Every hour it looks at Chainlink prices and decides to buy, sell or hold. The decision, with the numbers behind it, is sealed on chain before the next hour closes, so the record can't be quietly edited later.</p>
      <div class="ctas"><a class="btn" href="/agents">See the agents</a><a class="btn ghost" href="/verify">Check an hour yourself</a></div>
      <p class="note">Open source. No sign-up to look around. No agent trades real money yet.</p>
    </div>
    <div class="stack">
      <picture class="hero-photo"><source type="image/webp" srcset="/brand/hero-900.webp 900w, /brand/hero-1536.webp 1536w" sizes="(max-width: 980px) 100vw, 560px"><img src="/brand/hero-900.jpg" width="1536" height="1024" alt="A red wax seal stamped with the Tauro mark, a T with horned ends, on a ledger page of printed numbers" fetchpriority="high"></picture>
      ${card}${receipt}
    </div>
  </div>
</section>`;
}

function ledger(m: HomeModel): string {
  const st = m.stats;
  const since = st.firstSealHour ? utcStamp(st.firstSealHour) : null;
  return `<section class="ledger" aria-label="Running totals" style="padding:0">
  <div class="wrap">
    <div class="cell"><div class="num">${int(st.markets)}</div><div class="lbl">Stock tokens priced hourly</div><div class="src">Chainlink feeds on Robinhood Chain</div></div>
    <div class="cell"><div class="num">${int(st.agents)}</div><div class="lbl">House agents running</div><div class="src">Paper, same rules for each</div></div>
    <div class="cell"><div class="num">${int(st.decisions)}</div><div class="lbl">Decisions sealed</div><div class="src">Every one with its reason</div></div>
    <div class="cell"><div class="num">${int(st.sealedOnTime)}<span style="font-size:.45em;color:var(--ink-3)"> / ${int(st.sealsSinceFirst)}</span></div><div class="lbl">Hours sealed on time</div><div class="src">${since ? `Since ${esc(since)}. Missed hours stay missed.` : "First seal pending"}</div></div>
  </div>
</section>`;
}

function hourRail(m: HomeModel): string {
  const s = m.stats.lastSeal;
  const ing = m.stats.lastIngest;
  const h = s?.hour ?? ing?.hour ?? null;
  const t = (offsetMin: number) => (h === null ? "" : utcHour(h + 3600 + offsetMin * 60));
  return `<section id="hour">
  <div class="wrap">
    <div class="sec-head">
      <div><p class="eyebrow">Every hour</p><h2>Rules decide. <em>The chain keeps the receipt.</em></h2></div>
      <p>The same five steps run at the top of every hour, in this order. The times below are from the last hour that was sealed${h !== null ? `, ${esc(utcStamp(h))}` : ""}. <span class="clock" data-next-seal></span></p>
    </div>
    <ol class="rail" style="padding:0;margin:0">
      <li><span class="t">${t(0)}</span><h3>Read closes</h3><p>The last Chainlink round before the hour ended, for every stock token.</p>${ing ? `<p class="live">${ing.ok} of ${ing.ok + ing.failed} feeds read</p>` : ""}</li>
      <li><span class="t">${t(1)}</span><h3>Rules decide</h3><p>Each agent runs its own rules on the closes. Buy, sell or hold, with the exact numbers.</p><p class="live">${int(m.stats.agents)} agents</p></li>
      <li><span class="t">${t(1)}</span><h3>Gate</h3><p>An order from last hour fills at this close only if the feed is fresh. Otherwise it is held, and the reason is logged.</p></li>
      <li class="sealed"><span class="t">${s?.block_time ? utcHour(s.block_time) : t(2)}</span><h3>Seal</h3><p>Every decision becomes a leaf. One Merkle root goes on chain before the next close.</p>${s ? `<p class="live">${int(s.leaf_count)} leaves, ${s.timing === "on_time" ? "on time" : esc(s.timing ?? "")}</p>` : ""}</li>
      <li><span class="t">any time</span><h3>Check</h3><p>Rebuild any decision from its public record and prove it against the root in the contract.</p><p class="live"><a href="/verify">Verify an hour</a></p></li>
    </ol>
  </div>
</section>`;
}

function decisionLog(m: HomeModel): string {
  if (m.decisions.length === 0) return "";
  const items = m.decisions
    .map(
      (d) => `<li class="entry">
  <div class="head"><span class="who"><span class="act ${esc(d.action)}">${esc(d.action)}</span>${esc(agentName(d))}</span><span class="when">${esc(utcStamp(d.hour))}</span></div>
  <p>${esc(explain(d))} <a class="proof" href="/verify?hour=${d.hour}&amp;subject=${encodeURIComponent(d.agent)}">Proof</a></p>
</li>`,
    )
    .join("");
  return `<section class="rule-top">
  <div class="wrap log-grid">
    <div>
      <p class="eyebrow">Decision log</p>
      <h2>Every move, <em>with its reason.</em></h2>
      <p class="lead">Agents never act in silence. Each hour they record what they saw and why they bought, sold or waited. Holds are logged too.</p>
      <ul class="checks">
        <li><b>The exact signal.</b> Which rule fired and the numbers it compared, rounded to six places.</li>
        <li><b>Stops come first.</b> A stop loss or take profit is checked before any other exit.</li>
        <li><b>Sealed as written.</b> Change one character of a record and its proof stops matching the root on chain.</li>
      </ul>
    </div>
    <div>
      <div class="feed" data-feed aria-label="Latest decisions"><ul class="feed-list">${items}${items.replace(/<li class="entry">/g, '<li class="entry" aria-hidden="true">')}</ul></div>
      <p class="feed-ctl"><button class="btn ghost" type="button" data-feed-toggle aria-pressed="false">Pause the feed</button></p>
    </div>
  </div>
</section>`;
}

function leaderboard(m: HomeModel): string {
  if (m.agents.length === 0) return "";
  const rows = m.agents
    .slice(0, 8)
    .map(
      (a, i) => `<tr>
  <td class="rank">${i + 1}</td>
  <td><a class="row-link" href="/agents/${esc(a.id)}">${esc(agentName(a))}</a></td>
  <td class="hide-sm">${a.qty > 0 ? "Holding" : "Flat"}</td>
  <td class="num ${tone(a.return_pct)}">${pct(a.return_pct)}</td>
  <td class="num ${tone(a.vs_hold_pts)}">${pts(a.vs_hold_pts)}</td>
  <td class="num hide-sm">${int(a.trades)}</td>
</tr>`,
    )
    .join("");
  const since = m.agents[0] ? utcStamp(Math.min(...m.agents.map((a) => a.created_hour))) : "";
  return `<section class="rule-top">
  <div class="wrap">
    <div class="sec-head">
      <div><p class="eyebrow">Leaderboard</p><h2>Every agent next to <em>just holding.</em></h2></div>
      <p>Return on paper since each agent started, compared with buying its market at the start and doing nothing. Fees of 0.5% per fill are included. <a href="/agents">Full leaderboard</a></p>
    </div>
    <div class="scroll"><table class="table">
      <thead><tr><th scope="col"><span class="sr">Rank</span></th><th scope="col">Agent</th><th scope="col" class="hide-sm">Position</th><th scope="col" class="num">Return</th><th scope="col" class="num">vs holding</th><th scope="col" class="num hide-sm">Fills</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="dim" style="font-size:13px;margin-top:12px">Paper trading since ${esc(since)}. Short track record: read these numbers as a log, not a forecast.</p>
  </div>
</section>`;
}

function proves(): string {
  return `<section class="rule-top">
  <div class="wrap">
    <div class="sec-head">
      <div><p class="eyebrow">What a seal is</p><h2>Proof of <em>what</em> and <em>when</em>. Nothing more.</h2></div>
      <p>Sealing is narrow on purpose. Here is exactly what you can check, and what you still have to take on trust.</p>
    </div>
    <div class="proves">
      <div><h3>What you can check</h3><ol>
        <li><b>The record wasn't changed.</b> Any edit to a decision after its hour was sealed breaks its Merkle proof.</li>
        <li><b>It existed before the next close.</b> The seal's block time is on chain. Late seals are never sent; the hour is marked missed.</li>
        <li><b>Nothing was skipped quietly.</b> Each root names the one before it, and hours only move forward.</li>
        <li><b>The prices are real.</b> Every close carries its Chainlink round id, so you can re-read it with getRoundData.</li>
      </ol></div>
      <div><h3>What it doesn't prove</h3><ol>
        <li><b>That a strategy is good.</b> A sealed losing trade is still a losing trade.</li>
        <li><b>That the server computed honestly.</b> The rules run on our server. The seal shows the output wasn't edited, and the inputs can be re-read, but you can rerun the engine yourself from the repository to be sure.</li>
        <li><b>That anything is real money.</b> All agents here are paper. A real-money wallet comes later, and every fill will link its transaction.</li>
      </ol></div>
    </div>
  </div>
</section>`;
}

function markets(m: HomeModel): string {
  const cards = m.markets
    .filter((c) => c.price !== null)
    .map(
      (c) => `<a class="mkt" href="/markets/${esc(c.symbol)}">
  <div class="sym">${esc(c.symbol)}</div><div class="nm">${esc(c.name)}</div>
  ${spark(c.series, 160, 34, false, `${c.symbol}, last 48 hours`)}
  <div class="px"><span>${price(c.price!)}</span><span class="${tone(c.change24)}" style="font-size:13px">${pct(c.change24)}</span></div>
</a>`,
    )
    .join("");
  return `<section class="rule-top">
  <div class="wrap">
    <div class="sec-head">
      <div><p class="eyebrow">Markets</p><h2>${m.markets.length} stock tokens, <em>priced every hour.</em></h2></div>
      <p>Every Robinhood Chain stock token that has an official Chainlink feed. 24 hour change from hourly closes. <a href="/markets">All markets</a></p>
    </div>
    <div class="mkts">${cards || '<p class="state">No closes yet.</p>'}</div>
  </div>
</section>`;
}

function claims(m: HomeModel): string {
  const rows = m.claims
    .map((c) => `<tr><td>${esc(c.text)}</td><td class="st-${esc(c.status)}">${esc(STATUS_LABEL[c.status] ?? c.status)}</td></tr>`)
    .join("");
  return `<section class="rule-top" id="status">
  <div class="wrap">
    <div class="sec-head">
      <div><p class="eyebrow">Status</p><h2>What is live, <em>and what isn't.</em></h2></div>
      <p>Every public claim lives in one file, status.json. The site, the README and this table render from it, and a check in CI fails when they disagree.</p>
    </div>
    <div class="scroll"><table class="table claims"><thead><tr><th scope="col">Claim</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
</section>`;
}

const FAQ: [string, string][] = [
  ["Is real money involved?", "Not yet. Every agent on this site trades paper money at real Chainlink prices. When a real-money wallet starts, it will be one public wallet, and every fill will link its transaction and the sealed decision behind it."],
  ["What does an agent actually look at?", "Hourly closes of one stock token: the last Chainlink round updated before the hour ended. From those it computes simple indicators such as moving averages, RSI and percent change, then applies its rules."],
  ["Why can't you just change the log later?", "Each hour's decisions are hashed into a Merkle root, and the root is written to SealRegistry on Robinhood Chain before the next hour closes. Change a record afterwards and its proof no longer matches the root on chain."],
  ["What happens when the market is closed?", "Feeds stop updating on weekends and holidays. Agents still decide each hour, but a paper order only fills while the feed is fresh, so orders are held and the reason is written in the log."],
  ["Why compare with holding?", "Because holding is the simplest alternative. An agent that loses less than holding in a falling market is doing something; one that trails holding in a rising market is not."],
  ["Can I build my own agent?", "You can shape rules in the Studio and replay them on the hourly history right now. Saving and running your own agent comes later."],
];

function faq(): string {
  return `<section class="rule-top">
  <div class="wrap" style="display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr);gap:48px">
    <div><p class="eyebrow">Questions</p><h2>Before you <em>trust it.</em></h2></div>
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
  </div>
</section>`;
}

function closing(): string {
  return `<section style="padding-bottom:0">
  <div class="wrap">
    <div class="closing">
      <div><h2>Check one hour <em>yourself.</em></h2><p>Pick any agent and any hour. Your browser rebuilds the decision from its record and checks it against the root stored on Robinhood Chain.</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="/verify">Open Verify</a><a class="btn ghost" href="/studio">Try the Studio</a></div>
    </div>
  </div>
</section>`;
}

export function renderHome(m: HomeModel): string {
  return layout(
    {
      title: "Tauro · Trading agents for tokenized stocks, sealed every hour",
      description: "Paper trading agents for Robinhood Chain stock tokens. Rules you can read, Chainlink prices, and every hourly decision sealed on chain before the next close.",
      path: "/",
    },
    [hero(m), ledger(m), hourRail(m), decisionLog(m), leaderboard(m), proves(), markets(m), claims(m), faq(), closing()].join("\n"),
  );
}

export { ago };
