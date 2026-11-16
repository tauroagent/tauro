// Night sky for the home hero.
// - Three star layers drift away from the planet at different speeds (parallax), a few bright stars twinkle.
// - The Taurus constellation, from real star positions, is drawn in ultraviolet: its lines draw in on load,
//   Aldebaran (the bull's eye) glows, and the Pleiades sit on the shoulder. Its horns echo the Tauro mark.
// - On the left, a faint mythical line-art bull (Taurus) with star nodes.
// - The planet rim comes from a generated video on wide screens; the canvas rim is the fallback.
// Animation runs at about 30 fps, only while the hero is on screen; reduced motion draws one still frame.
const canvas = document.querySelector("[data-sky]");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, dpr = 1, visible = true, last = 0, videoOn = false, t0 = performance.now();
  let layers = [], twinklers = [];

  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Taurus: RA in hours, Dec in degrees (J2000, rounded). Lines follow the usual stick figure.
  const STARS = {
    ald: [4.599, 16.51, 1.0], the: [4.478, 15.87, 0.55], gam: [4.330, 15.63, 0.55], del: [4.382, 17.54, 0.5],
    eps: [4.477, 19.18, 0.6], tau: [4.704, 22.96, 0.5], bet: [5.438, 28.61, 0.85], zet: [5.627, 21.14, 0.7],
    lam: [4.011, 12.49, 0.5], omi: [3.414, 9.03, 0.45], xi: [3.453, 9.73, 0.45],
  };
  const LINES = [["zet", "ald"], ["ald", "the"], ["the", "gam"], ["gam", "del"], ["del", "eps"], ["eps", "tau"], ["tau", "bet"], ["gam", "lam"], ["lam", "xi"], ["xi", "omi"]];
  const PLEIADES = [[3.791, 24.11], [3.819, 24.05], [3.763, 24.37], [3.749, 24.11], [3.774, 23.95], [3.754, 24.47], [3.817, 23.91]];

  function project(ra, dec, box) {
    // Sky as seen from Earth: RA grows to the east (left). Box is {x, y, w, h}.
    const raMin = 3.3, raMax = 5.75, decMin = 8, decMax = 30;
    const x = box.x + (1 - (ra - raMin) / (raMax - raMin)) * box.w;
    const y = box.y + (1 - (dec - decMin) / (decMax - decMin)) * box.h;
    return [x, y];
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 1337;
    const n = Math.round((W * H) / 2400);
    layers = [0.25, 0.5, 1].map((speed, li) =>
      Array.from({ length: Math.round(n / 3) }, () => ({ x: rand() * W, y: rand() * H, r: (rand() * 0.7 + 0.2) * (0.7 + li * 0.35), a: rand() * 0.6 + 0.25, speed })),
    );
    twinklers = Array.from({ length: Math.round(n / 25) }, () => ({ x: rand() * W, y: rand() * H, r: rand() * 0.8 + 0.9, p: rand() * 6.28, f: rand() * 1.5 + 0.6 }));
  }

  function taurusBox() {
    // Bottom right of the hero copy, clear of the headline: the space beside the lede and buttons.
    const w = Math.min(320, W * 0.21);
    return { x: W - w - Math.max(32, W * 0.03), y: H * 0.42, w, h: w * 0.7 };
  }


  // A mythical line-art bull on the left (violet lines and star nodes on black),
  // drawn with "screen" so its black disappears. It breathes faintly; hidden below 1100px wide.
  const bull = new Image();
  bull.decoding = "async";
  bull.src = "/brand/film/bull-line.webp";
  function drawBull(tt) {
    if (W < 1100 || !bull.complete || !bull.naturalWidth) return;
    const w = Math.min(330, W * 0.22), h = (w * bull.naturalHeight) / bull.naturalWidth;
    const ox = Math.max(28, W * 0.025), oy = Math.min(H, innerHeight) * 0.53;
    const fade = reduce ? 1 : Math.min(1, Math.max(0, (tt - 0.4) / 2));
    const breathe = reduce ? 1 : 0.8 + 0.2 * Math.sin(tt * 0.9);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.5 * fade * breathe;
    ctx.drawImage(bull, ox, oy, w, h);
    ctx.restore();
  }

  function drawTaurus(tt) {
    if (W < 1100) return; // phones and small tablets: the headline needs the whole width
    const box = taurusBox();
    const reveal = reduce ? 1 : Math.min(1, Math.max(0, (tt - 0.6) / 2.4));
    ctx.save();
    ctx.lineCap = "round";
    // Lines draw in one by one.
    LINES.forEach(([a, b], i) => {
      const k = Math.min(1, Math.max(0, reveal * LINES.length - i));
      if (k <= 0) return;
      const [x1, y1] = project(STARS[a][0], STARS[a][1], box);
      const [x2, y2] = project(STARS[b][0], STARS[b][1], box);
      ctx.strokeStyle = "rgba(178,102,255,.55)"; ctx.lineWidth = 1.1; ctx.shadowColor = "rgba(147,18,255,.9)"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k); ctx.stroke();
    });
    // Stars.
    for (const [key, [ra, dec, m]] of Object.entries(STARS)) {
      const [x, y] = project(ra, dec, box);
      const pulse = key === "ald" && !reduce ? 0.8 + 0.2 * Math.sin(tt * 1.8) : 1;
      const r = (key === "ald" ? 3.4 : 1.4 + m * 1.4) * pulse;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, key === "ald" ? "rgba(255,230,255,1)" : "rgba(240,225,255,.95)");
      g.addColorStop(0.25, `rgba(170,80,255,${0.55 * reveal + 0.2})`);
      g.addColorStop(1, "rgba(147,18,255,0)");
      ctx.globalAlpha = 0.35 + 0.65 * reveal;
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
    }
    // Pleiades cluster.
    for (const [ra, dec] of PLEIADES) {
      const [x, y] = project(ra, dec, box);
      ctx.globalAlpha = 0.4 + 0.6 * reveal;
      ctx.fillStyle = "rgba(225,205,255,.95)"; ctx.shadowColor = "rgba(147,18,255,1)"; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    // Label.
    ctx.globalAlpha = 0.55 * reveal; ctx.shadowBlur = 0;
    ctx.fillStyle = "#c9a4ff"; ctx.font = "500 11px 'Spline Sans Mono', monospace";
    const [lx, ly] = project(STARS.ald[0], STARS.ald[1], box);
    ctx.fillText("α TAU · ALDEBARAN", lx + 10, ly + 18);
    const [tx, ty] = project(5.75, 30, box);
    ctx.fillText("TAURUS", tx, ty - 4);
    ctx.restore();
  }

  function drawRim(tt) {
    const mobile = W < 760;
    const R = Math.max(W * (mobile ? 1.6 : 1.15), 900);
    const rimY = H * (mobile ? 0.11 : 0.24);
    const cx = W / 2, cy = rimY - R;
    const b = reduce ? 1 : 0.86 + 0.14 * Math.sin(tt * 0.77);
    let g = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.22);
    g.addColorStop(0, `rgba(170,50,255,${0.85 * b})`); g.addColorStop(0.18, `rgba(140,30,250,${0.45 * b})`); g.addColorStop(1, "rgba(60,10,120,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();
    g = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    g.addColorStop(0, "#000"); g.addColorStop(0.86, "#07020f"); g.addColorStop(0.95, `rgba(110,24,200,${0.9 * b})`); g.addColorStop(1, `rgba(214,150,255,${0.95 * b})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, "rgba(147,18,255,0)"); lg.addColorStop(0.3, "rgba(190,110,255,.8)"); lg.addColorStop(0.5, "rgba(255,240,255,1)"); lg.addColorStop(0.7, "rgba(190,110,255,.8)"); lg.addColorStop(1, "rgba(147,18,255,0)");
    ctx.strokeStyle = lg; ctx.lineWidth = 3.2; ctx.shadowColor = "rgba(190,90,255,1)"; ctx.shadowBlur = 42 * b; ctx.stroke(); ctx.lineWidth = 1.4; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }

  function paint(now) {
    const tt = (now - t0) / 1000;
    ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    // Drifting star layers: each flows slowly downward and outward, as if the planet were receding.
    const cx = W / 2;
    for (const layer of layers) {
      for (const s of layer) {
        const d = reduce ? 0 : tt * 6 * s.speed;
        const y = (s.y + d) % H;
        const x = s.x + (s.x - cx) * (d / H) * 0.15;
        ctx.globalAlpha = s.a; ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(((x % W) + W) % W, y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const s of twinklers) {
      ctx.globalAlpha = reduce ? 0.7 : 0.35 + 0.65 * Math.abs(Math.sin(tt * s.f + s.p));
      ctx.fillStyle = "#f3e9ff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!videoOn) drawRim(tt);
    drawBull(tt);
    drawTaurus(tt);
  }

  function loop(now) {
    if (visible && now - last > 33) { last = now; paint(now); }
    requestAnimationFrame(loop);
  }

  const video = document.querySelector("[data-sky-video]");
  if (video && !reduce && matchMedia("(min-width: 900px)").matches) {
    for (const [src, type] of [["/brand/film/planet-loop.webm", "video/webm"], ["/brand/film/planet-loop.mp4", "video/mp4"]]) {
      const el = document.createElement("source"); el.src = src; el.type = type; video.append(el);
    }
    const planet = document.querySelector("[data-planet]");
    // Fit the disc to the rim in the video: brightest pixel in three columns, circle through three points.
    const fitPlanet = () => {
      if (!planet || !video.videoWidth) return;
      const sw = 240, sh = Math.round((240 * video.videoHeight) / video.videoWidth);
      const c = document.createElement("canvas"); c.width = sw; c.height = sh;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(video, 0, 0, sw, sh);
      const peak = (col) => { let best = -1, by = 0; for (let y = 0; y < sh * 0.6; y++) { const d = x.getImageData(col, y, 1, 1).data; const v = d[0] + d[1] + d[2]; if (v > best) { best = v; by = y; } } return by; };
      const pts = [[sw * 0.12, peak(Math.round(sw * 0.12))], [sw * 0.5, peak(Math.round(sw * 0.5))], [sw * 0.88, peak(Math.round(sw * 0.88))]];
      const [[x1, y1], [x2, y2], [x3, y3]] = pts;
      const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
      if (!d) return;
      const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
      const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
      const r = Math.hypot(x1 - ux, y1 - uy);
      const vb = video.getBoundingClientRect(), hb = canvas.getBoundingClientRect();
      const k = vb.width / sw, rr = r * k - 3;
      Object.assign(planet.style, { left: `${vb.left - hb.left + ux * k - rr}px`, top: `${vb.top - hb.top + uy * k - rr}px`, width: `${rr * 2}px`, height: `${rr * 2}px` });
      planet.classList.add("on");
    };
    video.addEventListener("playing", () => { videoOn = true; video.classList.add("on"); setTimeout(fitPlanet, 300); }, { once: true });
    addEventListener("resize", () => setTimeout(fitPlanet, 100));
    video.load();
    video.play().catch(() => {});
  }

  size();
  paint(t0 + (reduce ? 10000 : 0));
  addEventListener("resize", () => { size(); paint(performance.now()); });
  if (!reduce) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    requestAnimationFrame(loop);
  }
}
