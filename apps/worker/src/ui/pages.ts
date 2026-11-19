import { agentName, explain, ownerLabel, TEMPLATE_LABEL, type AgentSummary, type DecisionRow, type MarketCard } from "../data.js";
import { MARKETS } from "../universe.js";
import { MIN_RANKED } from "../calls.js";
import { layout } from "./layout.js";
import { esc, int, lineChart, pct, price, pts, short, spark, tone, usd, utcStamp } from "./util.js";

const EXPLORER = "https://robinhoodchain.blockscout.com";

function agentRows(agents: AgentSummary[]): string {
  return agents
    .map(
      (a, i) => `<tr>
  <td class="rank">${i + 1}</td>
  <td><a class="row-link" href="/agents/${esc(a.id)}">${esc(agentName(a))}</a><div class="dim" style="font-size:13px">${esc(ownerLabel(a.owner))} · paper</div></td>
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
  <p class="lead">Every agent, ranked by paper return since it started, next to holding the same dollar amount of its market from the start. ${since ? `House agents started ${esc(since)}.` : ""} Holder agents are run by TAURO holders, <a href="/token">one per slot</a>. All of them are paper.</p>
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
      (d) => `<li class="entry"><div class="head"><span class="who"><span class="tagc ${esc(d.action)}">${esc(d.action)}</span>${esc(utcStamp(d.hour))}</span><a class="proof" href="/verify?hour=${d.hour}&amp;subject=${encodeURIComponent(a.id)}">Proof</a></div><p>${esc(explain(d))}</p></li>`,
    )
    .join("");
  const body = `<div class="page-head"><div class="wrap">
  <p class="crumbs"><a href="/agents">Agents</a> / ${esc(a.id)}</p>
  <h1>${esc(agentName(a))}</h1>
  <p style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0"><span class="tag">${a.owner === "house" ? "House agent" : `Holder agent · <a href="https://robin.etherscan.io/address/${esc(a.owner)}">${esc(ownerLabel(a.owner).replace("Holder ", ""))}</a>`}</span><span class="tag paper">Paper</span><span class="tag">${esc(TEMPLATE_LABEL[a.template] ?? a.template)}</span><span class="tag">${a.qty > 0 ? "Holding " + esc(a.market) : "Flat"}</span></p>
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
</div></section>
<section style="padding-top:0" id="fake"><div class="wrap">
  <div class="card panel fake" data-fake hidden>
    <p class="eyebrow">Try to fake a trade</p>
    <h2>Change one number. Watch the proof break.</h2>
    <p class="dim">This is the sealed record you just checked. Edit any value (a price, an action, a size), then check your edit against the same proof and the root on Robinhood Chain. Nothing you type leaves your browser except one read-only contract call.</p>
    <label class="sr" for="fake-input">Sealed record</label>
    <textarea id="fake-input" class="code" data-fake-input rows="14" spellcheck="false" autocomplete="off"></textarea>
    <div class="ctas" style="margin-top:14px"><button class="btn" type="button" data-fake-run>Check my edit</button><button class="btn soft" type="button" data-fake-reset>Reset to the sealed record</button></div>
    <ul class="checklist" data-fake-out style="margin-top:12px"></ul>
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
<p class="lead">Pick a strategy and a stock token, adjust the stop loss and order size, and replay it on every hourly close we have. The replay runs in your browser with the same engine the house agents use. Like it? TAURO holders can run it as their own paper agent, sealed every hour.</p></div></div>
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
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="card panel holder" data-holder>
  <h2 style="font-size:22px;margin:0 0 6px">Run it as your agent</h2>
  <p class="dim" style="margin:0 0 14px">Your wallet signs a message with the settings above. No transaction, no fee. From the next hour your agent decides every hour next to the house agents, and its rules and decisions are sealed on Robinhood Chain. Needs a free slot: hold 1,000,000 TAURO for one, 5,000,000 for three, or burn TAURO for more. <a href="/token">How slots work</a></p>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn" type="button" data-connect>Connect wallet</button>
    <button class="btn soft" type="button" data-launch hidden>Sign and start</button>
    <span class="dim" style="font-size:14px" data-wallet aria-live="polite"></span>
  </div>
  <p data-holder-msg aria-live="polite" style="margin:12px 0 0"></p>
</div></div></section>`;
  return layout({ title: "Studio · Tauro", description: "Replay a trading strategy on hourly Chainlink closes for Robinhood Chain stock tokens, in your browser.", path: "/studio", scripts: ["/js/studio.js", "/js/holder.js"] }, body);
}

export function renderNotFound(): string {
  return layout(
    { title: "Not found · Tauro", description: "This page does not exist.", path: "/404" },
    `<div class="page-head" style="border:0"><div class="wrap"><p class="eyebrow">Error 404</p><h1>No record <em>for this page.</em></h1><p class="lead">The link may be old, or it never existed. Everything that did exist is sealed.</p><p style="margin-top:24px"><a class="btn" href="/">Back to the home page</a></p></div></div>`,
  );
}

export interface TokenPage {
  address: string;
  hold: { min_tauro: number; slots: number }[];
  burn: { per_slot_tauro: number; slot_days: number };
  totalBurned: number;
  burns: { tx_hash: string; owner: string; tauro: number; slots: number; block_time: string; expires_at: string }[];
  holderAgents: number;
}

export function renderToken(t: TokenPage): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const rows = t.burns.length
    ? `<div class="scroll"><table class="table"><thead><tr><th scope="col">When (UTC)</th><th scope="col">Wallet</th><th scope="col" class="num">TAURO</th><th scope="col" class="num">Slots</th><th scope="col" class="hide-sm">Until</th><th scope="col">Tx</th></tr></thead><tbody>${t.burns
        .map((b) => `<tr><td>${esc(b.block_time.slice(0, 16).replace("T", " "))}</td><td><code>${esc(short(b.owner))}</code></td><td class="num">${fmt(b.tauro)}</td><td class="num">${b.slots}</td><td class="hide-sm">${esc(b.expires_at.slice(0, 10))}</td><td><a href="https://robin.etherscan.io/tx/${esc(b.tx_hash)}">${esc(short(b.tx_hash))}</a></td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="state">No burns recorded yet.</p>`;
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">$TAURO</p><h1>Hold it, run an agent. <em>Burn it, run more.</em></h1>
<p class="lead">TAURO is the key to holder agents: your own paper trading agent that decides every hour next to the house agents, with its rules and every decision sealed on Robinhood Chain. Nothing else. The token pays nothing and shares in nothing.</p></div></div>
<section style="padding-top:40px"><div class="wrap">
  <div class="cards3">
    ${t.hold.map((h) => `<div class="card panel"><div class="dim" style="font-size:13px">Hold</div><div class="big-result">${fmt(h.min_tauro)}</div><p style="margin:6px 0 0">TAURO in one wallet: <b>${h.slots} agent slot${h.slots > 1 ? "s" : ""}</b></p></div>`).join("")}
    <div class="card panel"><div class="dim" style="font-size:13px">Burn</div><div class="big-result">${fmt(t.burn.per_slot_tauro)}</div><p style="margin:6px 0 0">TAURO sent to 0x…dEaD: <b>+1 slot for ${t.burn.slot_days} days</b></p></div>
  </div>
  <ul class="how-list"><li><b>Checked.</b> Every hourly run reads each holder's balance on chain. Agents beyond your slots pause, oldest first keeps running, and resume when slots return.</li><li><b>Start one.</b> Shape it in <a href="/studio">Studio</a>, then sign. A signature, not a transaction: no gas, no fee.</li><li><b>Burn.</b> Send TAURO from your wallet to 0x000000000000000000000000000000000000dEaD, then paste the tx below. It is checked on chain before it counts. Burns before 18 November 2026 do not count.</li><li><b>Running now.</b> ${int(t.holderAgents)} holder agent${t.holderAgents === 1 ? "" : "s"}. <a href="/agents">Leaderboard</a></li><li><b>Contract.</b> <code>${esc(t.address)}</code></li></ul>
</div></section>
<section style="padding-top:0"><div class="wrap tool">
  <form class="card panel" data-tier-form><h2 style="font-size:20px;margin:0 0 10px">Check a wallet</h2>
    <div class="field"><label for="t-addr">Wallet address</label><input id="t-addr" name="address" placeholder="0x…" autocomplete="off" spellcheck="false"></div>
    <button class="btn" type="submit">Check slots</button><div data-tier-out aria-live="polite" style="margin-top:12px"></div></form>
  <form class="card panel" data-burn-form><h2 style="font-size:20px;margin:0 0 10px">Record a burn</h2>
    <div class="field"><label for="t-tx">Burn transaction hash</label><input id="t-tx" name="tx" placeholder="0x…" autocomplete="off" spellcheck="false"></div>
    <button class="btn" type="submit">Check and record</button><div data-burn-out aria-live="polite" style="margin-top:12px"></div></form>
</div></section>
<section style="padding-top:0"><div class="wrap"><h2 style="font-size:22px">Burns <span class="dim" style="font-size:16px">${fmt(t.totalBurned)} TAURO in total</span></h2>${rows}
<p class="dim" style="font-size:13px;margin-top:12px">JSON: <a href="/api/v1/burns">/api/v1/burns</a> · <a href="/api/v1/tier?address=${esc(t.address)}">/api/v1/tier</a>. Holder agents are paper, like every agent here. Not investment advice.</p></div></section>`;
  return layout({ title: "$TAURO slots · Tauro", description: "Hold TAURO to run your own paper trading agent on Robinhood Chain, sealed every hour. Burn TAURO for more slots.", path: "/token", scripts: ["/js/holder.js"] }, body);
}

// ---- Sealed calls
type CallView = Awaited<ReturnType<typeof import("../calls.js").callView>>;
type CallRulesT = ReturnType<typeof import("../calls.js").callRules>;
type Board = Awaited<ReturnType<typeof import("../calls.js").leaderboard>>;
type CallerStatsT = Board["callers"][number];
const SITE = "https://tauroagent.com";
const signed = (v: number | null, d = 2): string => (v === null ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const hit = (c: CallerStatsT): string => (c.hit_rate === null ? "n/a" : `${Math.round(c.hit_rate)}%`);
const resultText = (c: CallView): string => {
  const o = c.outcome;
  if (o.state === "resolved") return `${o.right ? "right" : "wrong"}, ${o.move_pct! >= 0 ? "+" : "−"}${Math.abs(o.move_pct!).toFixed(2)}%`;
  if (o.state === "open") return "open";
  if (o.state === "waiting_for_seal") return "waiting for its seal";
  return "no close for that hour";
};
const intent = (text: string, url: string): string => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

function boardRows(cs: CallerStatsT[], startRank = 1): string {
  return cs.map((c, i) => `<tr><td class="rank">${c.ranked ? startRank + i : "–"}</td><td><a class="row-link" href="/callers/${esc(c.caller)}"><code>${esc(short(c.caller))}</code></a></td>
<td class="num">${hit(c)}</td><td class="num">${int(c.right)} / ${int(c.resolved)}</td><td class="num ${tone(c.avg_edge_pct)}">${signed(c.avg_edge_pct)}</td><td class="num hide-sm">${int(c.open)}</td><td class="hide-sm">${c.best ? `<a href="/calls/${esc(c.best.id)}">${esc(c.best.market)} ${c.best.side} ${c.best.horizon_hours} h, ${signed(c.best.edge_pct)}</a>` : `<span class="dim">none yet</span>`}</td></tr>`).join("");
}
const BOARD_HEAD = `<thead><tr><th scope="col">#</th><th scope="col">Caller</th><th scope="col" class="num">Hit rate</th><th scope="col" class="num">Right</th><th scope="col" class="num">Avg move</th><th scope="col" class="num hide-sm">Open</th><th scope="col" class="hide-sm">Best call</th></tr></thead>`;

const callState = (c: CallView): string => {
  const o = c.outcome;
  if (o.state === "waiting_for_seal") return `<span class="dim">waiting for its hourly seal</span>`;
  if (o.state === "no_price") return `<span class="dim">no close for that hour</span>`;
  if (o.state === "open") return `open until ${esc(o.resolves_at.slice(0, 16).replace("T", " "))} UTC`;
  return `<span class="${o.right ? "up" : "down"}">${o.right ? "right" : "wrong"}, ${o.move_pct! >= 0 ? "+" : ""}${o.move_pct!.toFixed(2)}%</span>`;
};

const callLine = (c: CallView): string => `${esc(c.market)} ${c.side === "up" ? "up" : "down"} within ${c.horizon_hours} h`;

export function renderCalls(calls: CallView[], rules: CallRulesT, board?: Board): string {
  const opts = rules.markets.map((m) => `<option value="${esc(m)}"${m === "NVDA" ? " selected" : ""}>${esc(m)}</option>`).join("");
  const hz = rules.horizons_hours.map((h) => `<option value="${h}"${h === 24 ? " selected" : ""}>${h} hour${h > 1 ? "s" : ""}</option>`).join("");
  const rows = calls.length
    ? `<div class="scroll"><table class="table"><thead><tr><th scope="col">Signed (UTC)</th><th scope="col">Caller</th><th scope="col">Call</th><th scope="col" class="hide-sm">Sealed hour</th><th scope="col">Result</th></tr></thead><tbody>${calls
        .map((c) => `<tr><td>${esc(c.submitted_at.slice(0, 16).replace("T", " "))}</td><td><code>${esc(short(c.caller))}</code></td><td><a class="row-link" href="/calls/${esc(c.id)}">${callLine(c)}</a>${c.note ? `<div class="dim" style="font-size:13px">${esc(c.note)}</div>` : ""}</td><td class="hide-sm">${esc(c.sealed_hour_utc.slice(0, 16).replace("T", " "))} · ${esc(c.seal.status)}</td><td>${callState(c)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="state">No calls yet. Be the first on the record.</p>`;
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Sealed calls</p><h1>Make a call. <em>Seal it on chain.</em></h1>
<p class="lead">Sign a call on any Robinhood Chain stock token. It goes into the next hourly root on Robinhood Chain, so it cannot be edited, deleted or backdated. The entry is that hour's Chainlink close, and the result is read when your horizon ends. Free, a signature, not a transaction.</p></div></div>
<section style="padding-top:40px"><div class="wrap tool" data-call>
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">Your call</h2>
    <div class="field"><label for="c-market">Stock token</label><select id="c-market">${opts}</select></div>
    <div class="field"><label id="c-side-l">Call</label><div class="chips" role="group" aria-labelledby="c-side-l"><button type="button" class="chip" data-side="up" aria-pressed="true">Up</button><button type="button" class="chip" data-side="down" aria-pressed="false">Down</button></div></div>
    <div class="field"><label for="c-horizon">Within</label><select id="c-horizon">${hz}</select></div>
    <div class="field"><label for="c-note">Note <span class="dim">(optional, one line, ${rules.note_max} characters)</span></label><input id="c-note" maxlength="${rules.note_max}" autocomplete="off" placeholder="Why, in one line"></div>
    <div class="ctas"><button class="btn" type="button" data-connect>Connect wallet</button><button class="btn soft" type="button" data-sign hidden>Sign and seal</button></div>
    <p data-wallet class="dim" style="font-size:13px;margin:10px 0 0"></p><div data-call-msg aria-live="polite" style="margin-top:10px"></div></div>
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">How it is scored</h2>
    <ul class="how-list" style="margin:0"><li><b>Sealed.</b> Your signed text is a leaf in the next hourly Merkle root on SealRegistry. Anyone can check it with the proof link.</li><li><b>Entry.</b> ${esc(rules.entry)}.</li><li><b>Result.</b> ${esc(rules.result)}</li><li><b>Limit.</b> ${esc(rules.limit)}. Paper only: no trade, no money, nothing to pay.</li></ul></div>
</div></section>
${board ? `<section style="padding-top:0"><div class="wrap"><h2 style="font-size:22px">Leaderboard <a class="btn ghost" style="margin-left:10px;font-size:14px" href="/calls/leaderboard">Full board</a></h2>${board.callers.length ? `<div class="scroll"><table class="table">${BOARD_HEAD}<tbody>${boardRows(board.callers.slice(0, 5))}</tbody></table></div>` : `<p class="state">No callers yet.</p>`}
<p class="dim" style="font-size:13px;margin-top:8px">${esc(board.rules.ranking)}</p></div></section>` : ""}
<section style="padding-top:0"><div class="wrap"><h2 style="font-size:22px">Latest calls</h2>${rows}
<p class="dim" style="font-size:13px;margin-top:12px">JSON: <a href="/api/v1/calls">/api/v1/calls</a>. Calls are opinions of the wallets that signed them, not Tauro's. Not investment advice.</p></div></section>`;
  return layout({ title: "Sealed calls · Tauro", description: "Sign a call on a Robinhood Chain stock token. It is sealed in the next hourly root on chain: no edits, no backdating. Free.", path: "/calls", scripts: ["/js/calls.js"] }, body);
}

export function renderCall(c: CallView): string {
  const tx = c.seal.status === "confirmed" && "tx_hash" in c.seal && c.seal.tx_hash ? `<a href="${EXPLORER}/tx/${esc(c.seal.tx_hash)}">${esc(short(c.seal.tx_hash))}</a>` : esc(c.seal.status);
  const o = c.outcome;
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Sealed call · <code>${esc(c.id)}</code></p><h1>${callLine(c)}</h1>
<p class="lead">Signed by <code>${esc(short(c.caller))}</code> at ${esc(c.submitted_at.slice(0, 16).replace("T", " "))} UTC, sealed in the ${esc(c.sealed_hour_utc.slice(11, 16))} UTC hour of ${esc(c.sealed_hour_utc.slice(0, 10))}.${c.note ? ` “${esc(c.note)}”` : ""}</p></div></div>
<section style="padding-top:40px"><div class="wrap tool">
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">Result</h2><dl class="facts">
    <dt>State</dt><dd>${callState(c)}</dd>
    <dt>Entry close</dt><dd>${o.entry === null ? "n/a" : "$" + o.entry.toFixed(2)}</dd>
    <dt>Close at the end</dt><dd>${o.exit === null ? "n/a" : "$" + o.exit.toFixed(2)}</dd>
    <dt>Resolves</dt><dd>${esc(o.resolves_at.slice(0, 16).replace("T", " "))} UTC</dd></dl></div>
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">On chain</h2><dl class="facts">
    <dt>Seal</dt><dd>${tx}</dd><dt>Root</dt><dd><code>${"root" in c.seal && c.seal.root ? esc(short(c.seal.root, 10, 6)) : "pending"}</code></dd></dl>
    <p style="margin:12px 0 0"><a class="btn ghost" href="${esc(c.proof)}">Proof JSON</a> <a class="btn ghost" href="/verify">Verify in your browser</a></p></div>
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="card panel" data-card data-kind="call" data-line="${esc(`${c.market} ${c.side} within ${c.horizon_hours} h`)}" data-note="${esc(c.note)}" data-caller="${esc(short(c.caller))}" data-hour="${esc(c.sealed_hour_utc.slice(0, 10) + ", " + c.sealed_hour_utc.slice(11, 16) + " UTC")}" data-entry="${o.entry === null ? "n/a" : "$" + o.entry.toFixed(2)}" data-exit="${o.exit === null ? "" : "$" + o.exit.toFixed(2)}" data-result="${esc(resultText(c))}" data-tone="${o.state === "resolved" ? (o.right ? "up" : "down") : ""}" data-tx="${"tx_hash" in c.seal && c.seal.tx_hash ? esc(short(c.seal.tx_hash, 10, 6)) : "pending"}" data-path="${esc("tauroagent.com/calls/" + c.id)}" data-file="${esc(c.id)}">
  <h2 style="font-size:20px;margin:0 0 6px">Share this call</h2><p class="dim" style="margin:0 0 12px;font-size:14px">A card with the call, its seal and its result. Right or wrong, it shows what happened.</p>
  <canvas data-canvas width="1200" height="675" style="width:100%;max-width:600px;height:auto;border-radius:12px;display:block" role="img" aria-label="Share card for this call"></canvas>
  <p class="ctas" style="margin:12px 0 0"><button class="btn" type="button" data-download>Download card</button> <a class="btn soft" href="${esc(intent(c.outcome.state === "resolved" ? `My call: ${c.market} ${c.side} within ${c.horizon_hours} h. Sealed on Robinhood Chain before the move, scored by Chainlink. Result: ${resultText(c)}.` : `My call: ${c.market} ${c.side} within ${c.horizon_hours} h. Sealed on Robinhood Chain, so I can't edit it if I'm wrong.`, `${SITE}/calls/${c.id}`))}" target="_blank" rel="noopener">Post on X</a></p></div></div></section>
<section style="padding-top:0"><div class="wrap"><h2 style="font-size:20px">The signed text</h2><pre class="card panel" style="white-space:pre-wrap;font-size:13px">${esc(c.message)}</pre>
<p class="dim" style="font-size:13px">Signature <code>${esc(short(c.signature, 10, 8))}</code>. A call is the opinion of the wallet that signed it, not Tauro's. Paper only. Not investment advice. <a href="/calls">All calls</a> · <a href="/callers/${esc(c.caller)}">This caller's record</a></p></div></section>`;
  return layout({ title: `${c.market} ${c.side} within ${c.horizon_hours}h · sealed call · Tauro`, description: `${short(c.caller)} called ${c.market} ${c.side} within ${c.horizon_hours} hours, sealed on Robinhood Chain in the ${c.sealed_hour_utc.slice(11, 16)} UTC hour of ${c.sealed_hour_utc.slice(0, 10)}. No edits, no backdating.`, path: `/calls/${c.id}`, scripts: ["/js/callcard.js"] }, body);
}

export function renderLeaderboard(b: Board): string {
  const ranked = b.callers.filter((c) => c.ranked), rest = b.callers.filter((c) => !c.ranked);
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Sealed calls · leaderboard</p><h1>Who called it. <em>On the record.</em></h1>
<p class="lead">Every call here was signed before the price moved and sealed on Robinhood Chain. Wrong calls stay on the board with the right ones. Nobody can delete a miss, us included.</p>
<p class="ctas"><a class="btn" href="/calls">Make a call</a></p></div></div>
<section style="padding-top:40px"><div class="wrap"><h2 style="font-size:22px">Ranked <span class="dim" style="font-size:16px">${int(ranked.length)} wallets with ${b.rules.min_resolved}+ resolved calls</span></h2>
${ranked.length ? `<div class="scroll"><table class="table">${BOARD_HEAD}<tbody>${boardRows(ranked)}</tbody></table></div>` : `<p class="state">Nobody is ranked yet. A wallet needs ${b.rules.min_resolved} resolved calls.</p>`}
${rest.length ? `<h2 style="font-size:20px;margin-top:32px">Not ranked yet <span class="dim" style="font-size:15px">fewer than ${b.rules.min_resolved} resolved calls</span></h2><div class="scroll"><table class="table">${BOARD_HEAD}<tbody>${boardRows(rest)}</tbody></table></div>` : ""}
<ul class="how-list" style="margin-top:20px"><li><b>Ranking.</b> ${esc(b.rules.ranking)}</li><li><b>Right.</b> ${esc(b.rules.right)}</li><li><b>Avg move.</b> ${esc(b.rules.edge)}</li></ul>
<p class="dim" style="font-size:13px">JSON: <a href="/api/v1/calls/leaderboard">/api/v1/calls/leaderboard</a>. Calls are the opinions of the wallets that signed them, not Tauro's. Paper only. Not investment advice.</p></div></section>`;
  return layout({ title: "Call leaderboard · Tauro", description: "Who called it, sealed on Robinhood Chain. Hit rate and average move for every wallet that signed a call. Misses stay on the board.", path: "/calls/leaderboard" }, body);
}

export function renderCaller(addr: string, rec: { stats: CallerStatsT | null; rank: number | null; ranked_wallets: number }, calls: CallView[]): string {
  const s = rec.stats;
  const rankTxt = rec.rank ? `#${rec.rank} of ${rec.ranked_wallets}` : s ? `not ranked yet (${s.resolved} of ${MIN_RANKED} resolved)` : "no calls yet";
  const rows = calls.map((c) => `<tr><td>${esc(c.submitted_at.slice(0, 16).replace("T", " "))}</td><td><a class="row-link" href="/calls/${esc(c.id)}">${callLine(c)}</a></td><td>${callState(c)}</td></tr>`).join("");
  const shareText = s ? `My sealed call record on Tauro: ${s.right} right of ${s.resolved} resolved${s.hit_rate === null ? "" : ` (${Math.round(s.hit_rate)}%)`}. Every call signed before the move and sealed on Robinhood Chain, misses included.` : "";
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Caller record</p><h1><code style="font-size:.6em">${esc(short(addr, 8, 6))}</code></h1>
<p class="lead">Every call this wallet signed on Tauro, sealed on Robinhood Chain. Rank: ${esc(rankTxt)}.</p></div></div>
<section style="padding-top:40px"><div class="wrap">${s ? `<div class="tool"><div class="card panel"><dl class="facts">
  <dt>Hit rate</dt><dd>${hit(s)}</dd><dt>Right</dt><dd>${int(s.right)} of ${int(s.resolved)} resolved</dd><dt>Avg move</dt><dd class="${tone(s.avg_edge_pct)}">${signed(s.avg_edge_pct)}</dd><dt>Open</dt><dd>${int(s.open)}</dd>
  <dt>Best call</dt><dd>${s.best ? `<a href="/calls/${esc(s.best.id)}">${esc(s.best.market)} ${s.best.side} ${s.best.horizon_hours} h, ${signed(s.best.edge_pct)}</a>` : "none resolved yet"}</dd></dl></div>
  <div class="card panel" data-card data-kind="record" data-caller="${esc(short(addr))}" data-hit="${hit(s)}" data-right="${s.right}" data-resolved="${s.resolved}" data-edge="${signed(s.avg_edge_pct)}" data-tone="${tone(s.avg_edge_pct)}" data-open="${s.open}" data-rank="${esc(rankTxt)}" data-path="${esc("tauroagent.com/callers/" + short(addr))}" data-file="tauro-record-${esc(addr.slice(2, 8))}">
  <h2 style="font-size:20px;margin:0 0 10px">Share this record</h2><canvas data-canvas width="1200" height="675" style="width:100%;height:auto;border-radius:12px;display:block" role="img" aria-label="Share card for this record"></canvas>
  <p class="ctas" style="margin:12px 0 0"><button class="btn" type="button" data-download>Download card</button> <a class="btn soft" href="${esc(intent(shareText, `${SITE}/callers/${addr}`))}" target="_blank" rel="noopener">Post on X</a></p></div></div>
<h2 style="font-size:22px;margin-top:32px">Calls</h2><div class="scroll"><table class="table"><thead><tr><th scope="col">Signed (UTC)</th><th scope="col">Call</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="state">This wallet has not signed a call yet. <a href="/calls">Make a call</a>.</p>`}
<p class="dim" style="font-size:13px;margin-top:12px">JSON: <a href="/api/v1/calls?caller=${esc(addr)}">/api/v1/calls?caller=${esc(short(addr))}</a> · <a href="/calls/leaderboard">Leaderboard</a>. Paper only. Not investment advice.</p></div></section>`;
  return layout({ title: `${short(addr)} · call record · Tauro`, description: s ? `${short(addr)}: ${s.right} right of ${s.resolved} resolved sealed calls on Robinhood Chain. Misses included.` : "A caller record on Tauro.", path: `/callers/${addr}`, scripts: s ? ["/js/callcard.js"] : [] }, body);
}

// ---- Seal bounty
export function renderBounty(): string {
  const body = `<div class="page-head"><div class="wrap"><p class="eyebrow">Bounty</p><h1>Fake one sealed decision. <em>Win 5,000,000 TAURO.</em></h1>
<p class="lead">Every hour Tauro seals its decisions, prices and calls into one Merkle root on SealRegistry on Robinhood Chain. If the seal works, nobody can change a sealed record after the fact, us included. Prove it does not, and the reward is yours.</p></div></div>
<section style="padding-top:40px"><div class="wrap tool">
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">What counts</h2><ul class="how-list" style="margin:0">
    <li><b>A forged record.</b> For any hour confirmed on chain, a record different from the published one, with a proof that verifies against <code>SealRegistry.sealOf(hour).root</code> under the leaf rule in <a href="/verify">Verify</a>.</li>
    <li><b>A rewritten hour.</b> A transaction that makes SealRegistry store a different root for an hour it has already sealed, or accept a seal from any address other than the signer fixed at deploy.</li>
    <li><b>A lying proof.</b> A request that makes <code>/api/v1/proof</code> report <code>root_matches_seal: true</code> for a record that is not the one sealed in that hour.</li></ul></div>
  <div class="card panel"><h2 style="font-size:20px;margin:0 0 10px">The terms</h2><ul class="how-list" style="margin:0">
    <li><b>Reward.</b> 5,000,000 TAURO for the first valid report, paid by the Tauro team to the wallet you name, within 7 days of confirming it.</li>
    <li><b>Report.</b> Privately, through GitHub's Report a vulnerability button on <a href="https://github.com/tauroagent/tauro/security">tauroagent/tauro</a>, with steps we can reproduce. We publish the report and the fix after it is fixed.</li>
    <li><b>Not in scope.</b> Missed hours (they are public by design), hours not yet confirmed, denial of service, phishing or stolen keys, and bugs in Robinhood Chain, Chainlink or wallets.</li>
    <li><b>Open until</b> 31 December 2026, 23:59 UTC. One reward in total.</li></ul></div>
</div></section>
<section style="padding-top:0"><div class="wrap"><p class="dim" style="font-size:13px">Source: <a href="https://github.com/tauroagent/tauro">github.com/tauroagent/tauro</a> (contracts/, packages/seal). SealRegistry has no owner, no upgrade path and no pause. No third-party audit. The reward is in TAURO, which pays nothing and shares in nothing.</p></div></section>`;
  return layout({ title: "Seal bounty · Tauro", description: "Fake one sealed decision on Tauro's SealRegistry on Robinhood Chain and win 5,000,000 TAURO. Rules and scope.", path: "/bounty" }, body);
}
