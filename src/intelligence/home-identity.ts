import japanese from '../../brand/japanese.json';

/** Local ソムニ outlines plus purpose-drawn, chamfered lettering echoing the
 * original public/assets/sommni-2-logo.png. No robot, font fetch, or bitmap crop. */
const RETRO_GLYPHS=[
  {x:0,d:'M25 1H6L1 6V10L6 15H20L25 20V24L20 29H1'},
  {x:35,d:'M6 1H21L26 6V24L21 29H6L1 24V6Z'},
  {x:72,d:'M1 29V1L14 14L27 1V29'},
  {x:110,d:'M1 29V1L14 14L27 1V29'},
  {x:148,d:'M1 29V1L27 29V1'},
  {x:186,d:'M1 1V29'},
];
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export const HOME_BRAND_WIDTH=200,HOME_BRAND_HEIGHT=144;
export function homeBrandCanvas(width=HOME_BRAND_WIDTH,height=HOME_BRAND_HEIGHT,options:{bold?:boolean;density?:number}={}){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
  ctx.save();ctx.scale(width/200,height/144);ctx.fillStyle='#fff';
  const scale=Math.min(188/japanese.width,61/japanese.height);
  ctx.save();ctx.translate((200-japanese.width*scale)/2-japanese.x*scale,24-japanese.y*scale);ctx.scale(scale,scale);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.lineJoin='round';for(const path of japanese.paths){const glyph=new Path2D(path);ctx.fill(glyph);if(options.bold)ctx.stroke(glyph);}ctx.restore();
  ctx.save();ctx.translate(23,98);ctx.scale(154/191,22/34);ctx.strokeStyle='#fff';ctx.lineWidth=options.bold?8:5;ctx.lineJoin='bevel';ctx.lineCap='square';
  for(const letter of RETRO_GLYPHS){ctx.save();ctx.translate(letter.x,2);ctx.stroke(new Path2D(letter.d));ctx.restore();}ctx.restore();ctx.restore();
  const image=ctx.getImageData(0,0,width,height),d=image.data;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,coverage=d[i+3]/255*(.68-.18*y/height)*(options.density??1),on=coverage>(BAYER[(y%4)*4+x%4]+.5)/16;
    d[i]=d[i+1]=d[i+2]=255;d[i+3]=on?255:0;
  }
  ctx.putImageData(image,0,0);return canvas;
}

/** Phone watermark stays monochrome, visibly dithered, and low-opacity in CSS. */
export function paintHomeWordmark(canvas:HTMLCanvasElement){
  const ctx=canvas.getContext('2d')!,source=homeBrandCanvas(canvas.width,canvas.height);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<image.data.length;i+=4){image.data[i]=196;image.data[i+1]=168;image.data[i+2]=77;}ctx.putImageData(image,0,0);
}
