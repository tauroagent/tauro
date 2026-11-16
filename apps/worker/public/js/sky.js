// Night sky for the home hero: static stars, and the glowing rim of a planet arching across the top.
// Stars are drawn once to an offscreen canvas. The rim breathes at about 20 fps and only while the
// hero is on screen; with reduced motion it is drawn once and stays still.
const canvas = document.querySelector("[data-sky]");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const starLayer = document.createElement("canvas");
  let W = 0, H = 0, dpr = 1, visible = true, last = 0;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    for (const c of [canvas, starLayer]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const s = starLayer.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.fillStyle = "#000"; s.fillRect(0, 0, W, H);
    let seed = 1337;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((W * H) / 2600);
    s.fillStyle = "#fff";
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * H, r = rand() < 0.08 ? 1.3 : rand() * 0.8 + 0.25;
      s.globalAlpha = rand() * 0.7 + 0.2; s.beginPath(); s.arc(x, y, r, 0, Math.PI * 2); s.fill();
    }
    s.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paint(t) {
    ctx.drawImage(starLayer, 0, 0, W, H);
    const mobile = W < 760;
    const R = Math.max(W * (mobile ? 1.6 : 1.15), 900);
    const rimY = H * (mobile ? 0.11 : 0.16);
    const cx = W / 2, cy = rimY - R;
    const b = reduce ? 1 : 0.86 + 0.14 * Math.sin(t / 1300);

    let g = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.22);
    g.addColorStop(0, `rgba(170,50,255,${0.85 * b})`);
    g.addColorStop(0.18, `rgba(140,30,250,${0.45 * b})`);
    g.addColorStop(1, "rgba(60,10,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();

    g = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    g.addColorStop(0, "#000"); g.addColorStop(0.86, "#07020f");
    g.addColorStop(0.95, `rgba(110,24,200,${0.9 * b})`); g.addColorStop(1, `rgba(214,150,255,${0.95 * b})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, "rgba(147,18,255,0)"); lg.addColorStop(0.3, "rgba(190,110,255,.8)");
    lg.addColorStop(0.5, "rgba(255,240,255,1)"); lg.addColorStop(0.7, "rgba(190,110,255,.8)"); lg.addColorStop(1, "rgba(147,18,255,0)");
    ctx.strokeStyle = lg; ctx.lineWidth = 3.2; ctx.shadowColor = "rgba(190,90,255,1)"; ctx.shadowBlur = 42 * b;
    ctx.stroke(); ctx.lineWidth = 1.4; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();

    g = ctx.createRadialGradient(cx, rimY, 0, cx, rimY, W * 0.42);
    g.addColorStop(0, `rgba(210,100,255,${0.5 * b})`); g.addColorStop(1, "rgba(200,90,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, rimY + W * 0.42);
  }

  function loop(t) {
    if (visible && t - last > 50) { last = t; paint(t); }
    requestAnimationFrame(loop);
  }

  size();
  paint(0);
  addEventListener("resize", () => { size(); paint(performance.now()); });
  if (!reduce) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    requestAnimationFrame(loop);
  }
}
