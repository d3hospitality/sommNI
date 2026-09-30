// ═══════════════════════════════════════════════════════════════════
// Wine map panel for G2 (right half of the screen), seen through a rounded lens mask:
//   • the country and its neighbours, dithered, as the backdrop (dim: bottle + text stay brightest)
//   • the country semi-highlighted (textured fill + bright border)
//   • the region super-highlighted: a glow over its mapped winery locations + the dots
//   • the bottle photograph over the map's left edge (wine page only)
//   • a caption strip above the map: a text container that MOVES to sit over the region,
//     joined to the glow by a dotted leader line drawn into the map
// G2 draws images above text, so the caption lives in a strip the map doesn't cover.
// The camera frames country + region together, so where the region sits (and therefore where
// the caption goes) follows real geography: Champagne lands up and right in France, Mendoza
// against the Andes in Argentina.
// Regions are winerymap winery clusters, not appellation boundaries: no region border is drawn.
// ═══════════════════════════════════════════════════════════════════

import { type Country, type GlobeRenderer, type Region } from './atlas/renderer';
import { alphaBounds, toGreenLevels } from './bottle-raster';

/** Map panel on screen: x ≥ SCENE_X; the caption strip is y < MAP_Y; the map is below it. */
export const SCENE_X = 288, MAP_Y = 36, MAP_W = 288, MAP_H = 288 - MAP_Y;
/** Two image tiles stack to fill the map (SDK image height limit is 144). */
export const TILE_W = MAP_W, TILE_H = MAP_H / 2;
const DEG = Math.PI / 180;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BOTTLE = { x: 6, y: 4, w: 96, h: MAP_H - 8 };
// Levels (0–255 before quantising to multiples of 17). The map is a backdrop: every level sits
// well below the bottle and the text (which reach full brightness); the region is still the
// brightest thing on the map, the country next, neighbours faintest.
const LAND = 6, NEIGHBOUR_BORDER = 24, COUNTRY_FILL = 16, COUNTRY_BORDER = 64, GLOW_MIN = 28, GLOW_MAX = 105, DOT = 136, LEADER = 85;
/** Lens mask: a rounded window (superellipse) dissolving the map to black toward the edges. */
const MASK = { power: 3.2, inner: 0.62, outer: 1.0 };
function lensMask(x: number, y: number): number {
  const u = Math.abs((x + 0.5) / (MAP_W / 2) - 1), v = Math.abs((y + 0.5) / (MAP_H / 2) - 1);
  const r = Math.pow(Math.pow(u, MASK.power) + Math.pow(v, MASK.power), 1 / MASK.power);
  const t = Math.min(1, Math.max(0, (r - MASK.inner) / (MASK.outer - MASK.inner)));
  return 1 - t * t * (3 - 2 * t);
}

export interface SceneInput { country: Country; region: Region | null; imageUrl: string | null }
/** Where the highlight landed (panel coordinates) and how to draw the tiles. */
export interface ScenePlan { anchorX: number; anchorY: number; render(): Promise<Uint8Array[]> }

/** Orthographic projection into the map rectangle (same maths as the Atlas renderer). */
function projector(center: [number, number], scale: number) {
  const c = center[1] * DEG, sinC = Math.sin(c), cosC = Math.cos(c);
  return (lon: number, lat: number) => {
    const d = (lon - center[0]) * DEG, p = lat * DEG;
    const z = sinC * Math.sin(p) + cosC * Math.cos(p) * Math.cos(d);
    return { x: MAP_W / 2 + scale * Math.cos(p) * Math.sin(d), y: MAP_H / 2 - scale * (cosC * Math.sin(p) - sinC * Math.cos(p) * Math.cos(d)), visible: z > 0 };
  };
}
const arcDeg = (a: [number, number], b: [number, number]) => {
  const [l1, p1, l2, p2] = [a[0] * DEG, a[1] * DEG, b[0] * DEG, b[1] * DEG];
  return Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l2 - l1))) / DEG;
};

/** Frame the country with the region in view, then nudge so the region sits in the free area. */
function camera(country: Country, region: Region | null, withBottle: boolean) {
  const target = region?.center ?? country.center;
  const sep = region ? arcDeg(country.center, region.center) : 0;
  const angular = Math.min(18, Math.max(5, region ? Math.max(sep * 1.5, region.radius * 4) : 9));
  const scale = (Math.min(MAP_W, MAP_H) / 2 - 10) / Math.sin(angular * DEG);
  let center: [number, number] = region ? [(country.center[0] + target[0]) / 2, (country.center[1] + target[1]) / 2] : [...target];
  const box = { x0: withBottle ? 150 : 50, x1: MAP_W - 40, y0: 44, y1: MAP_H - 44 };
  for (let i = 0; i < 3; i++) {
    const p = projector(center, scale)(target[0], target[1]);
    const want = { x: Math.min(box.x1, Math.max(box.x0, p.x)), y: Math.min(box.y1, Math.max(box.y0, p.y)) };
    if (!p.visible) { center = [target[0], target[1]]; continue; }
    const dx = p.x - want.x, dy = p.y - want.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
    center = [center[0] + dx / (scale * DEG) / Math.max(0.3, Math.cos(center[1] * DEG)), Math.max(-80, Math.min(80, center[1] - dy / (scale * DEG)))];
  }
  const anchor = projector(center, scale)(target[0], target[1]);
  return { center, scale, anchorX: Math.round(anchor.x), anchorY: Math.round(anchor.y) };
}

/** Country id per pixel (-1 = space). */
function countryIds(renderer: GlobeRenderer, center: [number, number], scale: number): Int16Array {
  const ids = new Int16Array(MAP_W * MAP_H).fill(-1);
  const sinP = Math.sin(center[1] * DEG), cosP = Math.cos(center[1] * DEG);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const dx = (x + 0.5 - MAP_W / 2) / scale, dy = -(y + 0.5 - MAP_H / 2) / scale, r2 = dx * dx + dy * dy;
    if (r2 >= 1) continue;
    const z = Math.sqrt(1 - r2), lat = Math.asin(dy * cosP + z * sinP) / DEG;
    let lon = center[0] + Math.atan2(dx, z * cosP - dy * sinP) / DEG; lon = ((lon + 540) % 360) - 180;
    ids[y * MAP_W + x] = renderer.countryAt(lon, lat);
  }
  return ids;
}

async function bottleLayer(url: string): Promise<{ gray: Uint8Array; alpha: Uint8Array } | null> {
  const { w: width, h: height } = BOTTLE;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const probe = document.createElement('canvas'); probe.width = bitmap.width; probe.height = bitmap.height;
      const pctx = probe.getContext('2d')!; pctx.drawImage(bitmap, 0, 0);
      const b = alphaBounds(pctx.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      const s = Math.min(width / b.width, height / b.height);
      const w = b.width * s, h = b.height * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, b.x, b.y, b.width, b.height, (width - w) / 2, height - h, w, h);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      const onBlack = new Uint8ClampedArray(rgba.length);
      for (let i = 0; i < alpha.length; i++) {
        const a = rgba[i * 4 + 3]; alpha[i] = a;
        onBlack[i * 4] = rgba[i * 4] * a / 255; onBlack[i * 4 + 1] = rgba[i * 4 + 1] * a / 255; onBlack[i * 4 + 2] = rgba[i * 4 + 2] * a / 255; onBlack[i * 4 + 3] = 255;
      }
      return { gray: toGreenLevels(onBlack, width), alpha };
    } finally { bitmap.close(); }
  } catch { return null; }
}

/** Plan first (cheap: camera + anchor, so the caption can be placed with the text), render later. */
export function planWineScene(renderer: GlobeRenderer, input: SceneInput): ScenePlan {
  const { country, region, imageUrl } = input;
  const cam = camera(country, region, !!imageUrl);
  const render = async (): Promise<Uint8Array[]> => {
    const ids = countryIds(renderer, cam.center, cam.scale);
    const project = projector(cam.center, cam.scale);
    const value = new Float32Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x, id = ids[i];
      if (id <= 0) continue;                                 // sea / space stay black
      const own = id === country.id;
      let border = false, ownBorder = false;
      const near = [x > 0 ? i - 1 : -1, x < MAP_W - 1 ? i + 1 : -1, y > 0 ? i - MAP_W : -1, y < MAP_H - 1 ? i + MAP_W : -1];
      for (const j of near) {
        if (j < 0 || ids[j] === id) continue;
        border = true;
        if (own || ids[j] === country.id) ownBorder = true;
      }
      value[i] = ownBorder ? COUNTRY_BORDER : border ? NEIGHBOUR_BORDER : own ? COUNTRY_FILL : LAND;
    }
    const glow = new Float32Array(MAP_W * MAP_H);
    const add = (cx: number, cy: number, R: number, weight: number, power: number) => {
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy); if (d > R) continue;
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        glow[y * MAP_W + x] += weight * (1 - d / R) ** power;
      }
    };
    const dots: [number, number][] = [];
    if (region) {
      for (const [lon, lat] of region.points) {
        const p = project(lon, lat);
        if (!p.visible) continue;
        const sx = Math.round(p.x), sy = Math.round(p.y);
        if (sx < -12 || sx >= MAP_W + 12 || sy < -12 || sy >= MAP_H + 12) continue;
        dots.push([sx, sy]); add(sx, sy, 12, 1, 2);
      }
      add(cam.anchorX, cam.anchorY, 30, 1.6, 1.5);          // halo: a tight cluster still reads as a place
    }
    for (let i = 0; i < glow.length; i++) if (glow[i] > 0.02) value[i] = Math.max(value[i], GLOW_MIN + (GLOW_MAX - GLOW_MIN) * Math.min(1, glow[i] / 4));
    for (const [x, y] of dots) if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) value[y * MAP_W + x] = DOT;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) value[y * MAP_W + x] *= lensMask(x, y);
    // Leader: a dotted line from the caption strip down to the top of the highlight.
    const top = cam.anchorY - (region ? 32 : 10);
    for (let y = 0; y < top; y += 2) if (cam.anchorX >= 0 && cam.anchorX < MAP_W) value[y * MAP_W + cam.anchorX] = LEADER;
    // Behind the bottle the map fades, so the glass reads cleanly.
    if (imageUrl) {
      const fadeEnd = BOTTLE.x + BOTTLE.w + 14;
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < fadeEnd; x++) value[y * MAP_W + x] *= x < BOTTLE.x + BOTTLE.w ? 0.5 : 0.5 + 0.5 * (x - BOTTLE.x - BOTTLE.w) / 14;
    }
    const out = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x, d = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      out[i] = Math.min(238, Math.max(0, Math.floor(value[i] / 17 + d) * 17));
    }
    if (imageUrl) {
      const bottle = await bottleLayer(imageUrl);
      if (bottle) for (let y = 0; y < BOTTLE.h; y++) for (let x = 0; x < BOTTLE.w; x++) {
        const k = y * BOTTLE.w + x;
        if (bottle.alpha[k] < 40) continue;
        out[(BOTTLE.y + y) * MAP_W + BOTTLE.x + x] = bottle.gray[k];
      }
    }
    return [out.slice(0, TILE_W * TILE_H), out.slice(TILE_W * TILE_H)];
  };
  return { anchorX: cam.anchorX, anchorY: cam.anchorY, render };
}

/**
 * Caption geometry: centred over the highlight, kept inside the panel. Text is ~9.5 px per
 * character on G2; the box is sized to the words so it can travel with the region.
 */
export function captionBox(anchorX: number, text: string): { x: number; width: number } {
  const width = Math.min(MAP_W - 8, Math.ceil([...text].length * 9.5) + 16);
  const x = Math.round(SCENE_X + Math.min(MAP_W - width - 2, Math.max(4, anchorX - width / 2)));
  return { x, width };
}
