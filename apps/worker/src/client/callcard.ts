// Share cards for a sealed call or a caller record, drawn on a canvas from the page's data attributes.
const W = 1200, H = 675, SF = 'system-ui, -apple-system, "Segoe UI", sans-serif', MONO = '"SF Mono", ui-monospace, Menlo, monospace';
const TONE: Record<string, string> = { up: "#45d27a", down: "#ff8a7a", "": "#f7f7f8" };

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight: number): number {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${SF}`; s -= 2; } while (ctx.measureText(text).width > max && s > 20);
  return s + 2;
}

function rows(ctx: CanvasRenderingContext2D, items: [string, string, string?][], x: number, y: number) {
  items.forEach(([k, v, tone], i) => {
    ctx.font = `500 26px ${SF}`; ctx.fillStyle = "#a39cb5"; ctx.fillText(k, x, y + i * 46);
    ctx.font = `600 26px ${k === "Seal tx" || k === "Caller" ? MONO : SF}`; ctx.fillStyle = TONE[tone ?? ""] ?? "#f7f7f8"; ctx.fillText(v, x + 220, y + i * 46);
  });
}

async function draw(el: HTMLElement, cv: HTMLCanvasElement) {
  const d = el.dataset, ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(W * 0.75, 0, 40, W * 0.75, 0, W);
  g.addColorStop(0, "#2a1248"); g.addColorStop(0.6, "#07040d"); g.addColorStop(1, "#05030a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 26px ${SF}`; ctx.fillStyle = "#b98cff";
  ctx.fillText(d.kind === "call" ? "Sealed call · Robinhood Chain" : "Sealed call record · Robinhood Chain", 70, 92);
  if (d.kind === "call") {
    const line = d.line ?? "";
    ctx.font = `700 ${fit(ctx, line, W - 140, 76, 700)}px ${SF}`; ctx.fillStyle = "#f7f7f8"; ctx.fillText(line, 70, 182);
    if (d.note) { ctx.font = `400 28px ${SF}`; ctx.fillStyle = "#c9b8ea"; ctx.fillText(`“${d.note.slice(0, 70)}”`, 70, 236); }
    const res = d.result ?? "";
    ctx.font = `700 ${fit(ctx, res, 520, 54, 700)}px ${SF}`; ctx.fillStyle = TONE[d.tone ?? ""] ?? "#f7f7f8"; ctx.fillText(res, 70, 330);
    rows(ctx, [["Caller", d.caller ?? ""], ["Sealed in", d.hour ?? ""], ["Entry close", d.entry ?? ""], ...(d.exit ? [["Close at end", d.exit] as [string, string]] : []), ["Seal tx", d.tx ?? ""]], 70, 410);
  } else {
    ctx.font = `700 120px ${SF}`; ctx.fillStyle = "#f7f7f8"; ctx.fillText(d.hit ?? "", 70, 250);
    ctx.font = `600 34px ${SF}`; ctx.fillStyle = "#c9b8ea"; ctx.fillText(`right, ${d.right} of ${d.resolved} resolved calls`, 70, 306);
    rows(ctx, [["Caller", d.caller ?? ""], ["Avg move", d.edge ?? "", d.tone], ["Open calls", d.open ?? "0"], ["Rank", d.rank ?? ""]], 70, 410);
  }
  ctx.font = `500 22px ${SF}`; ctx.fillStyle = "#8b8988";
  ctx.fillText("Signed before the move. Sealed, no edits. Paper only, not investment advice.", 70, H - 50);
  ctx.font = `500 22px ${MONO}`; ctx.textAlign = "right"; ctx.fillText(d.path ?? "", W - 70, 92); ctx.textAlign = "left";
  const img = new Image(); img.src = "/brand/mark-violet.svg";
  await img.decode().catch(() => undefined);
  if (img.complete && img.naturalWidth) ctx.drawImage(img, W - 220, H - 96, 46, 46);
  ctx.font = `700 34px ${SF}`; ctx.fillStyle = "#f7f7f8"; ctx.fillText("Tauro", W - 162, H - 60);
}

document.querySelectorAll<HTMLElement>("[data-card]").forEach(async (el) => {
  const cv = el.querySelector<HTMLCanvasElement>("[data-canvas]")!;
  await document.fonts?.ready;
  await draw(el, cv);
  el.querySelector<HTMLButtonElement>("[data-download]")?.addEventListener("click", () => {
    cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${el.dataset.file ?? "tauro-call"}.png`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  });
});
