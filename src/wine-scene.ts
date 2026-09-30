// ═══════════════════════════════════════════════════════════════════
// Wine detail scene for G2 — a 288×288 map panel on the right half of the screen, seen through
// a rounded lens mask that dithers out to black at the edges:
//   • the wine's country and its neighbours, dithered, as the backdrop
//   • the country semi-highlighted (a textured mid-level fill + bright border)
//   • the region super-highlighted: a glow over its mapped winery locations + the dots
//   • the bottle photograph standing over the left edge of the map
// Text cannot sit over images on G2 (images draw on top), so the text column keeps the left half.
// Sent as two 288×144 tiles, 16 levels (multiples of 17).
// Regions are winerymap winery clusters, not appellation boundaries: the glow follows
// where wineries are; no border is drawn for a region.
// ═══════════════════════════════════════════════════════════════════

import { project, type Country, type GlobeRenderer, type Region } from './atlas/renderer';
import { alphaBounds, toGreenLevels } from './bottle-raster';

export const SCENE = 288, TILE_W = 288, TILE_H = 144;
/** Screen position of the map panel; the text column uses x < SCENE_X. */
export const SCENE_X = 288;
const DEG = Math.PI / 180;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Where the region sits inside the panel (right of the bottle). */
const FOCUS_X_BOTTLE = 190, FOCUS_Y = 140;
const BOTTLE = { x: 6, y: 10, w: 96, h: 270 };
// Levels (0–255 before quantising to multiples of 17). The map is a backdrop: every level sits
// well below the bottle and the text (which reach full brightness); the region is still the
// brightest thing on the map, the country next, neighbours faintest.
const LAND = 6, NEIGHBOUR_BORDER = 24, COUNTRY_FILL = 16, COUNTRY_BORDER = 64, GLOW_MIN = 28, GLOW_MAX = 105, DOT = 136;
/**
 * Lens mask: a rounded window (superellipse) that dissolves the map to black toward the panel
 * edges, so the backdrop reads as a soft view rather than a hard square on the display.
 * 1 inside `inner`, 0 at `outer`, smooth in between; the ordered dither turns the falloff into grain.
 */
const MASK = { power: 3.2, inner: 0.62, outer: 1.0 };
function lensMask(x: number, y: number): number {
  const u = Math.abs((x + 0.5) / (SCENE / 2) - 1), v = Math.abs((y + 0.5) / (SCENE / 2) - 1);
  const r = Math.pow(Math.pow(u, MASK.power) + Math.pow(v, MASK.power), 1 / MASK.power);
  const t = Math.min(1, Math.max(0, (r - MASK.inner) / (MASK.outer - MASK.inner)));
  return 1 - t * t * (3 - 2 * t);
}

export interface SceneInput { country: Country; region: Region | null; imageUrl: string | null }

function camera(country: Country, region: Region | null, withBottle: boolean) {
  const focus = region?.center ?? country.center;
  const FOCUS_X = withBottle ? FOCUS_X_BOTTLE : SCENE / 2;
  const angular = region ? Math.min(16, Math.max(5, region.radius * 4)) : 9;
  const scale = (SCENE / 2 - 10) / Math.sin(angular * DEG);   // px per radian
  const dx = FOCUS_X - SCENE / 2, dy = FOCUS_Y - SCENE / 2;
  const lat = focus[1];
  const center: [number, number] = [
    focus[0] - dx / (scale * DEG) / Math.max(0.3, Math.cos(lat * DEG)),
    Math.max(-80, Math.min(80, lat + dy / (scale * DEG))),
  ];
  return { center, scale };
}

/** Country id per pixel (orthographic, same projection as the Atlas renderer); -1 = space. */
function countryIds(renderer: GlobeRenderer, center: [number, number], scale: number): Int16Array {
  const ids = new Int16Array(SCENE * SCENE).fill(-1);
  const sinP = Math.sin(center[1] * DEG), cosP = Math.cos(center[1] * DEG);
  for (let y = 0; y < SCENE; y++) for (let x = 0; x < SCENE; x++) {
    const dx = (x + 0.5 - SCENE / 2) / scale, dy = -(y + 0.5 - SCENE / 2) / scale, r2 = dx * dx + dy * dy;
    if (r2 >= 1) continue;
    const z = Math.sqrt(1 - r2), lat = Math.asin(dy * cosP + z * sinP) / DEG;
    let lon = center[0] + Math.atan2(dx, z * cosP - dy * sinP) / DEG; lon = ((lon + 540) % 360) - 180;
    ids[y * SCENE + x] = renderer.countryAt(lon, lat);
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

/** The 288×288 panel (values are multiples of 17, max 238). */
export async function renderWineScene(renderer: GlobeRenderer, input: SceneInput): Promise<Uint8Array> {
  const { country, region, imageUrl } = input;
  const cam = camera(country, region, !!imageUrl);
  const ids = countryIds(renderer, cam.center, cam.scale);
  const value = new Float32Array(SCENE * SCENE);
  for (let y = 0; y < SCENE; y++) for (let x = 0; x < SCENE; x++) {
    const i = y * SCENE + x, id = ids[i];
    if (id <= 0) continue;                                 // sea / space stay black
    const own = id === country.id;
    let border = false, ownBorder = false;
    const near = [x > 0 ? i - 1 : -1, x < SCENE - 1 ? i + 1 : -1, y > 0 ? i - SCENE : -1, y < SCENE - 1 ? i + SCENE : -1];
    for (const j of near) {
      if (j < 0 || ids[j] === id) continue;
      border = true;
      if (own || ids[j] === country.id) ownBorder = true;
    }
    value[i] = ownBorder ? COUNTRY_BORDER : border ? NEIGHBOUR_BORDER : own ? COUNTRY_FILL : LAND;
  }
  // Region glow: density of winery points with a soft falloff.
  const dots: [number, number][] = [];
  if (region) {
    const glow = new Float32Array(SCENE * SCENE);
    const R = 12, R2 = R * R;
    for (const [lon, lat] of region.points) {
      const p = project(lon, lat, cam.center, cam.scale, SCENE);
      if (!p.visible) continue;
      const sx = Math.round(p.x), sy = Math.round(p.y);
      if (sx < -R || sx >= SCENE + R || sy < -R || sy >= SCENE + R) continue;
      dots.push([sx, sy]);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy; if (d2 > R2) continue;
        const x = sx + dx, y = sy + dy; if (x < 0 || y < 0 || x >= SCENE || y >= SCENE) continue;
        glow[y * SCENE + x] += (1 - d2 / R2) ** 2;
      }
    }
    // A soft halo around the cluster's centre so even a tight cluster reads as a place.
    const c = project(region.center[0], region.center[1], cam.center, cam.scale, SCENE);
    if (c.visible) {
      const H = 30;
      for (let dy = -H; dy <= H; dy++) for (let dx = -H; dx <= H; dx++) {
        const d = Math.hypot(dx, dy); if (d > H) continue;
        const x = Math.round(c.x) + dx, y = Math.round(c.y) + dy; if (x < 0 || y < 0 || x >= SCENE || y >= SCENE) continue;
        glow[y * SCENE + x] += 1.6 * (1 - d / H) ** 1.5;
      }
    }
    for (let i = 0; i < glow.length; i++) if (glow[i] > 0.02) {
      const t = Math.min(1, glow[i] / 4);                  // ~4 overlapping wineries = full glow
      value[i] = Math.max(value[i], GLOW_MIN + (GLOW_MAX - GLOW_MIN) * t);
    }
  }
  for (const [x, y] of dots) if (x >= 0 && y >= 0 && x < SCENE && y < SCENE) value[y * SCENE + x] = DOT;
  for (let y = 0; y < SCENE; y++) for (let x = 0; x < SCENE; x++) value[y * SCENE + x] *= lensMask(x, y);
  // Behind the bottle the map fades, so the glass reads cleanly.
  const fadeEnd = imageUrl ? BOTTLE.x + BOTTLE.w + 14 : 0;
  for (let y = 0; y < SCENE; y++) for (let x = 0; x < fadeEnd; x++) value[y * SCENE + x] *= x < BOTTLE.x + BOTTLE.w ? 0.5 : 0.5 + 0.5 * (x - BOTTLE.x - BOTTLE.w) / 14;
  const out = new Uint8Array(SCENE * SCENE);
  for (let y = 0; y < SCENE; y++) for (let x = 0; x < SCENE; x++) {
    const i = y * SCENE + x, d = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
    out[i] = Math.min(238, Math.max(0, Math.floor(value[i] / 17 + d) * 17));
  }
  if (imageUrl) {
    const bottle = await bottleLayer(imageUrl);
    if (bottle) for (let y = 0; y < BOTTLE.h; y++) for (let x = 0; x < BOTTLE.w; x++) {
      const k = y * BOTTLE.w + x;
      if (bottle.alpha[k] < 40) continue;
      out[(BOTTLE.y + y) * SCENE + BOTTLE.x + x] = bottle.gray[k];
    }
  }
  return out;
}

/** Two 288×144 tiles: top, bottom. */
export function sceneTiles(scene: Uint8Array): Uint8Array[] {
  return [scene.slice(0, TILE_W * TILE_H), scene.slice(TILE_W * TILE_H)];
}
