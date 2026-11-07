import {maskCanvasLens} from './atlas/lens-mask';
import {loadAtlasRenderer} from './atlas-app';
import {collectiveCoverage,loadBoundaries} from './atlas/coverage';
import {collectiveSnapshot} from './community/atlas-state';
import type {BoundaryRegion} from './atlas/globe-model';
import {globePoint} from './atlas/dot-atlas';

/** Tiny geographic status icon; shares atlas data, renders only while visible. */
export function initHomeGlobe(){
 const button=document.querySelector<HTMLButtonElement>('#home-region-globe');
 const canvas=button?.querySelector('canvas');if(!button||!canvas)return;
 const ctx=canvas.getContext('2d');if(!ctx)return;
 button.addEventListener('click',()=>window.dispatchEvent(new Event('winelens-open-browser-atlas')));
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let visible=false,frame=0,last=0,longitude=12,loading=false;
 let draw:((time:number)=>void)|null=null;
 const schedule=()=>{if(visible&&!document.hidden&&!frame&&draw)frame=requestAnimationFrame(draw);};
 const init=async()=>{
  if(loading||draw)return;loading=true;
  try{
   const [renderer,boundaries]=await Promise.all([loadAtlasRenderer(),loadBoundaries()]);
   const land:[number,number][]=[];const count=2400,golden=Math.PI*(3-Math.sqrt(5));
   for(let i=0;i<count;i++){const lat=Math.asin(1-2*(i+.5)/count)*180/Math.PI,lon=((i*golden*180/Math.PI+180)%360)-180;if(renderer.countryAt(lon,lat))land.push([lon,lat]);}
   let pins:BoundaryRegion[]=[];
   const update=()=>{const coverage=collectiveCoverage(renderer.data,boundaries,collectiveSnapshot());pins=boundaries.regions.filter(r=>coverage.regions.has(r.id));button.setAttribute('aria-label',`Open Atlas · ${pins.length} wine regions lit`);last=0;schedule();};
   draw=time=>{
    frame=0;if(!visible||document.hidden)return;
    if(!last||time-last>=100){
     if(last&&!reduced.matches)longitude+=(Math.min(time-last,200)/1000)*4;
     last=time;ctx.clearRect(0,0,144,144);
     ctx.strokeStyle='#d8b65355';ctx.lineWidth=1;ctx.beginPath();ctx.arc(72,72,62,0,Math.PI*2);ctx.stroke();
     const project=(p:[number,number])=>globePoint(p[0],p[1],[longitude,20],62,144);
     for(const p of land){const q=project(p);if(q.depth<=0)continue;ctx.fillStyle=`rgba(178,174,146,${.18+.48*q.depth})`;ctx.fillRect(q.x,q.y,1.3,1.3);}
     for(const r of pins){const q=project(r.center);if(q.depth<=.05)continue;ctx.fillStyle='#e8bb4b25';ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f1cd69';ctx.beginPath();ctx.arc(q.x,q.y,1.7,0,Math.PI*2);ctx.fill();}
     maskCanvasLens(ctx,144,144,62);
    }
    if(!reduced.matches)schedule();
   };
   window.addEventListener('sommni-atlas-snapshot',update);window.addEventListener('sommni-catalog-updated',update);update();schedule();
  }catch{loading=false;button.title='Open Atlas';}
 };
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){last=0;void init();schedule();}else if(frame){cancelAnimationFrame(frame);frame=0;}},{threshold:.1}).observe(button);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else{last=0;schedule();}});
 reduced.addEventListener('change',()=>{last=0;schedule();});
}
