// Keep the subject large without stretching the bottle or punching holes in dark glass.
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left=width, top=height, right=-1, bottom=-1;
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if(data[(y*width+x)*4+3] > 8) { left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y); }
  }
  return right < left ? {x:0,y:0,width,height} : {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
export async function bottleCanvas(source: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const response=await fetch(source);
  if(!response.ok) throw new Error('Bottle photograph unavailable');
  const bitmap=await createImageBitmap(await response.blob());
  try {
    const original=document.createElement('canvas'); original.width=bitmap.width; original.height=bitmap.height;
    const ctx=original.getContext('2d')!;ctx.drawImage(bitmap,0,0);
    const bounds=alphaBounds(ctx.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const out=canvas.getContext('2d')!;out.fillStyle='#000';out.fillRect(0,0,width,height);
    out.imageSmoothingQuality='high';
    const scale=Math.min((width-8)/bounds.width,(height-8)/bounds.height);
    const w=bounds.width*scale,h=bounds.height*scale;
    out.drawImage(bitmap,bounds.x,bounds.y,bounds.width,bounds.height,(width-w)/2,(height-h)/2,w,h);
    return canvas;
  } finally { bitmap.close(); }
}

// ═══ Lit stage (depth on a flat green panel) ═══
// The bottle stands on a small "stage": a faint spotlight behind it, a pool of light on
// the floor and a short reflection fading below the base. All of it lives in the lowest
// brightness levels, so after tone mapping it reads as dithered atmosphere, not a shape.
export async function stageCanvas(source: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const response=await fetch(source);
  if(!response.ok) throw new Error('Bottle photograph unavailable');
  const bitmap=await createImageBitmap(await response.blob());
  try {
    const probe=document.createElement('canvas'); probe.width=bitmap.width; probe.height=bitmap.height;
    const pctx=probe.getContext('2d')!; pctx.drawImage(bitmap,0,0);
    const b=alphaBounds(pctx.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d')!; ctx.fillStyle='#000'; ctx.fillRect(0,0,width,height);
    const base=Math.round(height*0.87), cx=width/2;
    const scale=Math.min((width-12)/b.width,(base-6)/b.height);
    const w=b.width*scale, h=b.height*scale, x=cx-w/2, y=base-h;
    // spotlight behind the bottle's shoulders
    // (fades to zero inside the image bounds, so the container edge never shows as a hard line)
    ctx.save(); ctx.translate(cx,y+h*0.45); ctx.scale(1,2.2);
    const spot=ctx.createRadialGradient(0,0,0,0,0,width*0.46);
    spot.addColorStop(0,'rgba(255,255,255,0.20)'); spot.addColorStop(0.5,'rgba(255,255,255,0.07)'); spot.addColorStop(0.9,'rgba(255,255,255,0)');
    ctx.fillStyle=spot; ctx.fillRect(-width,-height,width*2,height*2); ctx.restore();
    // pool of light on the floor
    ctx.save(); ctx.translate(cx,base); ctx.scale(1,0.18);
    const pool=ctx.createRadialGradient(0,0,0,0,0,width*0.47);
    pool.addColorStop(0,'rgba(255,255,255,0.30)'); pool.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=pool; ctx.fillRect(-width,-height,width*2,height*2); ctx.restore();
    // reflection: the base mirrored, fading out within ~12% of the height
    const reflection=document.createElement('canvas'); reflection.width=width; reflection.height=height;
    const rctx=reflection.getContext('2d')!;
    rctx.save(); rctx.translate(0,base*2); rctx.scale(1,-1); rctx.drawImage(bitmap,b.x,b.y,b.width,b.height,x,y,w,h); rctx.restore();
    rctx.globalCompositeOperation='destination-in';
    const fade=rctx.createLinearGradient(0,base,0,base+height*0.12);
    fade.addColorStop(0,'rgba(0,0,0,0.32)'); fade.addColorStop(1,'rgba(0,0,0,0)');
    rctx.fillStyle=fade; rctx.fillRect(0,0,width,height);
    ctx.drawImage(reflection,0,0);
    // the bottle itself
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(bitmap,b.x,b.y,b.width,b.height,x,y,w,h);
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
const SCALE = 13;      // tone 1.0 before roll-off → level 13
const PEAK = 12;       // hard cap (of 15); white labels land near 10
const GAMMA = 1.15;    // >1 darkens mid-tones slightly
const KNEE = 0.55;     // above this, highlights roll off softly instead of clipping
const ROLLOFF = 0.45;  // slope above the knee
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
