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
    const scale=Math.min((width-8)/bounds.width,(height-8)/bounds.height);
    const w=bounds.width*scale,h=bounds.height*scale;
    out.drawImage(bitmap,bounds.x,bounds.y,bounds.width,bounds.height,(width-w)/2,(height-h)/2,w,h);
    return canvas;
  } finally { bitmap.close(); }
}
export function toGreenLevels(pixels: Uint8ClampedArray): Uint8Array {
  const gray=new Uint8Array(pixels.length/4);
  for(let i=0;i<gray.length;i++) { const o=i*4; const light=(.299*pixels[o]+.587*pixels[o+1]+.114*pixels[o+2])*pixels[o+3]/255; gray[i]=Math.round(light/17)*17; }
  return gray;
}
