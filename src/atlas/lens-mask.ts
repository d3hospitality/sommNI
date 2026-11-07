const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
/** Full detail through 90% of the radius; a soft dissolve in the outer tenth. */
export function lensOpacity(distance:number,radius:number):number{
 const t=Math.max(0,Math.min(1,(distance/radius-.9)/.1));
 return 1-t*t*(3-2*t);
}
export function lensPixel(x:number,y:number,width:number,height:number,radius:number,cell=1):boolean{
 const opacity=lensOpacity(Math.hypot(x+.5-width/2,y+.5-height/2),radius);
 const threshold=(BAYER[(Math.floor(y/cell)%4)*4+Math.floor(x/cell)%4]+.5)/16;
 return opacity>threshold;
}
/** Stable screen-space grain: removed pixels are off on G2, with no frame-to-frame shimmer. */
export function maskGrayLens(gray:Uint8Array,width:number,height:number,radius=Math.min(width,height)/2-2):void{
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!lensPixel(x,y,width,height,radius))gray[y*width+x]=0;
}
const masks=new Map<string,HTMLCanvasElement>();
/** Cached alpha mask, composited without reading the animated canvas back every frame. */
export function maskCanvasLens(ctx:CanvasRenderingContext2D,width:number,height:number,radius:number):void{
 radius=Math.round(radius);const key=`${width}:${height}:${radius}`;
 let mask=masks.get(key);
 if(!mask){
  mask=document.createElement('canvas');mask.width=width;mask.height=height;
  const m=mask.getContext('2d')!,pixels=m.createImageData(width,height),cell=width>400?2:1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.data[(y*width+x)*4+3]=lensPixel(x,y,width,height,radius,cell)?255:0;
  m.putImageData(pixels,0,0);if(masks.size>=6)masks.delete(masks.keys().next().value!);masks.set(key,mask);
 }
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.restore();
}
