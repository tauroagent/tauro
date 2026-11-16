// Small progressive enhancements. The pages work without this file.
const root = document.documentElement;

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("tauro-theme", next); } catch {}
});

const menuBtn = document.querySelector("[data-menu]");
const menu = document.getElementById("mobile-nav");
menuBtn?.addEventListener("click", () => {
  const open = menuBtn.getAttribute("aria-expanded") !== "true";
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  menu?.setAttribute("data-open", String(open));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuBtn?.getAttribute("aria-expanded") === "true") { menuBtn.click(); menuBtn.focus(); }
});

const feed = document.querySelector("[data-feed]");
const feedBtn = document.querySelector("[data-feed-toggle]");
feedBtn?.addEventListener("click", () => {
  const paused = feed?.classList.toggle("paused");
  feedBtn.setAttribute("aria-pressed", String(!!paused));
  feedBtn.textContent = paused ? "Resume the feed" : "Pause the feed";
});

// Countdown to the next seal: cron runs at minute 1 of every hour.
const clock = document.querySelector("[data-next-seal]");
if (clock) {
  const tick = () => {
    const now = new Date();
    let mins = 60 - now.getUTCMinutes() + 1;
    if (now.getUTCMinutes() < 1) mins = 1 - now.getUTCMinutes();
    clock.textContent = `Next run in ${mins} min.`;
  };
  tick();
  setInterval(tick, 30_000);
}
