import { reportBottleSource, isBackendBottle } from './bottle-assets';

/** One URL, or several tried in order (the backend's glasses bottle, then the bundled photograph). */
export type BottleSource = string | readonly string[];
export const bottleSourceKey = (source: BottleSource) => typeof source === 'string' ? source : source.join(' ');
/** The first source that answers wins. A slow backend gets 6 s before the next source is tried. */
export async function fetchBottleBlob(source: BottleSource): Promise<Blob> {
  const list = typeof source === 'string' ? [source] : source;
  let failure: unknown = new Error('Bottle photograph unavailable');
  for (const [i, url] of list.entries()) {
    try {
      const response = await fetch(url, i < list.length - 1 && isBackendBottle(url) ? { signal: AbortSignal.timeout(6000) } : undefined);
      reportBottleSource(url, response.status);
      if (response.ok) { console.debug(`[wineLENS] bottle ← ${isBackendBottle(url) ? 'backend' : 'bundled'} ${url.split('?')[0].split('/').pop()}`); return await response.blob(); }
      failure = new Error(`Bottle photograph unavailable (${response.status})`);
    } catch (error) { reportBottleSource(url, null); failure = error; }
  }
  throw failure;
}

// Keep the subject large without stretching the bottle or punching holes in dark glass.
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left=width, top=height, right=-1, bottom=-1;
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if(data[(y*width+x)*4+3] > 8) { left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y); }
  }
  return right < left ? {x:0,y:0,width,height} : {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
// ═══ Detail: the bottle at display size, its label lifted ═══
// A 160-px-tall bottle on a 16-level panel loses its label lettering to the downscale.
// The bottle alone (never the backdrop) is drawn at its final size, then a 3×3 unsharp
// mask on luminance pushes each pixel away from its neighbourhood: edges and lettering
// come forward, flat glass stays flat. Done on premultiplied light so cut-out edges
// never grow a halo.
const DETAIL = 0.85;
export function detailedBottle(bitmap: ImageBitmap, b: { x: number; y: number; width: number; height: number }, w: number, h: number): HTMLCanvasElement {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, b.x, b.y, b.width, b.height, 0, 0, W, H);
  const image = ctx.getImageData(0, 0, W, H), d = image.data, n = W * H;
  const light = new Float32Array(n), row = new Float32Array(n), blur = new Float32Array(n);
  for (let i = 0; i < n; i++) { const o = i * 4; light[i] = (.299 * d[o] + .587 * d[o + 1] + .114 * d[o + 2]) / 255 * d[o + 3] / 255; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; row[i] = (light[x > 0 ? i - 1 : i] + 2 * light[i] + light[x < W - 1 ? i + 1 : i]) / 4; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; blur[i] = (row[y > 0 ? i - W : i] + 2 * row[i] + row[y < H - 1 ? i + W : i]) / 4; }
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = d[o + 3] / 255;
    if (a < 0.03) continue;
    const lifted = Math.min(1, Math.max(0, light[i] + DETAIL * (light[i] - blur[i])));
    d[o] = d[o + 1] = d[o + 2] = Math.round(Math.min(1, lifted / a) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
export async function loadBottle(source: BottleSource) {
  const bitmap = await createImageBitmap(await fetchBottleBlob(source));
  const probe = document.createElement('canvas'); probe.width = bitmap.width; probe.height = bitmap.height;
  const pctx = probe.getContext('2d')!; pctx.drawImage(bitmap, 0, 0);
  return { bitmap, bounds: alphaBounds(pctx.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height) };
}

export async function bottleCanvas(source: BottleSource, width: number, height: number): Promise<HTMLCanvasElement> {
  const { bitmap, bounds } = await loadBottle(source);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const out = canvas.getContext('2d')!; out.fillStyle = '#000'; out.fillRect(0, 0, width, height);
    const scale = Math.min((width - 8) / bounds.width, (height - 8) / bounds.height);
    const bottle = detailedBottle(bitmap, bounds, bounds.width * scale, bounds.height * scale);
    out.drawImage(bottle, Math.round((width - bottle.width) / 2), Math.round((height - bottle.height) / 2));
    return canvas;
  } finally { bitmap.close(); }
}

// ═══ Lit stage (depth on a flat green panel) ═══
// The bottle stands on a small "stage": a spotlight behind it, a pool of light on the floor
// and a short reflection below the base. The stage is drawn as an ordered-dither stipple
// (8×8 Bayer: more light, more dots, every dot the same dim level), the same texture as the
// maps, so it reads as atmosphere around the bottle, never as a competing shape.
const BAYER8 = (() => {
  const m = [0];
  for (let size = 1; size < 8; size *= 2) {
    const next = new Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = m[y * size + x] * 4, w = size * 2;
      next[y * w + x] = v; next[y * w + x + size] = v + 2; next[(y + size) * w + x] = v + 3; next[(y + size) * w + x + size] = v + 1;
    }
    m.splice(0, m.length, ...next);
  }
  return m;
})();
const STAGE_DOT = 104;   // one dot ≈ level 3–4 of 15 after tone mapping
const STAGE_GAIN = 1.7;  // light → dot density
function stipple(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height), d = image.data;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, light = (.299 * d[o] + .587 * d[o + 1] + .114 * d[o + 2]) / 255 * STAGE_GAIN;
    const on = light > (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
    d[o] = d[o + 1] = d[o + 2] = on ? STAGE_DOT : 0; d[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
export async function stageCanvas(source: BottleSource, width: number, height: number): Promise<HTMLCanvasElement> {
  const { bitmap, bounds: b } = await loadBottle(source);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    const base = Math.round(height * 0.87), cx = width / 2;
    const scale = Math.min((width - 12) / b.width, (base - 6) / b.height);
    const bottle = detailedBottle(bitmap, b, b.width * scale, b.height * scale);
    const w = bottle.width, h = bottle.height, x = Math.round(cx - w / 2), y = base - h;
    // spotlight behind the bottle's shoulders (fades to zero inside the image bounds)
    ctx.save(); ctx.translate(cx, y + h * 0.45); ctx.scale(1, 2.2);
    const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.46);
    spot.addColorStop(0, 'rgba(255,255,255,0.22)'); spot.addColorStop(0.5, 'rgba(255,255,255,0.08)'); spot.addColorStop(0.9, 'rgba(255,255,255,0)');
    ctx.fillStyle = spot; ctx.fillRect(-width, -height, width * 2, height * 2); ctx.restore();
    // pool of light on the floor
    ctx.save(); ctx.translate(cx, base); ctx.scale(1, 0.18);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.47);
    pool.addColorStop(0, 'rgba(255,255,255,0.34)'); pool.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = pool; ctx.fillRect(-width, -height, width * 2, height * 2); ctx.restore();
    // reflection: the base mirrored, fading out within ~12% of the height
    const reflection = document.createElement('canvas'); reflection.width = width; reflection.height = height;
    const rctx = reflection.getContext('2d')!;
    rctx.save(); rctx.translate(0, base * 2); rctx.scale(1, -1); rctx.drawImage(bottle, x, y); rctx.restore();
    rctx.globalCompositeOperation = 'destination-in';
    const fade = rctx.createLinearGradient(0, base, 0, base + height * 0.12);
    fade.addColorStop(0, 'rgba(0,0,0,0.4)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = fade; rctx.fillRect(0, 0, width, height);
    ctx.drawImage(reflection, 0, 0);
    stipple(ctx, width, height);
    // the bottle itself, solid on top of the stipple
    ctx.drawImage(bottle, x, y);
    return canvas;
  } finally { bitmap.close(); }
}

/** A hairline rule that fades out to the right (drawn as an image; text can't draw lines). */
export function ruleCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d')!; ctx.fillStyle='#000'; ctx.fillRect(0,0,width,height);
  const g=ctx.createLinearGradient(0,0,width,0);
  g.addColorStop(0,'rgba(255,255,255,0.95)'); g.addColorStop(0.35,'rgba(255,255,255,0.45)'); g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,Math.floor(height/2),width,1);
  return canvas;
}

// ═══ G2 tone mapping ═══
// The G2 panel is emissive green with 16 levels. Mapping photo luminance straight to
// levels 0–15 makes labels and glass reflections blaze at full brightness and bands
// the smooth glass into hard steps. Instead:
//   · highlights roll off above a knee (white labels land near level 10, never above 12),
//     so labels stay legible without glaring;
//   · a gentle gamma keeps dark glass dark while preserving shoulder/neck detail;
//   · a light 4×4 ordered (Bayer) dither spreads the in-between tones, so gradients look
//     like fine grain rather than stripes. Amplitude is half a level: subtle, stable across frames.
//   · transparent background stays exactly 0 (no dither noise around the bottle).
const SCALE = 11.5;    // tone 1.0 before roll-off → level 11.5
const PEAK = 10;       // hard cap (of 15): text (15) always outshines the bottle; white labels land near 8
const GAMMA = 1.22;    // >1 darkens mid-tones: glass stays glass, the label separates from it
const KNEE = 0.5;      // above this, highlights roll off softly instead of clipping
const ROLLOFF = 0.34;  // slope above the knee: label whites keep their lettering
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** RGBA pixels → 16-level grayscale (multiples of 17) for the G2 PNG encoder. */
export function toGreenLevels(pixels: Uint8ClampedArray, width = 0): Uint8Array {
  const gray=new Uint8Array(pixels.length/4);
  for(let i=0;i<gray.length;i++) {
    const o=i*4, alpha=pixels[o+3]/255;
    if(alpha < 0.03) { gray[i]=0; continue; }
    const light=(.299*pixels[o]+.587*pixels[o+1]+.114*pixels[o+2])/255*alpha;
    if(light <= 0) { gray[i]=0; continue; }
    const curved=Math.pow(light,GAMMA);
    const knee=curved > KNEE ? KNEE+(curved-KNEE)*ROLLOFF : curved;
    const tone=knee*SCALE;
    const x=width ? i%width : i, y=width ? Math.floor(i/width) : 0;
    const threshold=(BAYER4[(y&3)*4+(x&3)]+0.5)/16-0.5;       // −0.47…+0.47 of a level
    const level=Math.max(0,Math.min(PEAK,Math.round(tone+threshold)));
    gray[i]=level*17;
  }
  return gray;
}
