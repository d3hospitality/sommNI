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
  try {
    const topPng = await fetchAsGrayscalePng(baseUrl + "assets/80x80ER_sommni_blkWht_top_200x100.png", 200, 100);
    await pushImg(bridge, 3, "logo-top", topPng);
    console.log("[sommNI-TG] Logo top pushed");
  } catch (e) { console.error("[sommNI-TG] Logo top FAILED:", e); }

  try {
    const botPng = await fetchAsGrayscalePng(baseUrl + "assets/80x80ER_sommni_blkWht_bottom_200x100.png", 200, 100);
    await pushImg(bridge, 4, "logo-bottom", botPng);
    console.log("[sommNI-TG] Logo bottom pushed");
  } catch (e) { console.error("[sommNI-TG] Logo bottom FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// LOGO SPRITE — full sommni logo as 100x100 single container
// Used on Finder pages (Type, Vibe, Flavor, Body, World)
// ═══════════════════════════════════════════════════════════════════

export async function pushLogoSprite(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    const png = await fetchAsGrayscalePng(baseUrl + "assets/sommni-logo.png", 100, 100);
    await pushImg(bridge, 3, "logo-top", png);
    console.log("[sommNI-TG] Logo sprite pushed (100x100)");
  } catch (e) { console.error("[sommNI-TG] Logo sprite FAILED:", e); }
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
  const url = `${baseUrl}bottles/${wineId}.png`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const cvs = document.createElement('canvas');
    cvs.width = 200; cvs.height = 200;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 200, 200);
    const scale = Math.min(200 / bmp.width, 200 / bmp.height);
    const fw = Math.round(bmp.width * scale);
    const fh = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, Math.round((200 - fw) / 2), Math.round((200 - fh) / 2), fw, fh);
    const full = ctx.getImageData(0, 0, 200, 200).data;

    // Top half
    const topG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200 * 100; i++) { const o = i * 4; topG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, topID, topName, encodeGrayscalePng(200, 100, topG));

    // Bottom half
    const botG = new Uint8Array(200 * 100);
    for (let i = 0; i < 200 * 100; i++) { const o = (i + 200 * 100) * 4; botG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, botID, botName, encodeGrayscalePng(200, 100, botG));

    console.log(`[sommNI-TG] Bottle split pushed: ${wineId}`);
  } catch (e) { console.warn(`[sommNI-TG] Bottle split FAILED: ${wineId}`, e); }
}
