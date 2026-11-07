import {APERTURE,Liquid,type Surface} from '../home-directions/fluid';
import {paintVessel} from '../home-directions/render';
import {homeBrandCanvas} from './home-identity';
export {APERTURE,Liquid};

/** One narrow image holds both the glass and its quiet, fixed watermark. */
export const GLASS_WIDTH=128,GLASS_HEIGHT=144;
export const HOME_MARK_WIDTH=100,HOME_MARK_HEIGHT=72;
export const HOME_MARK_LEVEL=17,HOME_GLASS_GAIN=1.2;
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
let background:Uint8Array|undefined,layer:HTMLCanvasElement|undefined,rest:Surface|undefined;
function brandPixels(){
  if(background)return background;
  const mark=homeBrandCanvas(HOME_MARK_WIDTH,HOME_MARK_HEIGHT,{bold:true,density:.75});
  const pixels=mark.getContext('2d')!.getImageData(0,0,HOME_MARK_WIDTH,HOME_MARK_HEIGHT).data;
  background=new Uint8Array(GLASS_WIDTH*GLASS_HEIGHT);
  const left=(GLASS_WIDTH-HOME_MARK_WIDTH)/2,top=(GLASS_HEIGHT-HOME_MARK_HEIGHT)/2;
  for(let y=0;y<HOME_MARK_HEIGHT;y++)for(let x=0;x<HOME_MARK_WIDTH;x++)if(pixels[(y*HOME_MARK_WIDTH+x)*4+3])background[(y+top)*GLASS_WIDTH+x+left]=HOME_MARK_LEVEL;
  return background;
}
function restingSurface(){return rest??=new Liquid(APERTURE).surface();}
export function apertureSurface(roll=0,pitch=0){
  if(!roll&&!pitch)return restingSurface();const model=new Liquid(APERTURE);model.setPose({roll,pitch},0);model.advance(10000);return model.surface();
}
/** Native pixels: dim watermark, brighter Aperture. Both use actual ordered
 * dithering. The background never swivels or jitters with the glass. */
export function homeGlassGray(roll=0,pitch=0,liquid?:Surface):Uint8Array{
  if(!layer){layer=document.createElement('canvas');layer.width=GLASS_WIDTH;layer.height=GLASS_HEIGHT;}
  // About 130 px tall at rest, with room for the calibrated head-roll range.
  paintVessel(layer,APERTURE,{roll,pitch},liquid??apertureSurface(roll,pitch),{mono:true,compact:true,scale:1.16});
  const glass=layer.getContext('2d')!.getImageData(0,0,GLASS_WIDTH,GLASS_HEIGHT).data,mark=brandPixels();
  const result=new Uint8Array(GLASS_WIDTH*GLASS_HEIGHT);let lit=0;
  const target=102*HOME_GLASS_GAIN,low=Math.floor(target/17)*17,fraction=(target-low)/17;
  for(let y=0;y<GLASS_HEIGHT;y++)for(let x=0;x<GLASS_WIDTH;x++){
    const i=y*GLASS_WIDTH+x,j=i*4,alpha=glass[j+3]/255,coverage=glass[j]/255*alpha;
    const on=coverage>(BAYER[(y%4)*4+x%4]+.5)/16;
    // Mix neighboring native gray levels: mean 122.4 versus the old 102 (+20%).
    // Accumulate across lit pixels so the brightness mix is independent of the coverage dither.
    result[i]=on?low+17*(Math.floor(++lit*fraction)>Math.floor((lit-1)*fraction)?1:0):Math.round(mark[i]*(1-alpha)/17)*17;
  }
  return result;
}
/** Same native composite for QA. No phone animation. */
export function paintGlass(canvas:HTMLCanvasElement,roll=0,pitch=0,dark=false,liquid?:Surface){
  const source=document.createElement('canvas');source.width=GLASS_WIDTH;source.height=GLASS_HEIGHT;const ctx=source.getContext('2d')!,image=ctx.createImageData(GLASS_WIDTH,GLASS_HEIGHT),gray=homeGlassGray(roll,pitch,liquid);
  for(let i=0;i<gray.length;i++){const p=i*4;image.data[p]=image.data[p+1]=image.data[p+2]=dark?39:gray[i];image.data[p+3]=dark?Math.min(255,Math.round(gray[i]/(102*HOME_GLASS_GAIN)*255)):255;}ctx.putImageData(image,0,0);
  const target=canvas.getContext('2d')!;target.clearRect(0,0,canvas.width,canvas.height);target.imageSmoothingEnabled=false;target.drawImage(source,0,0,canvas.width,canvas.height);
}
export function paintPhoneAperture(canvas:HTMLCanvasElement){
  paintVessel(canvas,APERTURE,{roll:0,pitch:0},restingSurface(),{compact:true});
}
