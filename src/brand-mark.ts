import identity from '../brand/identity.json';
import wordmark from '../brand/wordmark.json';
import japanese from '../brand/japanese.json';

/** Vector geometry only: no font, network fetch, animation, or extra bridge calls. */
export function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#ffffff') {
  const p = size <= 32 ? identity.micro : identity.mark;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / p.size, size / p.size);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = p.stroke;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(p.frame)); ctx.stroke(new Path2D(p.glass)); ctx.fill(new Path2D(p.wine));
  ctx.restore();
}

export function brandTextCanvas(kind:'name'|'japanese',width=190,height=32):HTMLCanvasElement {
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d')!,art=kind==='name'?wordmark:japanese;
 const scale=Math.min((width-12)/art.width,(height-4)/art.height);
 ctx.fillStyle='#bbb';ctx.translate((width-art.width*scale)/2-art.x*scale,(height-art.height*scale)/2-art.y*scale);ctx.scale(scale,scale);
 for(const path of art.paths)ctx.fill(new Path2D(path));
 return canvas;
}
/** Same outline branding on phone and G2; no dependency on Japanese device fonts. */
export function brandGlassesCanvas():HTMLCanvasElement {
 const canvas=document.createElement('canvas');canvas.width=190;canvas.height=190;const ctx=canvas.getContext('2d')!;
 drawBrandMark(ctx,45,30,100,'#aaa');ctx.drawImage(brandTextCanvas('name',190,30),0,140);ctx.drawImage(brandTextCanvas('japanese',75,18),57,173);
 const pixels=ctx.getImageData(0,0,190,190);for(let i=0;i<pixels.data.length;i+=4){const v=Math.round(pixels.data[i]*pixels.data[i+3]/255/17)*17;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);return canvas;
}
