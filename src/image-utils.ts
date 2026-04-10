// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Image Utilities
// Grayscale pipeline from soPHICON + bottle sprite support
// Supports: split logo (200x100 halves), single bottle (100x100)
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from './pngEncoder';

/**
 * Fetch any image, scale to fit container (centered, aspect-preserved),
 * convert to grayscale PNG bytes for the G2 display.
 */
async function fetchAsGrayscalePng(source: string, w: number, h: number): Promise<Uint8Array> {
  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${source}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);

  const scale = Math.min(w / bmp.width, h / bmp.height);
  const fitW = Math.round(bmp.width * scale);
  const fitH = Math.round(bmp.height * scale);
  const offX = Math.round((w - fitW) / 2);
  const offY = Math.round((h - fitH) / 2);

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, offX, offY, fitW, fitH);

  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
  }
  return encodeGrayscalePng(w, h, gray);
}

/** Push raw PNG data to a glasses image container */
async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array): Promise<void> {
  await bridge.updateImageRawData(new ImageRawDataUpdate({
    containerID: id, containerName: name, imageData: Array.from(data),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// LOGO — split 200x200 logo into two 200x100 containers
// Container 3 = top, Container 4 = bottom (matching sommNI 2)
// ═══════════════════════════════════════════════════════════════════

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2; // 190
  try {
    const resp = await fetch(baseUrl + "assets/sommni-2-logo.png");
    if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    // Scale source to fit 190×190, centered on black canvas
    const scale = Math.min(W / bmp.width, FULL_H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((FULL_H - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = FULL_H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, FULL_H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    // Extract top half → container 3
    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "logo-top", encodeGrayscalePng(W, HALF_H, topGray));

    // Extract bottom half → container 4
    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "logo-bottom", encodeGrayscalePng(W, HALF_H, botGray));

    console.log("[sommNI-TG] Logo pushed (split from single source)");
  } catch (e) { console.error("[sommNI-TG] Logo FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// GLOBE — split 1024×1024 globe into two 190×95 containers
// Container 3 = top, Container 4 = bottom (same layout as logo)
// ═══════════════════════════════════════════════════════════════════

export async function pushGlobeToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2;
  try {
    const resp = await fetch(baseUrl + "assets/globe.png");
    if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const scale = Math.min(W / bmp.width, FULL_H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((FULL_H - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = FULL_H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, FULL_H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "globe-top", encodeGrayscalePng(W, HALF_H, topGray));

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "globe-bottom", encodeGrayscalePng(W, HALF_H, botGray));

    console.log("[sommNI-TG] Globe pushed (split from single source)");
  } catch (e) { console.error("[sommNI-TG] Globe FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// GRAPE SPRITE — shuffle from 5 grape images, split into 190×95 halves
// Container 3 = top, Container 4 = bottom
// ═══════════════════════════════════════════════════════════════════

const GRAPE_SPRITES = [
  "cabernet-sauvignon", "merlot", "nebbiolo", "pinot-noir", "sangiovese",
];

export async function pushGrapeSpriteToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2;
  const pick = GRAPE_SPRITES[Math.floor(Math.random() * GRAPE_SPRITES.length)];
  try {
    const resp = await fetch(baseUrl + `grapes/${pick}.png`);
    if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const scale = Math.min(W / bmp.width, FULL_H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((FULL_H - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = FULL_H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, FULL_H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "grape-top", encodeGrayscalePng(W, HALF_H, topGray));

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "grape-bottom", encodeGrayscalePng(W, HALF_H, botGray));

    console.log(`[sommNI-TG] Grape sprite pushed: ${pick}`);
  } catch (e) { console.error("[sommNI-TG] Grape sprite FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// ROBOT SPRITE — 1024×1024 source → split into 190×95 top + 190×95 bottom
// Used on Find My Wine pages. Same layout as the sommNI logo split.
// Containers 3 = top half, 4 = bottom half
// ═══════════════════════════════════════════════════════════════════

export async function pushRobotSpriteToGlasses(
  bridge: EvenAppBridge, baseUrl: string, emotionId: string
): Promise<void> {
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2; // 190
  try {
    const resp = await fetch(baseUrl + `robots/robot-${emotionId}.png`);
    if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    // Scale source to fit 190×190, centered
    const scale = Math.min(W / bmp.width, FULL_H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((FULL_H - fitH) / 2);

    // Draw full image
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = FULL_H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, FULL_H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    // Extract top half
    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "robot-top", encodeGrayscalePng(W, HALF_H, topGray));

    // Extract bottom half
    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "robot-bottom", encodeGrayscalePng(W, HALF_H, botGray));

    console.log(`[sommNI-TG] Robot sprite pushed: ${emotionId}`);
  } catch (e) {
    console.error(`[sommNI-TG] Robot sprite FAILED (${emotionId}):`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// BOTTLE SPRITE — single 100x100 grayscale (soPHICON pattern)
// Bottles live in /bottles/{wineId}/{wineId}-{shape}.png
// For the glasses we just need the 100x100 container
// ═══════════════════════════════════════════════════════════════════

export async function pushBottleSprite(
  bridge: EvenAppBridge, baseUrl: string, wineId: string,
  containerID: number, containerName: string,
): Promise<void> {
  // Try the bottle sprite — each wine has {wineId}/{wineId}-{shape}.png
  // We pick the first PNG found for the wine ID
  const bottleUrl = `${baseUrl}bottles/${wineId}.png`;
  try {
    const png = await fetchAsGrayscalePng(bottleUrl, 100, 100);
    await pushImg(bridge, containerID, containerName, png);
    console.log(`[sommNI-TG] Bottle sprite pushed: ${wineId}`);
  } catch (e) {
    console.warn(`[sommNI-TG] Bottle sprite FAILED: ${wineId}`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// BOTTLE SPRITE SPLIT — 200x200 → two 200x100 halves
// For detail view with big bottle display
// ═══════════════════════════════════════════════════════════════════

export async function pushBottleSpriteSplit(
  bridge: EvenAppBridge, baseUrl: string, wineId: string,
  topID: number, topName: string, botID: number, botName: string,
): Promise<void> {
  const W = 80;       // match container width
  const HALF = 100;   // each half height (max SDK image height = 144)
  const TOTAL = HALF * 2;
  const url = `${baseUrl}bottles/${wineId}.png`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = TOTAL;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, TOTAL);
    const scale = Math.min(W / bmp.width, TOTAL / bmp.height);
    const fw = Math.round(bmp.width * scale);
    const fh = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, Math.round((W - fw) / 2), Math.round((TOTAL - fh) / 2), fw, fh);
    const full = ctx.getImageData(0, 0, W, TOTAL).data;

    // Top half
    const topG = new Uint8Array(W * HALF);
    for (let i = 0; i < W * HALF; i++) { const o = i * 4; topG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, topID, topName, encodeGrayscalePng(W, HALF, topG));

    // Bottom half
    const botG = new Uint8Array(W * HALF);
    for (let i = 0; i < W * HALF; i++) { const o = (i + W * HALF) * 4; botG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, botID, botName, encodeGrayscalePng(W, HALF, botG));

    console.log(`[sommNI-TG] Bottle split pushed: ${wineId}`);
  } catch (e) { console.warn(`[sommNI-TG] Bottle split FAILED: ${wineId}`, e); }
}

// ═══════════════════════════════════════════════════════════════════
// BOTTLE SPRITE DUAL — 1024×1024 → scale-to-fit 100×288 → 2 halves
// No stretching, no cropping — just scale down and center on black.
// 100px wide = 144 - 22 clipped left - 22 clipped right.
// SDK max per container: 288w × 144h. We use 100×144 per half.
// Container 1 = top half, Container 2 = bottom half
// ═══════════════════════════════════════════════════════════════════

export async function pushBottleSpriteDual(
  bridge: EvenAppBridge, baseUrl: string, wineId: string,
  halfW: number, halfH: number,
): Promise<void> {
  const url = `${baseUrl}bottles/${wineId}.png`;
  const totalH = halfH * 2;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    // Scale to FIT within halfW × totalH — no stretch, no crop
    const scale = Math.min(halfW / bmp.width, totalH / bmp.height);
    const fw = Math.round(bmp.width * scale);
    const fh = Math.round(bmp.height * scale);
    const offX = Math.round((halfW - fw) / 2);
    const offY = Math.round((totalH - fh) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = halfW; cvs.height = totalH;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, halfW, totalH);
    ctx.drawImage(bmp, offX, offY, fw, fh);

    // Split into top and bottom halves, push sequentially
    const names = ["bottle-top", "bottle-bot"];
    for (let s = 0; s < 2; s++) {
      const px = ctx.getImageData(0, s * halfH, halfW, halfH).data;
      const gray = new Uint8Array(halfW * halfH);
      for (let i = 0; i < gray.length; i++) {
        const o = i * 4;
        gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
      }
      await pushImg(bridge, s + 1, names[s], encodeGrayscalePng(halfW, halfH, gray));
    }

    console.log(`[sommNI-TG] Bottle pushed: ${wineId} (${halfW}×${totalH} → 2×${halfW}×${halfH})`);
  } catch (e) { console.warn(`[sommNI-TG] Bottle FAILED: ${wineId}`, e); }
}
