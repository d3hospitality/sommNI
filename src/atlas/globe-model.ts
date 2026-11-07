import { maskCanvasLens } from './lens-mask';
import { atlasGlow, type AtlasCoverage } from './coverage';
import { globePoint, wrapLongitude } from './dot-atlas';
import type { GlobeRenderer, Country } from './renderer';
export type Point=[number,number];
export type Polygons=Point[][][];
export interface BoundaryRegion {id:string;name:string;country:string;kind:string;center:Point;bounds:[number,number,number,number];polygons:Polygons;clusters:string[];pointCount:number}
export interface Boundaries {countries:Record<string,Polygons>;regions:BoundaryRegion[]}
export interface Camera {center:Point;zoom:number}
const DEG=Math.PI/180;
export function unproject(x:number,y:number,camera:Camera):Point|null{
 const dx=(x-360)/(280*camera.zoom),dy=(360-y)/(280*camera.zoom),r2=dx*dx+dy*dy;if(r2>1)return null;
 const z=Math.sqrt(1-r2),phi=camera.center[1]*DEG;
 return [wrapLongitude(camera.center[0]+Math.atan2(dx,z*Math.cos(phi)-dy*Math.sin(phi))/DEG),Math.asin(Math.max(-1,Math.min(1,dy*Math.cos(phi)+z*Math.sin(phi))))/DEG];
}
export function insideRegion(point:Point,polygons:Polygons):boolean{
 const ring=(r:Point[])=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [x,y]=r[i],[a,b]=r[j];if((y>point[1])!==(b>point[1])&&point[0]<(a-x)*(point[1]-y)/(b-y)+x)inside=!inside;}return inside;};
 return polygons.some(p=>ring(p[0])&&!p.slice(1).some(ring));
}
export function regionAt(point:Point,regions:BoundaryRegion[]):BoundaryRegion|null{
 return regions.find(r=>point[0]>=r.bounds[0]&&point[0]<=r.bounds[2]&&point[1]>=r.bounds[1]&&point[1]<=r.bounds[3]&&insideRegion(point,r.polygons))??null;
}
export function fitCamera(polygons:Polygons):Camera{
 // Frame the largest land mass, so overseas islands don't flatten the whole globe.
 const outer=polygons.reduce<Point[]>((best,p)=>p[0].length>best.length?p[0]:best,[]);
 if(!outer.length)return {center:[0,0],zoom:1};
 const xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]);
 const center:Point=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
 const extent=Math.max(...outer.map(p=>{const q=globePoint(p[0],p[1],center,1,0);return Math.hypot(q.x,q.y)}));
 return {center,zoom:Math.min(28,Math.max(1,.85/Math.max(.025,extent)))};
}
export class OrbitGlobe {
 private land:{lon:number;lat:number;id:number}[]=[];
 constructor(private geography:GlobeRenderer,private boundaries:Boundaries){
  const count=26000,golden=Math.PI*(3-Math.sqrt(5));for(let i=0;i<count;i++){const lat=Math.asin(1-2*(i+.5)/count)/DEG,lon=wrapLongitude(i*golden/DEG),id=geography.countryAt(lon,lat);if(id)this.land.push({lon,lat,id});}
 }
 draw(canvas:HTMLCanvasElement,camera:Camera,country:Country,region:BoundaryRegion|null,hover:BoundaryRegion|null=null,coverage?:AtlasCoverage,focus?:{name:string;center:Point;points:Point[]}|null){
  const size=720,R=280*camera.zoom;if(canvas.width!==size)canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,size,size);
  const project=(p:Point)=>globePoint(p[0],p[1],camera.center,R,size);
  ctx.save();ctx.beginPath();ctx.rect(0,0,size,size);ctx.clip();
  const light=ctx.createRadialGradient(290,240,0,360,360,R);light.addColorStop(0,'#252620');light.addColorStop(.75,'#121512');light.addColorStop(1,'#070908');ctx.fillStyle=light;ctx.beginPath();ctx.arc(360,360,R,0,2*Math.PI);ctx.fill();
  const trace=(polygons:Polygons,color:string,width:number,fill=false)=>{
   ctx.strokeStyle=color;ctx.lineWidth=width;
   for(const polygon of polygons){
    // Only fill a fully front-facing polygon. Line segments are clipped at the horizon.
    const projected=polygon.map(r=>r.map(project));
    if(fill&&projected.every(r=>r.every(p=>p.depth>.001))){ctx.beginPath();for(const r of projected){r.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}ctx.fillStyle='#e4ae6540';ctx.fill('evenodd');}
    ctx.beginPath();for(const ring of projected){let previous:typeof ring[number]|null=null;for(const p of ring){if(p.depth>.001&&previous&&previous.depth>.001&&Math.hypot(p.x-previous.x,p.y-previous.y)<R*.6){ctx.lineTo(p.x,p.y);}else if(p.depth>.001)ctx.moveTo(p.x,p.y);previous=p;}}ctx.stroke();
   }
  };
  const countryCodes=new Map(this.geography.data.countries.map(c=>[c.id,c.code]));
  const selectedRegions=camera.zoom>1.25?this.boundaries.regions.filter(r=>r.country===country.code):[];
  const dot=(x:number,y:number,id:number,depth:number,point:Point)=>{
   const admin=id===country.id&&selectedRegions.length?regionAt(point,selectedRegions):null;
   const unlocked=!coverage||(admin?coverage.regions.has(admin.id):coverage.countries.has(countryCodes.get(id)??''));
   const count=coverage?(admin?coverage.regionCounts.get(admin.id):coverage.countryCounts.get(countryCodes.get(id)??''))??0:1;
   const glow=atlasGlow(count);
   const stripe=(Math.floor((x+y)/9)%3)===0;
   ctx.fillStyle=unlocked?`rgba(214,186,103,${.25+.3*depth+.4*glow})`:`rgba(139,144,141,${(stripe?.5:.16)+.16*depth})`;
   ctx.beginPath();ctx.arc(x,y,unlocked?1.5+.7*glow:1.35,0,2*Math.PI);ctx.fill();
  };
  if(camera.zoom<1.6){for(const p of this.land){const q=project([p.lon,p.lat]);if(q.depth>.025)dot(q.x,q.y,p.id,q.depth,[p.lon,p.lat]);}}
  else {for(let y=8;y<720;y+=8)for(let x=8;x<720;x+=8){const p=unproject(x,y,camera);if(!p)continue;const id=this.geography.countryAt(...p);if(id)dot(x,y,id,project(p).depth,p);}}
  // Country edges remain subtle; the selected country's outline is crisp.
  for(const [code,polys] of Object.entries(this.boundaries.countries))if(code!==country.code)trace(polys,'#719d8540',.6);
  trace(this.boundaries.countries[country.code]??[],'#e3b48c',1.5);
  if(camera.zoom>1.25)for(const r of this.boundaries.regions)if(r.country===country.code&&r!==region)trace(r.polygons,r===hover?'#f6dec0':'#95b19b70',r===hover?2:0.8);
  if(region)trace(region.polygons,'#ffdf9f',2.6,!coverage||coverage.regions.has(region.id));
  if(focus){const anchor=project(focus.center);if(anchor.depth>.001){const glow=ctx.createRadialGradient(anchor.x,anchor.y,2,anchor.x,anchor.y,32);glow.addColorStop(0,'#ffe8aabb');glow.addColorStop(1,'#e4bc6000');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(anchor.x,anchor.y,32,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffe7a8';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(anchor.x,anchor.y,8,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='#ffe8aa';for(const point of focus.points.slice(0,160)){const p=project(point);if(p.depth>.001){ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();}}}
  ctx.strokeStyle='#78a48c55';ctx.lineWidth=1;ctx.beginPath();ctx.arc(360,360,R,0,2*Math.PI);ctx.stroke();ctx.restore();
  maskCanvasLens(ctx,size,size,Math.min(R,size/2-12));
  canvas.dataset.longitude=camera.center[0].toFixed(3);canvas.dataset.latitude=camera.center[1].toFixed(3);canvas.dataset.zoom=camera.zoom.toFixed(3);canvas.dataset.country=country.code;canvas.dataset.boundary=region?.id??'';canvas.dataset.view='globe';canvas.dataset.wineRegion=focus?.name??'';canvas.dataset.unlockedCountries=String(coverage?.countries.size??0);canvas.dataset.unlockedRegions=String(coverage?.regions.size??0);
  canvas.setAttribute('aria-label',`Interactive 3D globe. ${country.name}${region?', '+region.name:''}. Drag to rotate; select a country, then a region. Arrow keys rotate, plus and minus zoom.`);
 }
}
