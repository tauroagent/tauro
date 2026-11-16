import { agentName, explain, TEMPLATE_LABEL, type AgentSummary, type DecisionRow, type MarketCard } from "../data.js";
import { MARKETS } from "../universe.js";
import { layout } from "./layout.js";
import { esc, int, lineChart, pct, price, pts, short, spark, tone, usd, utcStamp } from "./util.js";

const EXPLORER = "https://robinhoodchain.blockscout.com";

function agentRows(agents: AgentSummary[]): string {
  return agents
    .map(
      (a, i) => `<tr>
  <td class="rank">${i + 1}</td>
  <td><a class="row-link" href="/agents/${esc(a.id)}">${esc(agentName(a))}</a><div class="dim" style="font-size:13px">House · paper</div></td>
  <td class="hide-sm">${a.qty > 0 ? "Holding" : "Flat"}</td>
  <td class="num">${a.equity === null ? "n/a" : usd(a.equity)}</td>
  <td class="num ${tone(a.return_pct)}">${pct(a.return_pct)}</td>
  <td class="num hide-sm ${tone(a.hold_return_pct)}">${pct(a.hold_return_pct)}</td>
  <td class="num ${tone(a.vs_hold_pts)}">${pts(a.vs_hold_pts)}</td>
  <td class="num hide-sm">${int(a.trades)}</td>
</tr>`,
    )
    .join("");
}

export function renderAgents(agents: AgentSummary[]): string {
  const since = agents.length ? utcStamp(Math.min(...agents.map((a) => a.created_hour))) : null;
  const body = `<div class="page-head"><div class="wrap">
  <p class="eyebrow">Leaderboard</p>
  <h1>Agents</h1>
  <p class="lead">Every agent, ranked by paper return since it started, next to holding the same dollar amount of its market from the start. ${since ? `House agents started ${esc(since)}.` : ""} All of them are paper.</p>
</div></div>
<section style="padding-top:40px"><div class="wrap">
  ${
    agents.length
      ? `<div class="scroll"><table class="table">
    <thead><tr><th scope="col"><span class="sr">Rank</span></th><th scope="col">Agent</th><th scope="col" class="hide-sm">Position</th><th scope="col" class="num">Value</th><th scope="col" class="num">Return</th><th scope="col" class="num hide-sm">Holding same size</th><th scope="col" class="num">vs holding</th><th scope="col" class="num hide-sm">Fills</th></tr></thead>
    <tbody>${agentRows(agents)}</tbody></table></div>
  <p class="dim" style="font-size:13px;margin-top:12px">Each agent starts with $1,000 of paper money. Fills at the next hour's Chainlink close with a 0.5% fee, only while the feed is fresh. JSON: <a href="/api/v1/agents">/api/v1/agents</a></p>`
      : `<p class="state">The house agents make their first decision at the top of the next hour.</p>`
  }
</div></section>`;
  return layout({ title: "Agents · Tauro", description: "Paper trading agents on Robinhood Chain stock tokens, ranked against buying and holding.", path: "/agents" }, body);
}

function rulesText(rules: { entry?: unknown[]; exit?: unknown[]; stopLossPct?: number; takeProfitPct?: number; maxHoldHours?: number; sizeUsd?: number }): string {
  const cond = (c: Record<string, unknown>): string => {
    const op = c.op === "lt" ? "below" : "above";
    switch (c.kind) {
      case "change": return `price change over ${c.hours} h is ${op} ${c.pct}%`;
      case "rsi": return `RSI(${c.period}) is ${op} ${c.value}`;
      case "sma_cross": return `SMA(${c.fast}) is ${c.dir} SMA(${c.slow})`;
      case "price_vs_sma": return `price is ${op} SMA(${c.period}) by ${c.pct}%`;
      default: return "unknown rule";
    }
  };
  const li = (xs: unknown[] | undefined) => (xs ?? []).map((c) => `<li>${esc(cond(c as Record<string, unknown>))}</li>`).join("");
  return `<h3 style="font-size:18px;margin:0 0 6px">Buy when all of these are true</h3><ul>${li(rules.entry)}</ul>
<h3 style="font-size:18px;margin:16px 0 6px">Sell when any of these is true</h3><ul>${li(rules.exit)}<li>loss reaches ${rules.stopLossPct}% (stop loss, checked first)</li>${rules.takeProfitPct ? `<li>gain reaches ${rules.takeProfitPct}% (take profit)</li>` : ""}${rules.maxHoldHours ? `<li>position is ${rules.maxHoldHours} h old</li>` : ""}</ul>
<p class="dim" style="font-size:14px">Order size $${rules.sizeUsd} per buy.</p>`;
}

export function renderAgent(a: AgentSummary, series: { hour: number; equity: number; price: number }[], decisions: DecisionRow[]): string {
  const eq = series.map((s) => s.equity);
  const size = Math.min(a.start_cash, (a.rules as { sizeUsd?: number }).sizeUsd ?? a.start_cash);
  const hold = a.start_price ? series.map((s) => a.start_cash - size + (size * s.price) / a.start_price!) : [];
  const log = decisions
    .map(
      (d) => `<li class="entry"><div class="head"><span class="who"><span class="act ${esc(d.action)}">${esc(d.action)}</span>${esc(utcStamp(d.hour))}</span><a class="proof" href="/verify?hour=${d.hour}&amp;subject=${encodeURIComponent(a.id)}">Proof</a></div><p>${esc(explain(d))}</p></li>`,
    )
    .join("");
  const body = `<div class="page-head"><div class="wrap">
  <p class="crumbs"><a href="/agents">Agents</a> / ${esc(a.id)}</p>
  <h1>${esc(agentName(a))}</h1>
  <p style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0"><span class="tag">House agent</span><span class="tag paper">Paper</span><span class="tag">${esc(TEMPLATE_LABEL[a.template] ?? a.template)}</span><span class="tag">${a.qty > 0 ? "Holding " + esc(a.market) : "Flat"}</span></p>
</div></div>
<section style="padding-top:32px"><div class="wrap grid-2">
  <div>
    <dl class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:0">
      <div><dt>Value</dt><dd>${a.equity === null ? "n/a" : usd(a.equity)}</dd></div>
      <div><dt>Return</dt><dd class="${tone(a.return_pct)}">${pct(a.return_pct)}</dd></div>
      <div><dt>Holding same size</dt><dd class="${tone(a.hold_return_pct)}">${pct(a.hold_return_pct)}</dd></div>
      <div><dt>vs holding</dt><dd class="${tone(a.vs_hold_pts)}">${pts(a.vs_hold_pts)}</dd></div>
    </dl>
    <div class="card panel" style="margin-top:20px">
      <h2>Value over time</h2>
      ${eq.length > 1 ? lineChart(eq, hold, 720, 280, `${agentName(a)} paper value compared with holding ${a.market}`) : '<p class="state">The chart starts after the agent\'s second hour.</p>'}
      <div class="legend"><span><i></i>This agent</span><span><i class="b"></i>Holding the same $${size} of ${esc(a.market)} from the start</span></div>
    </div>
    <div class="card panel" style="margin-top:20px">
      <h2>Decision log</h2>
      ${log ? `<ul style="list-style:none;margin:0;padding:0">${log}</ul>` : '<p class="state">No decisions yet.</p>'}
      <p class="dim" style="font-size:13px">Latest ${decisions.length}. JSON: <a href="/api/v1/decisions?agent=${esc(a.id)}&amp;hours=720">/api/v1/decisions</a></p>
    </div>
  </div>
  <aside>
    <div class="card panel"><h2>Rules</h2>${rulesText(a.rules as Parameters<typeof rulesText>[0])}</div>
    <div class="card panel" style="margin-top:20px"><h2>Facts</h2><dl class="facts">
      <dt>Started</dt><dd>${esc(utcStamp(a.created_hour))}</dd>
      <dt>Start cash</dt><dd>${usd(a.start_cash)}</dd>
      <dt>Cash now</dt><dd>${usd(a.cash)}</dd>
      <dt>Shares</dt><dd>${a.qty.toFixed(6)}</dd>
      <dt>Decisions</dt><dd>${int(a.decisions)}</dd>
      <dt>Fills</dt><dd>${int(a.trades)}</dd>
      <dt>Config hash</dt><dd class="mono" title="${esc(a.config_hash)}">${esc(short(a.config_hash, 10, 8))}</dd>
    </dl><p class="dim" style="font-size:13px;margin:14px 0 0">The rules were sealed as a config leaf in the hour this agent started, so they can't be changed after the fact.</p></div>
  </aside>
</div></section>`;
  return layout({ title: `${agentName(a)} · Tauro`, description: `Paper trading agent on ${a.market}: every hourly decision with its reason, sealed on Robinhood Chain.`, path: `/agents/${a.id}` }, body);
}

export function renderMarkets(cards: MarketCard[]): string {
  const rows = cards
    .map(
      (c) => `<tr><td><a class="row-link" href="/markets/${esc(c.symbol)}">${esc(c.symbol)}</a><div class="dim" style="font-size:13px">${esc(c.name)}</div></td>
<td class="hide-sm" style="width:180px;color:var(--ink)">${spark(c.series, 180, 34, false, `${c.symbol}, last 48 hours`)}</td>
<td class="num">${c.price === null ? "n/a" : price(c.price)}</td><td class="num ${tone(c.change24)}">${pct(c.change24)}</td>
<td class="num hide-sm dim">${c.updatedAt ? esc(utcStamp(c.updatedAt)) : ""}</td></tr>`,
    )
    .join("");
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Markets</p><h1>Stock tokens</h1>
<p class="lead">Every Robinhood Chain stock token with an official Chainlink "Robinhood / USD" feed. One close per hour: the last round updated before the hour ended. While US markets are closed the feeds stop moving, and the feed time below shows it.</p></div></div>
<section style="padding-top:40px"><div class="wrap"><div class="scroll"><table class="table">
<thead><tr><th scope="col">Token</th><th scope="col" class="hide-sm">48 h</th><th scope="col" class="num">Close, USD</th><th scope="col" class="num">24 h</th><th scope="col" class="num hide-sm">Feed updated</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="dim" style="font-size:13px;margin-top:12px">JSON with token and feed addresses: <a href="/api/v1/markets">/api/v1/markets</a></p></div></section>`;
  return layout({ title: "Markets · Tauro", description: "Hourly Chainlink closes for Robinhood Chain stock tokens.", path: "/markets" }, body);
}

export function renderMarket(symbol: string, series: { hour: number; price: number }[], agents: AgentSummary[]): string {
  const m = MARKETS.find((x) => x.symbol === symbol)!;
  const last = series[series.length - 1];
  const first = series[0];
  const ch = last && first ? ((last.price - first.price) / first.price) * 100 : null;
  const body = `<div class="page-head"><div class="wrap"><p class="crumbs"><a href="/markets">Markets</a> / ${esc(symbol)}</p>
<h1>${esc(symbol)} <span class="dim" style="font-size:.5em">${esc(m.name)}</span></h1>
<p class="lead">${last ? `${price(last.price)} USD at ${esc(utcStamp(last.hour + 3600))} close, ${pct(ch)} over the last ${series.length} hours.` : "No closes yet."}</p></div></div>
<section style="padding-top:32px"><div class="wrap grid-2">
  <div class="card panel"><h2>Hourly closes</h2>${lineChart(series.map((s) => s.price), [], 720, 280, `${symbol} hourly Chainlink closes`)}</div>
  <aside class="card panel"><h2>Sources</h2><dl class="facts">
    <dt>Token</dt><dd><a class="mono" href="${EXPLORER}/token/${esc(m.token)}">${esc(short(m.token))}</a></dd>
    <dt>Chainlink feed</dt><dd><a class="mono" href="${EXPLORER}/address/${esc(m.feed)}">${esc(short(m.feed))}</a></dd>
    <dt>Heartbeat</dt><dd>${m.heartbeatSec / 3600} h</dd>
    <dt>Deviation</dt><dd>${m.deviationPct}%</dd>
    <dt>Hours</dt><dd>${esc(m.marketHours ?? "n/a")}</dd>
  </dl>
  <h2 style="margin-top:24px">Agents on ${esc(symbol)}</h2>
  ${agents.length ? `<ul style="margin:0;padding-left:18px">${agents.map((a) => `<li><a href="/agents/${esc(a.id)}">${esc(agentName(a))}</a> <span class="${tone(a.return_pct)}">${pct(a.return_pct)}</span></li>`).join("")}</ul>` : '<p class="dim">No house agent trades this token.</p>'}
  <p style="margin-top:20px"><a class="btn ghost" href="/studio?market=${esc(symbol)}">Replay a strategy on ${esc(symbol)}</a></p></aside>
</div></section>`;
  return layout({ title: `${symbol} · Tauro`, description: `${m.name} stock token on Robinhood Chain: hourly Chainlink closes.`, path: `/markets/${symbol}` }, body);
}

export function renderVerify(): string {
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Verify</p><h1>Check an hour <em>yourself.</em></h1>
<p class="lead">Pick an hour and a subject (an agent id, a stock symbol or status.json). Your browser fetches the public record, rebuilds the leaf with keccak256, walks the Merkle proof, then reads SealRegistry on Robinhood Chain directly from a public RPC. Our server is only asked for the record and the proof.</p></div></div>
<section style="padding-top:40px"><div class="wrap tool">
  <form class="card panel" data-verify-form>
    <div class="field"><label for="v-hour">Hour (UTC)</label><select id="v-hour" name="hour"><option value="">Loading sealed hours…</option></select><small>Only hours confirmed on chain are listed.</small></div>
    <div class="field"><label for="v-subject">Subject</label><input id="v-subject" name="subject" type="text" value="house-momentum-tsla" autocomplete="off" spellcheck="false"><small>An agent id such as house-dip-hunter-nvda, a symbol such as TSLA, or status.json.</small></div>
    <button class="btn" type="submit">Verify in my browser</button>
    <p class="dim" style="font-size:13px;margin:14px 0 0">Contract: <a class="mono" href="${EXPLORER}/address/0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14">0xfb88…eE14</a> · <a href="https://repo.sourcify.dev/4663/0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14">verified source</a></p>
  </form>
  <div class="card panel" aria-live="polite">
    <h2>Result</h2>
    <ul class="checklist" data-verify-out><li><span class="mk">·</span><span>Choose an hour and press Verify.</span></li></ul>
    <details style="margin-top:16px"><summary style="font-weight:600;min-height:44px;display:flex;align-items:center">The record that was checked</summary><pre class="code" data-verify-record>Nothing yet.</pre></details>
  </div>
</div></section>`;
  return layout({ title: "Verify · Tauro", description: "Rebuild any sealed decision in your browser and check it against the root on Robinhood Chain.", path: "/verify", scripts: ["/js/verify.js"] }, body);
}

export function renderStudio(): string {
  const tpl = Object.entries(TEMPLATE_LABEL)
    .map(([k, v], i) => `<button type="button" class="chip" data-template="${k}" aria-pressed="${i === 0}">${esc(v)}</button>`)
    .join("");
  const opts = MARKETS.map((m) => `<option value="${esc(m.symbol)}">${esc(m.symbol)} · ${esc(m.name)}</option>`).join("");
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Studio</p><h1>Shape an agent. <em>Replay it.</em></h1>
<p class="lead">Pick a strategy and a stock token, adjust the stop loss and order size, and replay it on every hourly close we have. The replay runs in your browser with the same engine the house agents use. Saving and running your own agent is not open yet.</p></div></div>
<section style="padding-top:40px"><div class="wrap tool">
  <form class="card panel" data-studio>
    <div class="field"><label id="tpl-l">Strategy</label><div class="chips" role="group" aria-labelledby="tpl-l">${tpl}</div><small data-tpl-desc></small></div>
    <div class="field"><label for="s-market">Stock token</label><select id="s-market" name="market">${opts}</select></div>
    <div class="field"><label for="s-stop">Stop loss, %</label><input id="s-stop" name="stop" type="number" min="0.5" max="50" step="0.5" value="3"></div>
    <div class="field"><label for="s-size">Order size, USD of $1,000</label><input id="s-size" name="size" type="number" min="10" max="1000" step="10" value="100"></div>
    <p class="dim" style="font-size:13px;margin:0">Fills at the next hour's close with a 0.5% fee per fill, like the house agents. The comparison holds the same dollar amount from the first hour and keeps the rest in cash. Past results do not predict future ones.</p>
  </form>
  <div class="card panel" aria-live="polite" data-studio-out>
    <p class="dim" style="margin:0" data-range>Loading hourly closes…</p>
    <div style="display:flex;gap:32px;flex-wrap:wrap;align-items:end;margin:14px 0 6px">
      <div><div class="dim" style="font-size:13px">This strategy</div><div class="big-result" data-ret>…</div></div>
      <div><div class="dim" style="font-size:13px">Holding the same amount</div><div style="font:400 30px/1 var(--serif)" data-hold>…</div></div>
    </div>
    <div data-chart></div>
    <div class="legend"><span><i></i>Strategy</span><span><i class="b"></i>Holding</span></div>
    <p data-verdict style="margin:14px 0 0"></p>
    <dl class="facts" style="margin-top:16px"><dt>Fills</dt><dd data-fills>…</dd><dt>Worst drop</dt><dd data-dd>…</dd><dt>Ending value</dt><dd data-end>…</dd></dl>
  </div>
</div></section>`;
  return layout({ title: "Studio · Tauro", description: "Replay a trading strategy on hourly Chainlink closes for Robinhood Chain stock tokens, in your browser.", path: "/studio", scripts: ["/js/studio.js"] }, body);
}

export function renderNotFound(): string {
  return layout(
    { title: "Not found · Tauro", description: "This page does not exist.", path: "/404" },
    `<div class="page-head" style="border:0"><div class="wrap"><p class="eyebrow">Error 404</p><h1>No record <em>for this page.</em></h1><p class="lead">The link may be old, or it never existed. Everything that did exist is sealed.</p><p style="margin-top:24px"><a class="btn" href="/">Back to the home page</a></p></div></div>`,
  );
}
