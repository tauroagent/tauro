import { esc } from "./util.js";

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  /** Extra <script type="module" src> paths, loaded with defer. */
  scripts?: string[];
}

const NAV = [
  ["/", "Home"],
  ["/agents", "Agents"],
  ["/markets", "Markets"],
  ["/studio", "Studio"],
  ["/verify", "Verify"],
] as const;

const X_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>`;
const GH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>`;
const MENU_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export function layout(meta: PageMeta, body: string): string {
  const url = `https://tauroagent.com${meta.path}`;
  const nav = NAV.map(([href, label]) => `<a href="${href}"${meta.path === href || (href !== "/" && meta.path.startsWith(href + "/")) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:image" content="https://tauroagent.com/brand/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@Tauro_Agent">
<meta name="theme-color" content="#000000">
<link rel="preload" href="/fonts/schibsted-grotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/css/site.css">
<script>document.documentElement.classList.add("js");try{var t=localStorage.getItem("tauro-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<script type="module" src="/js/site.js"></script>
${(meta.scripts ?? []).map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/"><img src="/brand/mark-violet.svg" alt="" width="28" height="28">Tauro</a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="top-right">
      <a class="icon-btn" href="https://github.com/tauroagent/tauro" aria-label="Source code on GitHub">${GH_ICON}</a>
      <a class="icon-btn" href="https://x.com/Tauro_Agent" aria-label="Tauro on X">${X_ICON}</a>
      <a class="btn sm hide-sm" href="/agents">See agents</a>
      <button class="icon-btn menu-btn" type="button" data-menu aria-expanded="false" aria-controls="mobile-nav" aria-label="Open menu">${MENU_ICON}</button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div>
      <a class="brand" href="/"><img src="/brand/mark-violet.svg" alt="" width="28" height="28">Tauro</a>
      <p style="max-width:40ch;margin:14px 0 0">Trading agents for tokenized stocks on Robinhood Chain. Rules you can read, decisions sealed on chain every hour.</p>
    </div>
    <div><h4>Product</h4><ul><li><a href="/agents">Agents</a></li><li><a href="/markets">Markets</a></li><li><a href="/studio">Studio</a></li><li><a href="/verify">Verify an hour</a></li></ul></div>
    <div><h4>Open data</h4><ul><li><a href="/api/v1">Read API</a></li><li><a href="/api/v1/seals">Seals</a></li><li><a href="/api/v1/status">Claims</a></li><li><a href="/llms.txt">llms.txt</a></li></ul></div>
    <div><h4>Source</h4><ul><li><a class="soc" href="https://github.com/tauroagent/tauro">${GH_ICON}<span>GitHub</span></a></li><li><a href="https://repo.sourcify.dev/4663/0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14">SealRegistry source</a></li><li><a class="soc" href="https://x.com/Tauro_Agent">${X_ICON}<span>X (@Tauro_Agent)</span></a></li></ul></div>
    <p class="legal">Paper trading only: no agent here trades real money yet. Not investment advice. Not available to US persons. Built on Robinhood Chain, not affiliated with or endorsed by Robinhood, Chainlink or Uniswap. MIT licensed.</p>
  </div>
</footer>
</body>
</html>`;
}
