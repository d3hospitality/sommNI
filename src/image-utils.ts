// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Image Utilities
// Grayscale pipeline from soPHICON + bottle sprite support
// Supports: split logo (200x100 halves), single bottle (100x100)
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImageRawDataUpdate, ImageRawDataUpdateResult } from '@evenrealities/even_hub_sdk';
import { bottleCanvas, stageCanvas, ruleCanvas, toGreenLevels } from './bottle-raster';
import { encodeGrayscalePng } from './pngEncoder';
import { assetIdFor } from './identity';
import { bottleImageUrl } from './bottle-assets';
import { NOTES_IMG, NOTES_RULE } from './pages';

// One queue for the bridge; old page uploads are discarded before sending.
let imageEpoch=0;
let imageQueue: Promise<void> = Promise.resolve();
export function invalidateImages() { imageEpoch++; }
async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array, epoch=imageEpoch): Promise<void> {
  const task=imageQueue.catch(()=>{}).then(async()=>{
    if(epoch!==imageEpoch) return;
    const result=await bridge.updateImageRawData(new ImageRawDataUpdate({containerID:id,containerName:name,imageData:Array.from(data)}));
    if(!ImageRawDataUpdateResult.isSuccess(result)) throw new Error('Glasses image transfer failed');
    await new Promise(resolve=>setTimeout(resolve,100));
  });
  imageQueue=task; await task;
}
export async function pushBottlePhoto(bridge: EvenAppBridge, source: string, width: number, halfHeight: number): Promise<void> {
  const epoch=imageEpoch;
  const canvas=await stageCanvas(source,width,halfHeight*2);
  const ctx=canvas.getContext('2d')!;
  for(let i=0;i<2;i++) {
    const gray=toGreenLevels(ctx.getImageData(0,i*halfHeight,width,halfHeight).data,width);
    await pushImg(bridge,i+1,i===0?'bottle-top':'bottle-bot',encodeGrayscalePng(width,halfHeight,gray),epoch);
  }
}

// ═══════════════════════════════════════════════════════════════════
// LOGO — split 200x200 logo into two 200x100 containers
// Container 3 = top, Container 4 = bottom (matching sommNI 2)
// ═══════════════════════════════════════════════════════════════════

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const epoch=imageEpoch;
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2; // 190
  try {
    const cvs = document.createElement('canvas'); cvs.width=W; cvs.height=FULL_H;
    const ctx=cvs.getContext('2d')!; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,FULL_H);
    ctx.strokeStyle='#fff'; ctx.lineWidth=3;
    for (const x of [76,114]) { ctx.beginPath(); ctx.ellipse(x,82,47,66,0,0,Math.PI*2);ctx.stroke(); }
    ctx.fillStyle='#fff'; ctx.font='22px sans-serif';ctx.textAlign='center';ctx.fillText('wineLENS',95,176);

    // Extract top half → container 3
    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "logo-top", encodeGrayscalePng(W, HALF_H, topGray), epoch);

    // Extract bottom half → container 4
    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "logo-bottom", encodeGrayscalePng(W, HALF_H, botGray), epoch);

    console.log("[sommNI-TG] Logo pushed (split from single source)");
  } catch (e) { console.error("[sommNI-TG] Logo FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// GLOBE — split 1024×1024 globe into two 190×95 containers
// Container 3 = top, Container 4 = bottom (same layout as logo)
// ═══════════════════════════════════════════════════════════════════

export async function pushGlobeToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const epoch=imageEpoch;
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
    await pushImg(bridge, 3, "globe-top", encodeGrayscalePng(W, HALF_H, topGray), epoch);

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "globe-bottom", encodeGrayscalePng(W, HALF_H, botGray), epoch);

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
  const epoch=imageEpoch;
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
    await pushImg(bridge, 3, "grape-top", encodeGrayscalePng(W, HALF_H, topGray), epoch);

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "grape-bottom", encodeGrayscalePng(W, HALF_H, botGray), epoch);

    console.log(`[sommNI-TG] Grape sprite pushed: ${pick}`);
  } catch (e) { console.error("[sommNI-TG] Grape sprite FAILED:", e); }
}

// ═══════════════════════════════════════════════════════════════════
// BOTTLE SPRITE — single 100x100 grayscale (soPHICON pattern)
// Bottles live in /bottles/{wineId}/{wineId}-{shape}.png
// For the glasses we just need the 100x100 container
// ═══════════════════════════════════════════════════════════════════

export async function pushBottleSprite(
  bridge: EvenAppBridge, baseUrl: string, wineId: string | null,
  containerID: number, containerName: string,
): Promise<void> {
  const epoch=imageEpoch;
  // Try the bottle sprite — each wine has {wineId}/{wineId}-{shape}.png
  // We pick the first PNG found for the wine ID
  const asset = assetIdFor(wineId);
  if (!asset) return; // unknown wine: no image rather than another wine's bottle
  const bottleUrl = bottleImageUrl(baseUrl, asset);
  try {
    const canvas = await bottleCanvas(bottleUrl, 80, 80);
    const png = encodeGrayscalePng(80,80,toGreenLevels(canvas.getContext('2d')!.getImageData(0,0,80,80).data,80));
    await pushImg(bridge, containerID, containerName, png, epoch);
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
  bridge: EvenAppBridge, baseUrl: string, wineId: string | null,
  topID: number, topName: string, botID: number, botName: string,
): Promise<void> {
  const epoch=imageEpoch;
  const W = 80;       // match container width
  const HALF = 100;   // each half height (max SDK image height = 144)
  const TOTAL = HALF * 2;
  const asset = assetIdFor(wineId);
  if (!asset) return;
  const url = bottleImageUrl(baseUrl, asset);
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
    await pushImg(bridge, topID, topName, encodeGrayscalePng(W, HALF, topG), epoch);

    // Bottom half
    const botG = new Uint8Array(W * HALF);
    for (let i = 0; i < W * HALF; i++) { const o = (i + W * HALF) * 4; botG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, botID, botName, encodeGrayscalePng(W, HALF, botG), epoch);

    console.log(`[sommNI-TG] Bottle split pushed: ${wineId}`);
  } catch (e) { console.warn(`[sommNI-TG] Bottle split FAILED: ${wineId}`, e); }
}

// ═══════════════════════════════════════════════════════════════════
// BOTTLE SPRITE DUAL — 256×256 → scale-to-fit 100×280 → 2 halves
// No stretching, no cropping — just scale down and center on black.
// 100px wide = 144 - 22 clipped left - 22 clipped right.
// SDK max per container: 288w × 144h. We use 100×140 per half (under max).
// Container 1 = top half, Container 2 = bottom half
// ═══════════════════════════════════════════════════════════════════

export async function pushBottleSpriteDual(
  bridge: EvenAppBridge, baseUrl: string, wineId: string | null,
  halfW: number, halfH: number,
): Promise<void> {
  const asset = assetIdFor(wineId);
  if (!asset) return;
  try { await pushBottlePhoto(bridge, bottleImageUrl(baseUrl, asset), halfW, halfH); }
  catch (error) { console.warn('Bottle image unavailable; tasting notes remain visible.', error); }
}

/** Tasting notes page: the header rule first (instant), then the bottle on its lit stage. */
export async function pushTastingNotesImages(bridge: EvenAppBridge, baseUrl: string, wineId: string | null): Promise<void> {
  const epoch=imageEpoch;
  try {
    const {w,h}=NOTES_RULE;
    const gray=toGreenLevels(ruleCanvas(w,h).getContext('2d')!.getImageData(0,0,w,h).data,w);
    await pushImg(bridge,6,'rule',encodeGrayscalePng(w,h,gray),epoch);
  } catch (error) { console.warn('Header rule unavailable.', error); }
  if(epoch!==imageEpoch) return;
  await pushBottleSpriteDual(bridge, baseUrl, wineId, NOTES_IMG.w, NOTES_IMG.h);
}
