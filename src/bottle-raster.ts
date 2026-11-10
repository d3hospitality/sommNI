import { artworkStore, bottleCacheKey, bottlePhoto, artworkOwner } from './artwork-store';
// Keep the subject large without stretching the bottle or punching holes in dark glass.
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left=width, top=height, right=-1, bottom=-1;
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if(data[(y*width+x)*4+3] > 8) { left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y); }
  }
  return right < left ? {x:0,y:0,width,height} : {x:left,y:top,width:right-left+1,height:bottom-top+1};
}
export async function bottleCanvas(source: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const bitmap=await createImageBitmap(await bottlePhoto(source));
  try {
    const original=document.createElement('canvas'); original.width=bitmap.width; original.height=bitmap.height;
    const ctx=original.getContext('2d')!;ctx.drawImage(bitmap,0,0);
    const bounds=alphaBounds(ctx.getImageData(0,0,bitmap.width,bitmap.height).data,bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const out=canvas.getContext('2d')!; // Preserve alpha for a restrained inside-edge highlight.
    out.imageSmoothingQuality='high';
    const scale=Math.min((width-8)/bounds.width,(height-8)/bounds.height);
    const w=bounds.width*scale,h=bounds.height*scale;
    out.drawImage(bitmap,bounds.x,bounds.y,bounds.width,bounds.height,(width-w)/2,(height-h)/2,w,h);
    return canvas;
  } finally { bitmap.close(); }
}

export const stageCacheKey=(sourceKey:string,width:number,height:number)=>`sprite-floor-v2:${width}x${height}:${sourceKey}`;

/** A low pool of light under the bottle; the background above the base stays unlit. */
export async function stageCanvas(source: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const scope=artworkOwner(),sourceKey=await bottleCacheKey(source),id=sourceKey?stageCacheKey(sourceKey,width,height):null;
  const stored=id?await artworkStore('get',id).catch(()=>null):null;
  if(stored?.blob){const bitmap=await createImageBitmap(stored.blob);try{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(bitmap,0,0);return canvas;}finally{bitmap.close()}}
  const bottle=await bottleCanvas(source,width,Math.round(height*.90));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!, rgba=bottle.getContext('2d')!.getImageData(0,0,bottle.width,bottle.height).data;
  const bounds=alphaBounds(rgba,bottle.width,bottle.height);
  const base=Math.round(height*.92), top=base-bounds.y-bounds.height;
  // Confine the floor to a shallow ellipse. No shoulder halo or spatial dither.
  ctx.save();ctx.translate(width/2,base);ctx.scale(1,.14);
  const pool=ctx.createRadialGradient(0,0,0,0,0,width*.43);
  pool.addColorStop(0,'rgba(150,150,150,.48)');pool.addColorStop(.45,'rgba(120,120,120,.24)');pool.addColorStop(1,'rgba(90,90,90,0)');
  ctx.fillStyle=pool;ctx.fillRect(-width*.44,-width*.44,width*.88,width*.88);ctx.restore();
  // A short reflection sits below the base; it never surrounds the bottle.
  const reflection=document.createElement('canvas');reflection.width=width;reflection.height=height;
  const rctx=reflection.getContext('2d')!;rctx.translate(0,base*2);rctx.scale(1,-1);rctx.drawImage(bottle,0,top);rctx.setTransform(1,0,0,1,0,0);
  rctx.globalCompositeOperation='destination-in';
  const fade=rctx.createLinearGradient(0,base,0,base+height*.055);fade.addColorStop(0,'rgba(0,0,0,.22)');fade.addColorStop(1,'rgba(0,0,0,0)');
  rctx.fillStyle=fade;rctx.fillRect(0,base,width,height-base);rctx.clearRect(0,0,width,base);
  ctx.drawImage(reflection,0,0);ctx.drawImage(bottle,0,top);
  if(id&&(sourceKey!.startsWith('catalog:')||scope===artworkOwner())){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(blob)await artworkStore('put',{id,scope:sourceKey!.startsWith('catalog:')?'catalog':scope,kind:'sprite',blob}).catch(()=>{});}
  return canvas;
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

// G2 is additive: zero is unlit/transparent, not opaque black. Keep the dark
// body near zero and separate it with brighter labels, natural reflections and a
// quiet one-pixel INSIDE edge. No surrounding spotlight, grain or ordered dither. The stage adds only a low floor.
// Quantizing without a spatial threshold gives equal source tones equal output.
const BLACK_POINT = 0.035;
const WHITE_POINT = 1.0;
const PEAK = 12; // Reserve full level 15 for native text.

/** RGBA pixels → exact 16-level grayscale (multiples of 17). */
export function toGreenLevels(pixels: Uint8ClampedArray, width = 0): Uint8Array {
  const gray=new Uint8Array(pixels.length/4);
  for(let i=0;i<gray.length;i++) {
    const o=i*4, alpha=pixels[o+3]/255;
    if(alpha < 0.03) continue;
    let light=(.299*pixels[o]+.587*pixels[o+1]+.114*pixels[o+2])/255;
    // Recover small ink edges lost by downsampling. Ignore transparent neighbours
    // so the silhouette and quiet floor never acquire sharpening halos.
    if(width>0 && alpha>.95) {
      const x=i%width, neighbours=[x>0?i-1:-1,x<width-1?i+1:-1,i-width,i+width];
      let sum=0,count=0;
      for(const n of neighbours)if(n>=0&&n<gray.length&&pixels[n*4+3]>242){sum+=(.299*pixels[n*4]+.587*pixels[n*4+1]+.114*pixels[n*4+2])/255;count++;}
      if(count===4){const detail=light-sum/count;if(Math.abs(detail)>.012)light=Math.max(0,Math.min(1,light+detail*.85));}
    }
    const normalized=Math.max(0,Math.min(1,(light-BLACK_POINT)/(WHITE_POINT-BLACK_POINT)));
    let level=Math.round(Math.pow(normalized,1.12)*PEAK*alpha);
    if(width > 0 && alpha >= .5) {
      const x=i%width;
      const edge=(x>0 && pixels[(i-1)*4+3]<128) ||
        (x<width-1 && i+1<gray.length && pixels[(i+1)*4+3]<128) ||
        (i>=width && pixels[(i-width)*4+3]<128) ||
        (i+width<gray.length && pixels[(i+width)*4+3]<128);
      if(edge) level=Math.max(level,2);
    }
    gray[i]=Math.min(PEAK,level)*17;
  }
  return gray;
}

// Compact glasses portraits: preserve black, the faint silhouette and white labels,
// but collapse subtle photographic shading into seven native G2 tones.
const BOTTLE_BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const BOTTLE_TONES = [0, 17, 34, 68, 102, 153, 204] as const;
export function toBottleGreenLevels(pixels: Uint8ClampedArray, width = 0): Uint8Array {
  const source=toGreenLevels(pixels,width),gray=new Uint8Array(source);
  for(let i=0;i<gray.length;i++) {
    // Dither only opaque midtones away from ink edges; bright label paper stays clean.
    let value=gray[i];
    if(width>0&&pixels[i*4+3]>242&&value>=34&&value<=136){
     const x=i%width,y=Math.floor(i/width),left=x>0?source[i-1]:value,right=x<width-1?source[i+1]:value;
     if(Math.abs(left-value)<18&&Math.abs(right-value)<18)value+=(BOTTLE_BAYER[(y%4)*4+x%4]-7.5)*1.2;
    }
    let closest:number=BOTTLE_TONES[0];
    for(const tone of BOTTLE_TONES)if(Math.abs(tone-value)<Math.abs(closest-value))closest=tone;
    gray[i]=closest;
  }
  return gray;
}
