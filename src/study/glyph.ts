// ═══════════════════════════════════════════════════════════════════
// wineLENS Study — centred glyphs for flash cards (PolyGot model)
//
// One picture per card side: a pictogram (grape, glass, globe, pin, nose,
// eye, book or the real bottle) with one big word under it. Rendered once as
// 16-level grayscale: pushed as is to the G2 (288×128 at the lens centre) and
// tinted for the phone, so both show the same card.
// ═══════════════════════════════════════════════════════════════════
import type { Glyph } from './seasons';
import { catalogBottleSources } from '../bottle-assets';
import { bottleCanvas, toGreenLevels } from '../bottle-raster';
import { loadAtlasRenderer, atlasCountryFor } from '../atlas-app';

export const GLYPH = { w: 288, h: 128 } as const;
const INK = 204;      // brightest stroke: level 12 of 15, calmer than full white on the lens
const GRAPE_SPRITES = new Set(['cabernet-sauvignon', 'merlot', 'nebbiolo', 'pinot-noir', 'sangiovese']);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let font: Promise<string> | null = null;
function glyphFont(baseUrl: string): Promise<string> {
  font ??= (async () => {
    try {
      const face = new FontFace('wlGlyph', `url(${new URL('fonts/space-grotesk-700.ttf', baseUrl).href})`, { weight: '700' });
      document.fonts.add(await face.load());
      return 'wlGlyph';
    } catch { return 'sans-serif'; }
  })();
  return font;
}
const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(url: string): Promise<HTMLImageElement | null> {
  if (!images.has(url)) images.set(url, new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; }));
  return images.get(url)!;
}

// ── pictograms (white on black, drawn into a square box) ──
type Box = { x: number; y: number; s: number };
function strokeStyle(ctx: CanvasRenderingContext2D, s: number) { ctx.strokeStyle = `rgb(${INK},${INK},${INK})`; ctx.fillStyle = `rgb(${INK},${INK},${INK})`; ctx.lineWidth = Math.max(2, s / 34); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
const FILL: Record<string, number> = { Red: 150, Dessert: 120, Rose: 95, Orange: 85, White: 55, Sparkling: 55 };
function glass(ctx: CanvasRenderingContext2D, b: Box, style: string | null | undefined) {
  strokeStyle(ctx, b.s);
  const cx = b.x + b.s / 2, top = b.y + b.s * 0.12, flute = style === 'Sparkling';
  const bw = b.s * (flute ? 0.15 : 0.25), bh = b.s * (flute ? 0.46 : 0.38), foot = b.y + b.s * 0.94;
  const bowl = () => { ctx.beginPath(); ctx.moveTo(cx - bw, top); ctx.bezierCurveTo(cx - bw, top + bh * 0.85, cx - bw * 0.55, top + bh, cx, top + bh); ctx.bezierCurveTo(cx + bw * 0.55, top + bh, cx + bw, top + bh * 0.85, cx + bw, top); };
  if (style && FILL[style]) {
    // Liquid: an ordered-dither fill whose density tells the style apart.
    ctx.save(); bowl(); ctx.closePath(); ctx.clip();
    const level = top + bh * (flute ? 0.18 : 0.42), v = FILL[style];
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(cx - bw, level, bw * 2, bh);
    if (flute) { ctx.fillStyle = `rgb(${INK},${INK},${INK})`; for (let i = 0; i < 9; i++) { const y = level + ((i * 37) % 100) / 100 * bh * 0.75, x = cx + (((i * 53) % 100) / 100 - 0.5) * bw * 1.2; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, b.s / 70), 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore(); strokeStyle(ctx, b.s);
  }
  bowl(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, top + bh); ctx.lineTo(cx, foot); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, foot, b.s * 0.17, b.s * 0.035, 0, 0, Math.PI * 2); ctx.stroke();
  if (style === null) { ctx.font = `700 ${Math.round(bh * 0.6)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', cx, top + bh * 0.5); }
}
function pin(ctx: CanvasRenderingContext2D, b: Box) {
  strokeStyle(ctx, b.s);
  const cx = b.x + b.s / 2, r = b.s * 0.24, cy = b.y + b.s * 0.32, tip = b.y + b.s * 0.82;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 2.18); ctx.lineTo(cx, tip); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2); ctx.fill();
  ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.ellipse(cx, tip + b.s * 0.04, b.s * 0.3, b.s * 0.06, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
}
function nose(ctx: CanvasRenderingContext2D, b: Box) {
  // A glass with aromas rising from the bowl: "smell this".
  glass(ctx, { x: b.x + b.s * 0.2, y: b.y + b.s * 0.38, s: b.s * 0.6 }, 'White');
  strokeStyle(ctx, b.s);
  for (let i = -1; i <= 1; i++) {
    const x = b.x + b.s * (0.5 + i * 0.1), y0 = b.y + b.s * 0.42;
    ctx.beginPath(); ctx.moveTo(x, y0);
    for (let k = 1; k <= 4; k++) ctx.quadraticCurveTo(x + (k % 2 ? 1 : -1) * b.s * 0.045, y0 - b.s * 0.095 * (k - 0.5), x, y0 - b.s * 0.095 * k);
    ctx.stroke();
  }
}
function eye(ctx: CanvasRenderingContext2D, b: Box) {
  strokeStyle(ctx, b.s);
  const cx = b.x + b.s / 2, cy = b.y + b.s / 2, w = b.s * 0.44, h = b.s * 0.24;
  ctx.beginPath(); ctx.moveTo(cx - w, cy); ctx.quadraticCurveTo(cx, cy - h * 2, cx + w, cy); ctx.quadraticCurveTo(cx, cy + h * 2, cx - w, cy); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, h * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, h * 0.34, 0, Math.PI * 2); ctx.fill();
}
function book(ctx: CanvasRenderingContext2D, b: Box) {
  strokeStyle(ctx, b.s);
  const cx = b.x + b.s / 2, top = b.y + b.s * 0.22, bottom = b.y + b.s * 0.78, w = b.s * 0.42;
  for (const dir of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(cx, top + b.s * 0.04); ctx.quadraticCurveTo(cx + dir * w * 0.5, top - b.s * 0.04, cx + dir * w, top); ctx.lineTo(cx + dir * w, bottom); ctx.quadraticCurveTo(cx + dir * w * 0.5, bottom - b.s * 0.08, cx, bottom); ctx.closePath(); ctx.stroke();
    for (let l = 1; l <= 4; l++) { const y = top + (bottom - top) * l / 5.2; ctx.beginPath(); ctx.moveTo(cx + dir * w * 0.18, y + b.s * 0.01); ctx.lineTo(cx + dir * w * 0.82, y - b.s * 0.01); ctx.lineWidth = Math.max(1, b.s / 60); ctx.stroke(); ctx.lineWidth = Math.max(2, b.s / 34); }
  }
  ctx.beginPath(); ctx.moveTo(cx, top + b.s * 0.04); ctx.lineTo(cx, bottom); ctx.stroke();
}
async function grape(ctx: CanvasRenderingContext2D, b: Box, name: string | undefined, baseUrl: string) {
  const key = name && GRAPE_SPRITES.has(slug(name)) ? slug(name) : 'pinot-noir';
  const img = await image(new URL(`grapes/${key}.png`, baseUrl).href);
  if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, b.x, b.y, b.s, b.s); return; }
  strokeStyle(ctx, b.s);
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-.5, 1], [.5, 1], [0, 2], [-1.5, 0], [1.5, 0]]) { ctx.beginPath(); ctx.arc(b.x + b.s / 2 + dx * b.s * 0.13, b.y + b.s * 0.3 + dy * b.s * 0.15, b.s * 0.08, 0, Math.PI * 2); ctx.stroke(); }
}
async function grayInto(target: Uint8Array, tw: number, gray: Uint8Array, w: number, h: number, x0: number, y0: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = x0 + x, ty = y0 + y; if (tx < 0 || ty < 0 || tx >= tw) continue;
    const i = ty * tw + tx; if (i >= target.length) continue;
    target[i] = Math.max(target[i], gray[y * w + x]);
  }
}

/** Render one glyph to 16-level grayscale, w×h (default 288×128). */
export async function renderGlyph(g: Glyph, baseUrl: string, w: number = GLYPH.w, h: number = GLYPH.h): Promise<Uint8Array> {
  const family = await glyphFont(baseUrl);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  // Word: as large as fits on one line (or two), centred under the pictogram.
  const word = g.word.trim();
  let size = Math.round(h * 0.23), lines = [word];
  const fits = (s: number, text: string) => { ctx.font = `700 ${s}px ${family}`; return ctx.measureText(text).width <= w - 16; };
  if (word) {
    while (size > 15 && !fits(size, word)) size--;
    if (!fits(size, word)) {
      const parts = word.split(' '); let best = [word];
      for (let i = 1; i < parts.length; i++) { const two = [parts.slice(0, i).join(' '), parts.slice(i).join(' ')]; if (Math.max(...two.map(t => t.length)) < Math.max(...best.map(t => t.length))) best = two; }
      lines = best; size = Math.round(h * 0.16);
      while (size > 13 && !lines.every(l => fits(size, l))) size--;
    }
  }
  const wordH = word ? Math.round(size * 1.12) * lines.length + 4 : 0;
  const s = Math.max(24, h - wordH - 6), box: Box = { x: Math.round((w - s) / 2), y: 2, s };
  const gray = new Uint8Array(w * h);
  if (g.icon === 'globe' && g.country) {
    try {
      const renderer = await loadAtlasRenderer(), country = atlasCountryFor(renderer, g.country);
      if (country) {
        // Zoom until the lit country reads at glyph size, then mask to a round lens and make the country pop.
        let frame = renderer.render({ country, radius: 34 }, s);
        for (const radius of [16, 8, 4]) { if (frame.selected.reduce((n, v) => n + v, 0) > s * s * 0.03) break; frame = renderer.render({ country, radius }, s); }
        const lit = new Uint8Array(s * s), r2 = (s / 2 - 1) ** 2;
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
          const i = y * s + x, dx = x + 0.5 - s / 2, dy = y + 0.5 - s / 2;
          if (dx * dx + dy * dy > r2) continue;
          const dither = ((x * 3 + y * 5) % 4) / 4;
          lit[i] = frame.selected[i] ? Math.min(INK, Math.max(frame.gray[i], Math.round((136 + dither * 34) / 17) * 17)) : Math.round(frame.gray[i] * 0.85 / 17) * 17;
        }
        // A thin rim so the lens reads as a globe.
        for (let a = 0; a < 720; a++) { const t = a / 720 * Math.PI * 2, x = Math.round(s / 2 + Math.cos(t) * (s / 2 - 1.5)), y = Math.round(s / 2 + Math.sin(t) * (s / 2 - 1.5)); if (x >= 0 && y >= 0 && x < s && y < s) lit[y * s + x] = Math.max(lit[y * s + x], 85); }
        await grayInto(gray, w, lit, s, s, box.x, box.y);
      }
    } catch { pin(ctx, box); }
  } else if (g.icon === 'bottle' && g.wineId) {
    const sources = catalogBottleSources(baseUrl, g.wineId);
    try {
      if (!sources.length) throw new Error('no photo');
      const bw = Math.round(s * 0.5), bc = await bottleCanvas(sources, bw, s);
      await grayInto(gray, w, toGreenLevels(bc.getContext('2d')!.getImageData(0, 0, bw, s).data, bw), bw, s, Math.round((w - bw) / 2), box.y);
    } catch { glass(ctx, box, null); }
  }
  else if (g.icon === 'grape') await grape(ctx, box, g.grape ?? g.word, baseUrl);
  else if (g.icon === 'glass') glass(ctx, box, g.style);
  else if (g.icon === 'pin') pin(ctx, box);
  else if (g.icon === 'nose') nose(ctx, box);
  else if (g.icon === 'look') eye(ctx, box);
  else if (g.icon === 'book') book(ctx, box);
  if (word) {
    ctx.fillStyle = `rgb(${INK},${INK},${INK})`; ctx.font = `700 ${size}px ${family}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => ctx.fillText(line, w / 2, h - 4 - (lines.length - 1 - i) * Math.round(size * 1.12) - Math.round(size * 0.12)));
  }
  // Vector strokes and text → 16 levels; the globe and bottle are already quantised.
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < gray.length; i++) {
    const v = Math.round((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 17) * 17;
    if (v > gray[i]) gray[i] = Math.min(INK, v);
  }
  return gray;
}

/** The same glyph for the phone: a dark "lens" card with the glyph in warm ivory, pixel-crisp. */
export async function glyphCanvas(g: Glyph, baseUrl: string, w: number = GLYPH.w, h: number = GLYPH.h): Promise<HTMLCanvasElement> {
  const gray = await renderGlyph(g, baseUrl, w, h);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!, data = ctx.createImageData(w, h);
  const bg = [35, 28, 24], fg = [246, 232, 214];
  for (let i = 0; i < gray.length; i++) {
    const t = Math.min(1, gray[i] / INK);
    data.data[i * 4] = bg[0] + (fg[0] - bg[0]) * t; data.data[i * 4 + 1] = bg[1] + (fg[1] - bg[1]) * t; data.data[i * 4 + 2] = bg[2] + (fg[2] - bg[2]) * t; data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}
