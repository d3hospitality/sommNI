import type {BoundaryRegion} from './globe-model';
import type {Region} from './renderer';
const key=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Administrative context is explicit; a winery cluster is never called an appellation boundary. */
export function regionBoundary(region:Region,boundaries:BoundaryRegion[]){
 const candidates=boundaries.filter(b=>b.country===region.country),name=key(region.name);
 return candidates.find(b=>b.id===region.id||[b.name,...b.name.split(/[()/]/)].some(n=>key(n)===name))??candidates.find(b=>b.clusters.includes(region.id));
}
/** Projected scanline fill preserves polygon holes and stays deterministic at G2 resolution. */
export function regionGlowMask(boundary:BoundaryRegion,size:number,project:(lon:number,lat:number)=>{x:number;y:number;visible:boolean}){
 const mask=new Uint8Array(size*size);
 const rings=boundary.polygons.flatMap(p=>p).map(r=>r.map(p=>project(...p))).filter(r=>r.every(p=>p.visible));
 for(let y=0;y<size;y++){
  const crossings:number[]=[];
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[j],b=ring[i];if((a.y>y+.5)===(b.y>y+.5))continue;
   crossings.push(a.x+(b.x-a.x)*(y+.5-a.y)/(b.y-a.y));
  }
  crossings.sort((a,b)=>a-b);
  for(let k=0;k+1<crossings.length;k+=2)for(let x=Math.max(0,Math.ceil(crossings[k]-.5));x<Math.min(size,crossings[k+1]-.5);x++)mask[y*size+x]=1;
 }
 const fill=mask.slice();
 for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){const i=y*size+x;if(fill[i]&&(!fill[i-1]||!fill[i+1]||!fill[i-size]||!fill[i+size]))mask[i]=2;}
 return mask;
}
export function applyRegionGlow(gray:Uint8Array,mask:Uint8Array,size:number,strength:number){
 const pulse=Math.max(.35,Math.min(1,strength));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*size+x;if(!mask[i])continue;
  // Stable sparse texture; only intensity breathes, avoiding crawling dither noise.
  const level=mask[i]===2?170+51*pulse:((x+y)%3===0?51+68*pulse:17+17*pulse);
  gray[i]=Math.max(gray[i],Math.round(level/17)*17);
 }
}
