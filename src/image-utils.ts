import { announceCatalogWine } from './wine-context';
import { ReadingFlow } from './reading/flow';
import { readingText, READING_MAX_BYTES } from './reading/document';
import { labelBytes } from './glasses-list';
import { getLocale, translateTexts } from './intelligence/client';
// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Image Utilities
// Grayscale pipeline from soPHICON + bottle sprite support
// Supports: split logo (200x100 halves), single bottle (100x100)
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImuReportPace, OsEventTypeList, TextContainerUpgrade, ImageRawDataUpdate, ImageRawDataUpdateResult, RebuildPageContainer, TextContainerProperty } from '@evenrealities/even_hub_sdk';
import { validateGlassesPage } from './glasses-page';
import { bottleCanvas, stageCanvas, toBottleGreenLevels } from './bottle-raster';
import { encodeGrayscalePng, encodeCompactGrayscalePng } from './pngEncoder';
import { brandGlassesCanvas } from './brand-mark';
import { homeGlassGray, GLASS_WIDTH, GLASS_HEIGHT, APERTURE, Liquid } from './intelligence/pour';
import { HeadTilt, type GlassPose } from './intelligence/motion';
import { catalogPhoto } from './identity';
import { NOTES_IMG } from './pages';
import { displayOwner } from './display';

// One queue for the bridge; old page uploads are discarded before sending.
let imageEpoch=0;
let suspended=false;
let imageQueue: Promise<void> = Promise.resolve();
export function invalidateImages() { imageEpoch++; pauseHomePour(); }
export function suspendImages(value: boolean) { suspended=value; invalidateImages(); }
async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array | (()=>Promise<Uint8Array>), epoch=imageEpoch): Promise<void> {
  const task=imageQueue.catch(()=>{}).then(async()=>{
    if(suspended || epoch!==imageEpoch) return;
    const encoded=typeof data==='function'?await data():data;
    if(suspended || epoch!==imageEpoch) return;
    const result=await bridge.updateImageRawData(new ImageRawDataUpdate({containerID:id,containerName:name,imageData:Array.from(encoded)}));
    if(!ImageRawDataUpdateResult.isSuccess(result)) throw new Error('Glasses image transfer failed');
    // The bridge acknowledgement is the pacing boundary; no extra per-tile sleep.
  });
  imageQueue=task; await task;
}
/** Any other small bridge operation (e.g. a text upgrade) that must not interleave with image transfers. */
export async function sendSerial(task: () => Promise<unknown>, epoch=imageEpoch): Promise<void> {
  const run=imageQueue.catch(()=>{}).then(async()=>{ if(!suspended && epoch===imageEpoch) await task(); });
  imageQueue=run; await run;
}
/** Storage and microphone cleanup must share BLE ordering, even across a page change or pause. */
export function queueBridgeControl<T>(task: () => Promise<T>): Promise<T> {
  const run=imageQueue.catch(()=>{}).then(task);
  imageQueue=run.then(()=>{});
  return run;
}
/** Resolves once the app-wide image queue has nothing in flight (used before another module takes the display). */
export async function imageIdle(): Promise<void> { await imageQueue.catch(()=>{}); }
/** Page changes wait for any in-flight image transfer to finish. */
let pageRevision=0;
export async function rebuildGlassesPage(bridge: EvenAppBridge, page: RebuildPageContainer): Promise<boolean> {
  validateGlassesPage(page);
  readingFlow=null;
  invalidateImages(); homeLayout=false;
  const revision=++pageRevision,language=getLocale();
  let accepted=false;
  await sendSerial(async () => { accepted=await bridge.rebuildPageContainer(page); });
  if(revision===pageRevision)homeLayout=accepted&&!!page.imageObject?.some(box=>box.containerName==='home-pour');
  const readingPage=new RebuildPageContainer({...page,textObject:page.textObject?.map(box=>new TextContainerProperty({...box,content:readingText(page,box.containerID!)??box.content}))});
  if(accepted && revision===pageRevision) {
    for(const box of page.textObject??[]) {
      const content=readingText(page,box.containerID!);
      if(content!==undefined && content!==box.content) await sendSerial(async()=>{
        if(revision!==pageRevision)return;
        await upgradeReadingText(bridge,box,content);
      });
    }
  }
  const noteBoxes=readingPage.textObject?.filter(box=>['notes','library-notes','story-2'].includes(box.containerName??''))??[];
  if(accepted&&language!=='en'&&noteBoxes.length){
   const epoch=imageEpoch;
   void translateTexts(noteBoxes.map(box=>box.content??'')).then(async texts=>{
    if(revision!==pageRevision||language!==getLocale()||epoch!==imageEpoch)return;
    for(let i=0;i<noteBoxes.length;i++){const box=noteBoxes[i],content=texts[i];if(labelBytes(content)>READING_MAX_BYTES)throw Error('Full translation is available on your phone; keeping the complete original on G2.');await sendSerial(async()=>{if(revision!==pageRevision)return;await upgradeReadingText(bridge,box,content);box.content=content;},epoch);}
   }).catch(error=>window.dispatchEvent(new CustomEvent('winelens-reading-status',{detail:'Original notes shown. '+error.message})));
  }

  return accepted;
}
// Some hosts enforce 999 bytes even on upgrades. Keep one scroll container and
// move an overlapping text window only when that host rejects the full buffer.
let smallTextHost=false;
let readingFlow:{bridge:EvenAppBridge;box:TextContainerProperty;flow:ReadingFlow;owner:string;revision:number;busy:boolean}|null=null;
/** Call from inside sendSerial so this shares the same transport ownership. */
export async function upgradeReadingText(bridge:EvenAppBridge,box:TextContainerProperty,content:string){
 const write=(text:string)=>bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:box.containerID,containerName:box.containerName,content:text,contentOffset:0,contentLength:0}));
 if(labelBytes(content)<=999||!smallTextHost){if(await write(content)){readingFlow=null;return;}}
 if(labelBytes(content)<=999)throw Error('The glasses did not accept the reading.');
 const flow=new ReadingFlow(content,box.width??448,box.height??180);
 if(!await write(flow.content))throw Error('The glasses did not accept the reading.');
 smallTextHost=true;readingFlow={bridge,box,flow,owner:displayOwner(),revision:pageRevision,busy:false};
}
export function handleContinuousReadingScroll(type:number|undefined):boolean {
 const state=readingFlow;
 if(!state||suspended||state.owner!==displayOwner()||state.revision!==pageRevision||(type!==1&&type!==2))return false;
 state.flow.move(type===2?1:-1);
 if(!state.busy){state.busy=true;void (async()=>{
  let sent=-1;
  try{do{await sendSerial(async()=>{
   if(readingFlow!==state||state.owner!==displayOwner()||state.revision!==pageRevision)return;
   sent=state.flow.index;
   const ok=await state.bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:state.box.containerID,containerName:state.box.containerName,content:state.flow.content,contentOffset:0,contentLength:0}));
   if(!ok)throw Error('Reading scroll was not accepted.');
  });}while(readingFlow===state&&!suspended&&state.owner===displayOwner()&&state.revision===pageRevision&&sent!==state.flow.index);
  }catch(error){window.dispatchEvent(new CustomEvent('winelens-reading-status',{detail:String(error)}));}finally{state.busy=false;}
 })();}
 return true;
}
export function currentImageEpoch(): number { return imageEpoch; }
/** Send a ready 16-level grayscale buffer through the app-wide queue; stale epochs never send. */
export async function pushGrayImage(bridge: EvenAppBridge, id: number, name: string, width: number, height: number, gray: Uint8Array, epoch=imageEpoch,compact=true): Promise<void> {
  // Reserve the queue before asynchronous compression so imageIdle and page
  // changes also wait for images that have not reached the transport yet.
  const png=compact?()=>encodeCompactGrayscalePng(width,height,gray):encodeGrayscalePng(width,height,gray);
  await pushImg(bridge,id,name,png,epoch);
}
export async function pushBottlePhoto(bridge: EvenAppBridge, source: string, width: number, halfHeight: number): Promise<void> {
  const epoch=imageEpoch;
  const canvas=await stageCanvas(source,width,halfHeight*2);
  const ctx=canvas.getContext('2d')!;
  for(let i=0;i<2;i++) {
    const gray=toBottleGreenLevels(ctx.getImageData(0,i*halfHeight,width,halfHeight).data,width);
    await pushImg(bridge,i+1,i===0?'bottle-top':'bottle-bot',()=>encodeCompactGrayscalePng(width,halfHeight,gray),epoch);
  }
}

// Home sends the latest pose plus a short settling tail. Still liquid has no idle loop.
let homeLayout=false,homeEnabled=true,homeRun=0;
let homeTimer:ReturnType<typeof setTimeout>|undefined;
let homeBridge:EvenAppBridge|null=null,homeUnsubscribe:(()=>void)|undefined;
let homeImuRequested=false;
const headTilt=new HeadTilt();
const homeReduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function motionStatus(message:string){window.dispatchEvent(new CustomEvent('sommni-motion-status',{detail:message}));}
// Hardware stop must run even after rendering is suspended or its epoch changes.
function homeHardware(task:()=>Promise<unknown>){const run=imageQueue.catch(()=>{}).then(task).then(()=>{});imageQueue=run;return run;}
export function pauseHomePour(){
 homeRun++;if(homeTimer!==undefined)clearTimeout(homeTimer);homeTimer=undefined;
 homeUnsubscribe?.();homeUnsubscribe=undefined;
 if(homeImuRequested&&homeBridge){const bridge=homeBridge;homeImuRequested=false;void homeHardware(()=>bridge.imuControl(false)).catch(()=>motionStatus('Head motion stopped locally; reconnect if the device is unavailable.'));}
}
export function configureHomeMotion(enabled:boolean){homeEnabled=enabled;pauseHomePour();void resumeHomePour();}
export function centerHomeGlass(){headTilt.reset();motionStatus('Look straight ahead. The next head sample becomes the center.');}
export async function resumeHomePour(){
 if(!homeLayout||suspended||!homeBridge||displayOwner()!=='catalog')return;
 pauseHomePour();headTilt.reset();const run=homeRun,epoch=imageEpoch,bridge=homeBridge;
 const valid=()=>homeLayout&&!suspended&&displayOwner()==='catalog'&&run===homeRun&&epoch===imageEpoch;
 let pose:GlassPose={roll:0,pitch:0},last='',busy=false,lastFrameAt=0,received=false;
 let lastPixels:Uint8Array|undefined;
 const liquid=new Liquid(APERTURE);liquid.reset(performance.now());
 const schedule=()=>{if(!valid()||busy||homeTimer!==undefined)return;homeTimer=setTimeout(()=>{homeTimer=undefined;void frame();},Math.max(0,350-(Date.now()-lastFrameAt)));};
 const frame=async()=>{
  if(!valid()||busy)return;
  // Start-to-start cadence: slow acknowledgements supply their own backpressure.
  // Count unchanged attempts too, so a settling surface cannot busy-loop.
  lastFrameAt=Date.now();liquid.advance(performance.now());const state=liquid.surface();
  const key=[pose.roll,pose.pitch,state.level.toFixed(3),state.sx.toFixed(3),state.sz.toFixed(3),...state.modes.map(v=>v.toFixed(3))].join(':');
  if(key===last){if(liquid.active())schedule();return;}
  const pixels=homeGlassGray(pose.roll,pose.pitch,state);
  if(lastPixels&&pixels.every((value,index)=>value===lastPixels![index])){last=key;if(liquid.active())schedule();return;}
  busy=true;const current={...pose};let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([pushGrayImage(bridge,3,'home-pour',GLASS_WIDTH,GLASS_HEIGHT,pixels,epoch,true),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('Head-motion image transfer timed out')),5000);})]);
   if(valid()){last=key;lastPixels=pixels;}
  }catch(error){if(valid()){pauseHomePour();motionStatus('Glass held still: image transfer did not finish.');}}
  finally{if(deadline!==undefined)clearTimeout(deadline);busy=false;}
  if(valid()&&(liquid.active()||pose.roll!==current.roll||pose.pitch!==current.pitch))schedule();
 };
 await frame();if(!valid())return;
 if(!homeEnabled||homeReduced()){motionStatus('Still glass. Head sensor is off.');return;}
 if(typeof bridge.imuControl!=='function'){motionStatus('This host does not expose head motion. Showing a still glass.');return;}
 homeUnsubscribe=bridge.onEvenHubEvent(event=>{
  if(!valid()||event.sysEvent?.eventType!==OsEventTypeList.IMU_DATA_REPORT||!event.sysEvent.imuData)return;
  const next=headTilt.sample(event.sysEvent.imuData);if(!next)return;if(next.roll===pose.roll&&next.pitch===pose.pitch)return;pose=next;liquid.setPose(pose,performance.now());
  if(!received){received=true;motionStatus('Following your head. The wine sloshes and settles at a fixed fill.');}
  schedule();
 });
 homeImuRequested=true;motionStatus('Waiting for G2 head motion…');
 try{await homeHardware(async()=>{if(!valid())return;const ok=await bridge.imuControl(true,ImuReportPace.P200);if(!ok)throw Error('IMU not available');});}
 catch{if(valid()){pauseHomePour();motionStatus('Head motion is unavailable on this host. Showing a still glass.');}}
}
/** Startup uses createStartUpPageContainer, outside the normal rebuild wrapper. */
export function registerHomeLayout(){homeLayout=true;}
/** One native-size composite: fixed dithered identity behind the moving glass. */
export async function pushHomeToGlasses(bridge:EvenAppBridge){
 if(!homeLayout||suspended||displayOwner()!=='catalog')return;
 pauseHomePour();homeBridge=bridge;const epoch=imageEpoch,run=homeRun;
 try{
  if(epoch===imageEpoch&&run===homeRun)await resumeHomePour();
 }catch(error){console.warn('[sommNI] Home artwork unavailable:',error);}
}
if(typeof window!=='undefined')window.addEventListener('pagehide',pauseHomePour);

// ═══════════════════════════════════════════════════════════════════
// LOGO — native 190x190 Focus Pour panel, split into two 190x95 containers
// Container 3 = top, Container 4 = bottom (matching sommNI 2)
// ═══════════════════════════════════════════════════════════════════

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if(homeLayout)return pushHomeToGlasses(bridge);
  const epoch=imageEpoch;
  const W = 190;
  const HALF_H = 95;
  try {
    const cvs = brandGlassesCanvas();
    const ctx = cvs.getContext('2d')!;

    // Extract top half → container 3
    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "logo-top", ()=>encodeCompactGrayscalePng(W, HALF_H, topGray), epoch);

    // Extract bottom half → container 4
    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "logo-bottom", ()=>encodeCompactGrayscalePng(W, HALF_H, botGray), epoch);

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
    await pushImg(bridge, 3, "globe-top", ()=>encodeCompactGrayscalePng(W, HALF_H, topGray), epoch);

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "globe-bottom", ()=>encodeCompactGrayscalePng(W, HALF_H, botGray), epoch);

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
    await pushImg(bridge, 3, "grape-top", ()=>encodeCompactGrayscalePng(W, HALF_H, topGray), epoch);

    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "grape-bottom", ()=>encodeCompactGrayscalePng(W, HALF_H, botGray), epoch);

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
  announceCatalogWine(wineId);
  const bottleUrl = catalogPhoto(wineId,baseUrl);
  if (!bottleUrl) return;
  try {
    const canvas = await bottleCanvas(bottleUrl, 80, 80);
    const png = encodeGrayscalePng(80,80,toBottleGreenLevels(canvas.getContext('2d')!.getImageData(0,0,80,80).data,80));
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
  const url = catalogPhoto(wineId,baseUrl);
  if (!url) return;
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
    await pushImg(bridge, topID, topName, ()=>encodeCompactGrayscalePng(W, HALF, topG), epoch);

    // Bottom half
    const botG = new Uint8Array(W * HALF);
    for (let i = 0; i < W * HALF; i++) { const o = (i + W * HALF) * 4; botG[i] = 0.299 * full[o] + 0.587 * full[o + 1] + 0.114 * full[o + 2]; }
    await pushImg(bridge, botID, botName, ()=>encodeCompactGrayscalePng(W, HALF, botG), epoch);

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
  announceCatalogWine(wineId);
  const photo = catalogPhoto(wineId,baseUrl);
  if (!photo) return;
  try { await pushBottlePhoto(bridge, photo, halfW, halfH); }
  catch (error) { console.warn('Bottle image unavailable; tasting notes remain visible.', error); }
}

/** Tasting notes keep the portrait beside one continuous native scroll container. */
export async function pushTastingNotesImages(bridge: EvenAppBridge, baseUrl: string, wineId: string | null): Promise<void> {
  await pushBottleSpriteDual(bridge, baseUrl, wineId, NOTES_IMG.w, NOTES_IMG.h);
}
