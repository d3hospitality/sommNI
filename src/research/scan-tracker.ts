export type BottleOutline = { left:number; top:number; width:number; height:number; rows:number[] };
/** Low-resolution contrast tracking, not wine recognition or a semantic bottle detector.
 * Reject weak/cluttered frames rather than presenting a fabricated lock. No frames leave the device. */
export function traceBottle(data:Uint8ClampedArray,width:number,height:number):BottleOutline|null {
 const mask=new Uint8Array(width*height),seen=new Uint8Array(mask.length);
 const median=(a:number[])=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
 for(let y=0;y<height;y++){
  const borders=[1,3,5,width-6,width-4,width-2],bg=[0,1,2].map(c=>median(borders.map(x=>data[(y*width+x)*4+c])));
  for(let x=2;x<width-2;x++){
   const i=y*width+x,p=i*4;
   const diff=Math.hypot(data[p]-bg[0],data[p+1]-bg[1],data[p+2]-bg[2]);
   mask[i]=data[p+3]>100&&diff>65?1:0;
  }
 }
 let best:number[]|null=null,score=0;
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||seen[start])continue;
  const pixels=[start];seen[start]=1;let l=width,r=0,t=height,b=0;
  for(let q=0;q<pixels.length;q++){
   const i=pixels[q],x=i%width,y=Math.floor(i/width);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
   for(const n of [x>0?i-1:-1,x<width-1?i+1:-1,i-width,i+width])if(n>=0&&n<mask.length&&mask[n]&&!seen[n]){seen[n]=1;pixels.push(n);}
  }
  const w=r-l+1,h=b-t+1,ratio=h/w,fill=pixels.length/(w*h),center=(l+r)/2/width;
  if(h<height*.35||w<width*.08||w>width*.7||ratio<1.55||ratio>9||fill<.18||t<2||b>height-3)continue;
  const s=h/height*(1-Math.abs(center-.5))*Math.min(fill,.7);
  if(s>score){score=s;best=[l,r,t,b,...pixels];}
 }
 if(!best)return null;
 const [l,r,t,b,...pixels]=best,w=r-l+1,h=b-t+1,rows:number[]=[];
 // Contour widths sampled along the detected component, filling gaps at light labels.
 const spans=Array.from({length:h},()=>[width,0]);
 for(const i of pixels){const x=i%width,y=Math.floor(i/width)-t;spans[y][0]=Math.min(spans[y][0],x);spans[y][1]=Math.max(spans[y][1],x);}
 for(let band=0;band<12;band++){
  const y=Math.min(h-1,Math.round(band/11*(h-1))),span=spans[y];
  rows.push(span[0]<=span[1]?Math.max(.18,(span[1]-span[0]+1)/w):rows[rows.length-1]||1);
 }
 return {left:l/width,top:t/height,width:w/width,height:h/height,rows};
}

/** Owns pending camera permission too: closing during the prompt stops the eventual stream. */
export class CameraLease {
 private revision=0;
 stream:MediaStream|null=null;
 stop(){this.revision++;this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;}
 async open(acquire:()=>Promise<MediaStream>):Promise<MediaStream|null>{
  this.stop();const revision=this.revision,stream=await acquire();
  if(revision!==this.revision){stream.getTracks().forEach(track=>track.stop());return null;}
  this.stream=stream;return stream;
 }
}
