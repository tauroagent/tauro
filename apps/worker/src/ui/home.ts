import { agentName, explain, TEMPLATE_LABEL, type AgentSummary, type DecisionRow, type MarketCard, type Showcase, type SiteStats } from "../data.js";
import { layout } from "./layout.js";
import { skyHero } from "./sky.js";
import { esc, int, pct, price, pts, short, spark, tone, usd, utcDay, utcHour, utcStamp } from "./util.js";

export interface Claim {
  id: string;
  text: string;
  status: string;
}

export interface HomeModel {
  now: number;
  stats: SiteStats;
  hoursOfPrices: number;
  agents: AgentSummary[];
  decisions: DecisionRow[];
  markets: MarketCard[];
  featuredSeries: number[];
  showcase: Showcase[];
  seals: { hour: number; status: string; timing: string | null; leaf_count: number }[];
  claims: Claim[];
}

const STATUS_LABEL: Record<string, string> = { live: "Live", in_testing: "In testing", planned: "Planned" };

/** Digits that roll into place. Without JS they already show the final number. */
function odometer(n: number): string {
  const s = int(n);
  const cols = [...s]
    .map((ch) =>
      /\d/.test(ch)
        ? `<span class="odo" aria-hidden="true"><span data-d="${ch}" style="transform:translateY(-${Number(ch) * 1.05}em)">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<i>${d}</i>`).join("")}</span></span>`
        : `<span aria-hidden="true">${esc(ch)}</span>`,
    )
    .join("");
  return `<span class="sr">${esc(s)}</span>${cols}`;
}

function bestRun(m: HomeModel): Showcase | undefined {
  return [...m.showcase].sort((a, b) => b.returnPct - b.holdPct - (a.returnPct - a.holdPct))[0];
}

function stats(m: HomeModel): string {
  const st = m.stats;
  const cells: [string, number, string][] = [
    ["Stock tokens", st.markets, "Chainlink feeds on Robinhood Chain"],
    ["Agents running", st.agents, "House agents, paper"],
    ["Decisions sealed", st.decisions, "Each with its reason"],
    ["Hours of real prices", m.hoursOfPrices, st.firstSealHour ? `${int(st.sealedOnTime)} of ${int(st.sealsSinceFirst)} seals on time` : "Hourly closes"],
  ];
  return `<div class="stats-wrap"><div class="wrap stats">${cells
    .map(([k, v, src]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v" data-odo>${odometer(v)}</div><div class="src">${esc(src)}</div></div>`)
    .join("")}</div></div>`;
}

const ICONS: Record<string, string> = {
  momentum: `<path d="M12 40 L22 31 L29 35 L43 18"/><path d="M35 18 H43 V26"/>`,
  mean_reversion: `<path d="M10 28 C 16 14, 22 14, 28 28 S 40 42, 46 28"/><path d="M10 28 H46" stroke-dasharray="2 4" opacity=".7"/>`,
  dip_hunter: `<path d="M10 18 L20 23 L27 39 L34 31 L46 27"/><circle cx="27" cy="39" r="3"/>`,
  breakout: `<path d="M10 34 H32" stroke-dasharray="2 4" opacity=".7"/><path d="M10 38 L18 36 L25 38 L32 34 L39 23 L46 15"/>`,
};
const KIND: Record<string, string> = { momentum: "Trend following", mean_reversion: "Back to average", dip_hunter: "Buy the dip", breakout: "New highs" };
const DESC: Record<string, string> = {
  momentum: "Buys when the 6 hour average crosses above the 24 hour average and price rose over 6 hours. Sells on the cross back.",
  mean_reversion: "Buys when price sits 2% under its 24 hour average. Sells back at the average, or after 48 hours.",
  dip_hunter: "Buys when RSI(14) is under 30 after a 3% drop in a day. Sells on the rebound above 55, or at +4%.",
  breakout: "Buys when price is 2% above its 48 hour average and climbing. Sells on a 1% drop over 3 hours.",
};

function strategies(m: HomeModel): string {
  const cards = Object.keys(TEMPLATE_LABEL)
    .map((t) => {
      const top = m.showcase.filter((s) => s.template === t).sort((a, b) => b.returnPct - b.holdPct - (a.returnPct - a.holdPct))[0];
      const markets = [...new Set(m.agents.filter((a) => a.template === t).map((a) => a.market))];
      return `<article class="strat">
  <svg class="ic" viewBox="0 0 56 56" aria-hidden="true"><rect x="1" y="1" width="54" height="54" rx="16" fill="url(#sg)"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ICONS[t]}</g></svg>
  <div class="kind">${esc(KIND[t]!)}</div>
  <h3>${esc(TEMPLATE_LABEL[t]!)}</h3>
  <p>${esc(DESC[t]!)}</p>
  <div class="mk">${(markets.length ? markets : ["SPY", "QQQ", "NVDA", "TSLA", "AAPL"]).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
  <div class="foot">${top ? `<a href="/studio?market=${esc(top.market)}"><span>Best replay</span><b>${esc(top.market)}</b></a><span class="r">vs holding<b class="${top.returnPct - top.holdPct >= 0 ? "up" : "down"}">${pts(top.returnPct - top.holdPct)}</b></span>` : `<span>Replay</span><span class="r">needs more history</span>`}</div>
</article>`;
    })
    .join("");
  return `<div class="panel-dark" style="padding-top:96px">
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b04dff"/><stop offset="1" stop-color="#5a12c0"/></linearGradient></defs></svg>
  <div class="wrap">
    <p class="eyebrow">Strategies</p>
    <h2>A strategy for <span class="grad">every market mood</span></h2>
    <p class="lead">Ride a trend, buy the dip, or wait for the price to come back. Four rule sets run as house agents today, and each one is measured against the simplest move of all: holding.</p>
    <div class="strats">${cards}</div>
  </div>
</div>`;
}

function markets(m: HomeModel): string {
  const cards = m.markets
    .filter((c) => c.price !== null)
    .map((c) => {
      const tn = tone(c.change24);
      return `<a class="mkt" href="/markets/${esc(c.symbol)}">
  <div class="hd"><span class="mono-av">${esc(c.symbol.slice(0, 4))}</span><div><div class="sym">${esc(c.symbol)}</div><div class="nm">${esc(c.name)}</div></div></div>
  ${spark(c.series, 200, 44, true, `${c.symbol}, last 48 hours`).replace('class="spark"', `class="spark ${tn}"`)}
  <div class="px"><span>$${price(c.price!)}</span><span class="${tn}">${pct(c.change24)}</span></div>
</a>`;
    })
    .join("");
  return `<section>
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Markets</p><h2>Every big name, <span class="grad">every hour</span></h2>
    <p class="lead">${m.markets.length} US stocks and ETFs as tokens on Robinhood Chain, each with an official Chainlink feed. Hourly closes, with the 24 hour change.</p></div>
    <div class="mkts">${cards || '<p class="state">No closes yet.</p>'}</div>
  </div>
</section>`;
}

const STEP_ICON = (d: string) => `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="14" fill="var(--red-soft)"/><g fill="none" stroke="var(--red)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
function howItWorks(): string {
  const steps: [string, string, string, string][] = [
    [`<path d="M14 30 L20 24 L26 28 L34 18"/><path d="M14 34 H34"/>`, "Step 1", "Replay the last week", "Pick a strategy and a stock token. The Studio replays every hourly close we hold, with fees, in your browser."],
    [`<circle cx="24" cy="24" r="9"/><path d="M24 19 V24 L27 26"/>`, "Step 2", "Agents decide every hour", "House agents run the same engine on fresh closes: buy, sell or hold, with the numbers behind it."],
    [`<circle cx="24" cy="24" r="10"/><path d="M19 20 Q19 24 23 24 H25 Q29 24 29 20"/><path d="M24 24 V31"/>`, "Step 3", "Sealed before the next close", "The hour's decisions become one Merkle root, written to SealRegistry on Robinhood Chain."],
    [`<path d="M15 25 L21 31 L33 17"/>`, "Step 4", "Check it yourself", "Rebuild any decision in your browser and prove it against the root stored in the contract."],
  ];
  return `<section class="band">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">How it works</p><h2>From rules to <span class="grad">a sealed record</span></h2><p class="lead">No sign-up to look around. Shape it, watch it, check it.</p></div>
    <div class="steps">${steps.map(([ic, n, h, p]) => `<article class="step reveal">${STEP_ICON(ic)}<div class="n">${n}</div><h3>${h}</h3><p>${p}</p></article>`).join("")}</div>
  </div>
</section>`;
}

const RAIL_ICONS = [
  `<path d="M4 15 L8 10 L11 12 L16 6"/>`,
  `<path d="M5 6 H15 M5 10 H15 M5 14 H11"/>`,
  `<path d="M3 10 H17 M13 6 L17 10 L13 14"/>`,
  `<circle cx="10" cy="10" r="6"/><path d="M7.5 8.5 Q7.5 10.5 9.5 10.5 H10.5 Q12.5 10.5 12.5 8.5 M10 10.5 V13.5"/>`,
  `<path d="M5 10 L8.5 13.5 L15 6.5"/>`,
];
function hourRail(m: HomeModel): string {
  const s = m.stats.lastSeal;
  const ing = m.stats.lastIngest;
  const h = s?.hour ?? ing?.hour ?? null;
  const t = (min: number) => (h === null ? "" : utcHour(h + 3600 + min * 60));
  const items: [string, string, string, string][] = [
    [t(0), "Read closes", "The last Chainlink round before the hour ended, for every stock token.", ing ? `${ing.ok} of ${ing.ok + ing.failed} feeds read` : ""],
    [t(1), "Run the rules", "Each agent applies its own rules: buy, sell or hold, and how much.", `${int(m.stats.agents)} agents`],
    [t(1), "Paper fill", "Last hour's order fills at this close, only if the feed is fresh. Otherwise it is held.", "0.5% per fill"],
    [s?.block_time ? utcHour(s.block_time) : t(2), "Seal", "Every decision becomes a leaf. One root goes on chain before the next close.", s ? `${int(s.leaf_count)} leaves, ${s.timing === "on_time" ? "on time" : esc(s.timing ?? "")}` : ""],
    ["any time", "Check", "Anyone can rebuild a decision and prove it against the root in the contract.", "No account"],
  ];
  return `<section id="hour">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Every hour</p><h2>Rules decide. <span class="grad">The chain keeps the receipt.</span></h2>
    <p class="lead">Once an hour, every agent runs the same five steps in the same order. Times are from the last sealed hour${h !== null ? `, ${esc(utcStamp(h))}` : ""}. <span class="clock" data-next-seal></span></p></div>
    <div class="rail-icons" aria-hidden="true">${RAIL_ICONS.map((d) => `<div><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg></div>`).join("")}</div>
    <ol class="rail">${items.map(([tt, h3, p, live], i) => `<li class="${i === 3 ? "seal" : ""}"><span class="t">0${i + 1} · ${esc(tt)}</span><h3>${h3}</h3><p>${p}</p>${live ? `<p class="live">${live}</p>` : ""}</li>`).join("")}</ol>
  </div>
</section>`;
}

function decisionLog(m: HomeModel): string {
  if (m.decisions.length === 0) return "";
  const items = m.decisions
    .map(
      (d) => `<li class="entry"><div class="head"><span>${esc(TEMPLATE_LABEL[d.template] ?? d.template)} · house</span><span>${esc(utcStamp(d.hour))}</span></div>
<p><span class="tagc ${esc(d.action)}">${esc(d.action)}</span><b>${esc(d.market)}</b> ${esc(explain(d))} <a class="proof" href="/verify?hour=${d.hour}&amp;subject=${encodeURIComponent(d.agent)}">Proof</a></p></li>`,
    )
    .join("");
  return `<section class="band">
  <div class="wrap log-grid">
    <div>
      <p class="eyebrow">Decision log</p>
      <h2>Every move, <span class="grad">explained and sealed</span></h2>
      <p class="lead">Agents never act in silence. Each hour they write down what they saw and why they bought, sold or waited. Holds count too.</p>
      <ul class="checks">
        <li><span><b>The exact signal:</b> which rule fired and the numbers it compared.</span></li>
        <li><span><b>Stops first:</b> a stop loss or take profit is checked before any other exit.</span></li>
        <li><span><b>Sealed as written:</b> edit one record and its proof stops matching the chain.</span></li>
      </ul>
    </div>
    <div>
      <div class="feed" data-feed aria-label="Latest decisions"><ul class="feed-list">${items}${items.replace(/<li class="entry">/g, '<li class="entry" aria-hidden="true">')}</ul></div>
      <p class="feed-ctl"><button class="btn soft sm" type="button" data-feed-toggle aria-pressed="false">Pause the feed</button></p>
    </div>
  </div>
</section>`;
}

function statement(m: HomeModel): string {
  const parts = ["Most trading logs", "can be edited after the fact.", "Ours are sealed on chain", "before the next hour closes."];
  const s = m.stats.lastSeal;
  return `<section>
  <div class="wrap">
    <p class="statement" data-lit>${parts.map((p) => `<span>${esc(p)}</span>`).join(" ")}</p>
    <div class="facts4">
      <div class="fact reveal"><b>0.5%</b><span>Charged on every paper fill, for fees and slippage.</span></div>
      <div class="fact reveal"><b>1 hour</b><span>Between decisions, around the clock. Weekends included.</span></div>
      <div class="fact reveal"><b>${s ? int(s.leaf_count) : "n/a"}</b><span>Leaves in the last sealed root: every close, decision and status.</span></div>
      <div class="fact reveal"><b>${int(m.stats.sealedOnTime)}/${int(m.stats.sealsSinceFirst)}</b><span>Hours sealed on time since the first seal. Missed hours stay missed.</span></div>
    </div>
  </div>
</section>`;
}

function track(m: HomeModel): string {
  const best = bestRun(m);
  if (!best) return "";
  const all = [...best.equity, ...best.hold];
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const W = 720, H = 300, pad = 12;
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * W).toFixed(1)} ${(pad + (1 - (v - min) / span) * (H - pad * 2)).toFixed(1)}`).join("");
  const a = path(best.equity);
  const end = best.equity[best.equity.length - 1]!;
  const endHold = best.hold[best.hold.length - 1]!;
  return `<section>
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Track record</p><h2>Every strategy next to <span class="grad">just holding</span></h2>
    <p class="lead">Growth of $1,000 with ${esc(TEMPLATE_LABEL[best.template]!)} on ${esc(best.market)}, compared with holding ${esc(best.market)} or staying in cash. A replay on Chainlink closes from ${esc(utcDay(best.from))} to ${esc(utcDay(best.to))}, with 0.5% per fill. Short history: read it as a log, not a forecast.</p></div>
    <div class="track reveal">
      <div>
        <div class="legend-row"><span><i></i>${esc(TEMPLATE_LABEL[best.template]!)} · ${esc(best.market)}</span><span class="legend-v">${usd(end)}</span></div>
        <div class="legend-row"><span><i class="h"></i>Holding ${esc(best.market)}</span><span class="legend-v">${usd(endHold)}</span></div>
        <div class="legend-row"><span><i class="h" style="background:var(--line-2)"></i>Cash</span><span class="legend-v">$1,000.00</span></div>
        <p style="margin-top:18px"><a class="btn soft sm" href="/studio?market=${esc(best.market)}">Replay it in the Studio</a></p>
      </div>
      <div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Replay value compared with holding">
          ${[0.25, 0.5, 0.75].map((f) => `<line class="g" x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" vector-effect="non-scaling-stroke"/>`).join("")}
          <path class="af" d="${a}L${W} ${H}L0 ${H}Z"/><path class="b" d="${path(best.hold)}" vector-effect="non-scaling-stroke"/><path class="a" d="${a}" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="axis"><span>${esc(utcDay(best.from))}</span><span>${esc(utcDay(best.to))}</span></div>
      </div>
    </div>
  </div>
</section>`;
}

function leaderboard(m: HomeModel): string {
  if (m.agents.length === 0) return "";
  const rows = m.agents
    .slice(0, 5)
    .map(
      (a, i) => `<tr><td class="rank">${i + 1}</td><td><a class="row-link" href="/agents/${esc(a.id)}">${esc(agentName(a))}</a><span class="pill red">${a.owner === "house" ? "by Tauro" : "by a holder"}</span></td>
<td class="hide-sm">${esc(TEMPLATE_LABEL[a.template] ?? a.template)}</td><td class="num ${tone(a.return_pct)}">${pct(a.return_pct)}</td><td class="num ${tone(a.vs_hold_pts)}">${pts(a.vs_hold_pts)}</td><td class="num hide-sm">${int(a.trades)}</td></tr>`,
    )
    .join("");
  const since = utcStamp(Math.min(...m.agents.map((a) => a.created_hour)));
  return `<section style="padding-top:0">
  <div class="wrap">
    <div class="sec-head" style="display:flex;justify-content:space-between;align-items:end;max-width:none;gap:24px;flex-wrap:wrap"><div><p class="eyebrow">Leaderboard</p><h2>Agents running <span class="grad">right now</span></h2></div><a class="btn soft" href="/agents">Full leaderboard</a></div>
    <div class="tbl-card scroll"><table class="table"><thead><tr><th scope="col">#</th><th scope="col">Agent</th><th scope="col" class="hide-sm">Strategy</th><th scope="col" class="num">Return</th><th scope="col" class="num">vs holding</th><th scope="col" class="num hide-sm">Fills</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="dim" style="font-size:13px;margin-top:12px">Paper trading since ${esc(since)}. Each agent is compared with holding the same dollar amount of its market.</p>
  </div>
</section>`;
}

// Roadmap items, keyed by status.json claim id. The column each one lands in is its status in status.json,
// so an item moves from Planned to Live only when the claim file says so.
const ROAD: [string, string, string][] = [
  ["seal", "Hourly seals on chain", "Decisions and closes sealed in SealRegistry before the next close, with a proof for every leaf."],
  ["agents", "20 house paper agents", "Four strategies on SPY, QQQ, NVDA, TSLA and AAPL, each compared with holding."],
  ["api", "Read API, no key", "Prices, seals, proofs, agents and decisions, open to anyone."],
  ["missed", "Missed hours stay missed", "Shown with their reason, never back-filled."],
  ["holder_slots", "Holder agents", "Hold 1,000,000 TAURO for one paper agent, 5,000,000 for three. Rules sealed in the agent's first hour."],
  ["burn_slots", "Burn for a slot", "Burn 1,000,000 TAURO for one more slot for 30 days, checked on chain."],
  ["gate", "Price gate for real fills", "Blocks a fill when the pool and Chainlink differ by more than 2%, or the feed is stale."],
  ["verify_cli", "Verify CLI", "Recompute any sealed hour from public data."],
  ["mcp", "MCP server", "Tauro data and proofs, for agents."],
  ["live_wallet", "One public real-money wallet", "Every real fill links its transaction and the decision sealed before it. Caps published before it starts."],
  ["api_limits", "Higher API limits for holders", "Holding TAURO raises read API limits."],
];

function roadmap(m: HomeModel): string {
  const status = new Map(m.claims.map((c) => [c.id, c.status]));
  const col = (s: string, cls: string, title: string) => {
    const items = ROAD.filter(([id]) => status.get(id) === s);
    if (!items.length) return "";
    return `<div class="c"><span class="st ${cls}">${esc(title)}</span><ul class="road-list">${items.map(([, h, p]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join("")}</ul></div>`;
  };
  return `<div class="panel-dark" style="padding-top:96px">
  <div class="wrap">
    <p class="eyebrow">Roadmap</p>
    <h2>What's live, <span class="grad">what's next</span></h2>
    <p class="lead">Each item takes its status from status.json, the same file as the table below. No dates: a planned item moves to live when its proof is public.</p>
    <div class="road">${col("live", "", "Live")}${col("in_testing", "test", "In testing")}${col("planned", "plan", "Planned, not built")}</div>
  </div>
</div>`;
}

function claims(m: HomeModel): string {
  const rows = m.claims.map((c) => `<tr><td>${esc(c.text)}</td><td class="st-${esc(c.status)}">${esc(STATUS_LABEL[c.status] ?? c.status)}</td></tr>`).join("");
  return `<section id="status">
  <div class="wrap">
    <div class="sec-head"><p class="eyebrow">Status</p><h2>Every claim, <span class="grad">with its status</span></h2><p class="lead">One file, status.json, holds every public claim. The site, the README and this table render from it, and CI fails when they disagree.</p></div>
    <div class="tbl-card scroll"><table class="table"><thead><tr><th scope="col">Claim</th><th scope="col">Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
</section>`;
}

const FAQ: [string, string][] = [
  ["Is real money involved?", "Not yet. Every agent here trades paper money at real Chainlink prices. When a real-money wallet starts, it will be one public wallet, and every fill will link its transaction and the sealed decision behind it."],
  ["What are stock tokens?", "Tokens on Robinhood Chain that track US stocks and ETFs such as TSLA, NVDA or SPY. Tauro reads their official Chainlink feeds; it is not affiliated with Robinhood or Chainlink."],
  ["How often do agents decide?", "Once an hour, at the top of the hour, around the clock. While US markets are closed the feeds stop moving, so orders are held and the log says why."],
  ["Why can't the log be changed later?", "Each hour's decisions are hashed into one Merkle root, written to SealRegistry on Robinhood Chain before the next close. Edit a record afterwards and its proof no longer matches the root on chain."],
  ["Why compare with holding?", "Because holding is the simplest alternative. Each agent is compared with holding the same dollar amount of its market from the start."],
  ["Can I build my own agent?", "You can shape rules in the Studio and replay them on every hourly close right now. Saving and running your own agent is not open yet."],
];

function faq(): string {
  return `<section class="band">
  <div class="wrap faq-wrap">
    <div><p class="eyebrow">FAQ</p><h2>Before you <span class="grad">trust it</span></h2></div>
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
  </div>
</section>`;
}

function closing(): string {
  return `<section style="padding-bottom:0">
  <div class="wrap">
    <div class="closing reveal" style="grid-template-columns:1fr;text-align:center">
      <div class="txt"><p class="eyebrow">Get started</p><h2>Check one hour <span class="grad">yourself</span></h2>
        <p>Pick any agent and any hour. Your browser rebuilds the decision and checks it against the root stored on Robinhood Chain. No account needed.</p>
        <div class="ctas" style="justify-content:center"><a class="btn" href="/verify">Open Verify</a><a class="btn soft" href="/studio">Try the Studio</a></div>
        <div class="chipset" style="justify-content:center"><span>Free</span><span>Paper only</span><span>Open source</span></div>
      </div>
    </div>
  </div>
</section>`;
}

export function renderHome(m: HomeModel): string {
  return layout(
    {
      title: "Tauro · Trading agents for tokenized stocks on Robinhood Chain",
      description: "Rule-based paper trading agents for Robinhood Chain stock tokens. Chainlink prices, hourly decisions with their reasons, and every hour sealed on chain before the next close.",
      path: "/",
      scripts: ["/js/sky.js"],
    },
    [skyHero(m), stats(m), strategies(m), markets(m), howItWorks(), hourRail(m), decisionLog(m), statement(m), track(m), leaderboard(m), roadmap(m), claims(m), faq(), closing()].join("\n"),
  );
}
