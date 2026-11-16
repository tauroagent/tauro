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

// Reveal on scroll, odometers, and the statement that lights up as you read.
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    if (e.target.matches("[data-odo]")) e.target.querySelectorAll("[data-d]").forEach((s) => { s.style.transform = `translateY(-${Number(s.dataset.d) * 1.05}em)`; });
    io.unobserve(e.target);
  }
}, { rootMargin: "0px 0px -10% 0px" }) : null;
if (io) {
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("[data-odo]").forEach((el) => {
      el.querySelectorAll("[data-d]").forEach((s) => { s.style.transform = "translateY(0)"; });
      io.observe(el);
    });
  }
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
}
const lit = document.querySelector("[data-lit]");
if (lit) {
  const spans = [...lit.querySelectorAll("span")];
  const onScroll = () => {
    const r = lit.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
    spans.forEach((s, i) => s.classList.toggle("on", p > i / spans.length));
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
