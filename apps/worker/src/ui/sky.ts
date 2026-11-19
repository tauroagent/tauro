import { agentName, TEMPLATE_LABEL } from "../data.js";
import type { HomeModel } from "./home.js";
import { TOKEN } from "../token.js";
import { esc, int, pct, pts, short, tone, usd, utcHour, utcStamp } from "./util.js";

const I = {
  board: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
  mkt: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12 L6 7 L9 9 L14 3"/></svg>`,
  studio: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4 H13 M3 8 H10 M3 12 H7"/></svg>`,
  verify: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 L6.5 11.5 L12.5 4.5"/></svg>`,
  seal: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 6.5 Q5.5 8 7 8 H9 Q10.5 8 10.5 6.5 M8 8 V11"/></svg>`,
  api: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 4 L2 8 L5 12 M11 4 L14 8 L11 12"/></svg>`,
};

export function skyHero(m: HomeModel): string {
  const st = m.stats;
  const s = st.lastSeal;
  const best = [...m.showcase].sort((a, b) => b.returnPct - b.holdPct - (a.returnPct - a.holdPct))[0];
  let chart = `<p style="color:#8b8988;font-size:13px">Replay starts once there is enough history.</p>`;
  if (best) {
    const all = [...best.equity, ...best.hold];
    const min = Math.min(...all), max = Math.max(...all), span = max - min || 1, W = 640, H = 150;
    const p = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * W).toFixed(1)} ${(8 + (1 - (v - min) / span) * (H - 16)).toFixed(1)}`).join("");
    const a = p(best.equity);
    chart = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(TEMPLATE_LABEL[best.template]!)} on ${esc(best.market)} compared with holding">
<defs><linearGradient id="vf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a020ff" stop-opacity=".55"/><stop offset="1" stop-color="#7a1cf8" stop-opacity="0"/></linearGradient></defs>
<path d="${a}L${W} ${H}L0 ${H}Z" fill="url(#vf)"/><path d="${p(best.hold)}" fill="none" stroke="#5c5866" stroke-width="1.4" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/><path d="${a}" fill="none" stroke="#c27bff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const hours = m.seals
    .map((x) => `<span class="${x.status === "confirmed" && x.timing === "on_time" ? "ok" : x.status === "missed" || x.status === "failed" ? "miss" : ""}" title="${esc(utcStamp(x.hour))}: ${esc(x.status)}">${esc(utcHour(x.hour).slice(0, 2))}</span>`)
    .join("");
  const top = m.agents[0];
  const onTimeRate = st.sealsTotal ? (st.sealedOnTime / st.sealsTotal) * 100 : null;
  return `<section class="sky" aria-labelledby="hero-h">
  <canvas data-sky aria-hidden="true"></canvas>
  <div class="planet-surface" data-planet aria-hidden="true"></div>
  <video class="sky-video" data-sky-video muted playsinline loop preload="none" aria-hidden="true" width="1168" height="768"></video>
  <div class="hero-c">
    <h1 id="hero-h"><span class="ln"><span><span class="grad">Tauro</span> agents trade by rules,</span></span><span class="ln"><span>sealed every hour.</span></span></h1>
    <p class="lead">Paper trading agents for tokenized stocks on Robinhood Chain. Each hour they read Chainlink prices, decide to buy, sell or hold, and the decision is sealed on chain before the next close, so anyone can check it.</p>
    <div class="ctas"><a class="btn" href="/verify?fake=1#fake">Try to fake a trade</a><a class="btn soft" href="/agents">See live agents</a></div>
    <button class="ca-chip" type="button" data-copy="${TOKEN.address}" aria-label="Copy the $${TOKEN.symbol} contract address ${TOKEN.address}">
      <span class="ca-k">$${TOKEN.symbol} CA</span><code>${TOKEN.address.slice(0, 6)}…${TOKEN.address.slice(-4)}</code>
      <span class="ca-act" data-copy-label aria-live="polite">Copy</span>
    </button>
  </div>
  <div class="dash-wrap">
    <div class="dash-glow" aria-hidden="true"></div>
    <div class="dash">
      <nav class="side" aria-label="Desk">
        <div class="ttl"><span><img src="/brand/mark-violet.svg" alt="" width="22" height="22">Tauro</span></div>
        <a class="on" href="/agents">${I.board}Leaderboard</a>
        <a href="/markets">${I.mkt}Markets</a>
        <a href="/studio">${I.studio}Studio</a>
        <a href="/verify">${I.verify}Verify</a>
        <div class="sep"></div>
        <a href="/api/v1/seals">${I.seal}Seals</a>
        <a href="/api/v1">${I.api}Read API</a>
        <div class="promo"><b>Every hour, sealed</b>Rebuild any decision in your browser and prove it against the root on chain.<br><a href="/verify">Verify an hour</a></div>
      </nav>
      <div class="mid">
        <div class="bar"><span>${s?.block_time ? `Last seal ${esc(utcStamp(s.block_time))}` : "Sealed hourly"}</span>
          <span class="who"><span class="dot"><img src="/brand/mark-mono.svg" alt="" width="18" height="18" style="filter:invert(1)"></span><span>SealRegistry<small>${s?.tx_hash ? esc(short(s.tx_hash, 6, 4)) : "0xfb88…eE14"}</small></span></span></div>
        <div class="kpi2">
          <div><div class="k">Decisions sealed (since start)</div><div class="v">${int(st.decisions)}</div><div class="d" style="color:#8b8988">${int(st.agents)} house agents, hourly</div></div>
          <div><div class="k">Hours sealed on time</div><div class="v">${int(st.sealedOnTime)}<span style="font-size:.6em;color:#8b8988"> / ${int(st.sealsTotal)}</span></div><div class="d ${onTimeRate === 100 ? "up" : ""}">${onTimeRate === null ? "first seal pending" : `${int(st.missedTotal)} missed, still shown`}</div></div>
        </div>
        <div class="chart-box">
          <div class="h">${best ? `Replay: ${esc(TEMPLATE_LABEL[best.template]!)} on ${esc(best.market)}` : "Replay"}<span>${best ? `${pct(best.returnPct)} vs holding ${pct(best.holdPct)}` : ""}</span></div>
          ${chart}
        </div>
      </div>
      <aside class="right" aria-label="Seal ledger">
        <div class="mh">Last 24 hours<span style="font-size:12px;color:#8b8988;font-weight:400">UTC</span></div>
        <div class="hours">${hours}</div>
        <div class="row2"><span>Leaves in last seal</span><b>${s ? int(s.leaf_count) : "n/a"}</b></div>
        <div class="row2"><span>Top agent</span><b>${top ? esc(agentName(top)) : "n/a"}</b></div>
        <div class="row2"><span>Its return</span><b class="${top ? tone(top.return_pct) : ""}">${top ? pct(top.return_pct) : "n/a"}</b></div>
        <div class="row2"><span>vs holding</span><b class="${top ? tone(top.vs_hold_pts) : ""}">${top ? pts(top.vs_hold_pts) : "n/a"}</b></div>
        <div class="row2" style="border:0"><span>Value</span><b>${top?.equity == null ? "n/a" : usd(top.equity)}</b></div>
      </aside>
    </div>
  </div>
</section>`;
}
