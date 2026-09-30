/** Offline, orthographic 3D globe. Inverse projection avoids antimeridian seams
 * and clips the hidden hemisphere before rasterization. No WebGL dependency. */
export interface Country { id: number; code: string; name: string; center: [number, number]; regionCount: number; wineryCount: number }
export interface Region { id: string; name: string; sourceKey: string; country: string; center: [number, number]; radius: number; points: [number, number][]; count: number; geometryKind: 'winery-cluster' }
export interface AtlasData { countries: Country[]; regions: Region[]; provenance: { sourcePointCount: number; excluded: {points: number}[] } }
export interface View { country: Country; region?: Region; center?: [number, number]; radius?: number }
export interface Frame { size: number; gray: Uint8Array; selected: Uint8Array }
const DEG = Math.PI / 180;
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function project(lon: number, lat: number, center: [number,number], radius: number, size: number) {
  const d = (lon-center[0])*DEG, p=lat*DEG, c=center[1]*DEG;
  const z=Math.sin(c)*Math.sin(p)+Math.cos(c)*Math.cos(p)*Math.cos(d);
  return { x:size/2+radius*Math.cos(p)*Math.sin(d), y:size/2-radius*(Math.cos(c)*Math.sin(p)-Math.sin(c)*Math.cos(p)*Math.cos(d)), visible:z>0 };
}
export class GlobeRenderer {
  private constructor(public data: AtlasData, private ids: Uint8Array, private width: number, private height: number) {}
  static async load(baseUrl: string) {
    const [response, image] = await Promise.all([
      fetch(new URL('atlas-data.json',baseUrl)),
      new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Country map unavailable'));i.src=new URL('world-ids.png',baseUrl).href;}),
    ]);
    if(!response.ok) throw new Error(`Atlas data unavailable (${response.status})`);
    const canvas=document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,image.width,image.height).data;
    const ids=new Uint8Array(image.width*image.height);
    for(let i=0;i<ids.length;i++)ids[i]=rgba[i*4];
    return new GlobeRenderer(await response.json(),ids,image.width,image.height);
  }
  countryAt(lon:number,lat:number): number {
    const x=Math.max(0,Math.min(this.width-1,Math.round((((lon+180)%360+360)%360)/360*(this.width-1))));
    const y=Math.max(0,Math.min(this.height-1,Math.round((90-lat)/180*(this.height-1))));
    return this.ids[y*this.width+x];
  }
  render(view: View, size=244): Frame {
    const center=view.center ?? view.region?.center ?? view.country.center;
    const angular=view.radius ?? (view.region ? Math.max(.15,view.region.radius) : 90);
    const scale=(size/2-10)/Math.sin(Math.min(90,angular)*DEG);
    const glasses=size<=288;
    const count=size*size, gray=new Uint8Array(count), selected=new Uint8Array(count);
    const idmap=new Int16Array(count).fill(-1), light=new Float32Array(count), grids=new Uint8Array(count);
    const sinP=Math.sin(center[1]*DEG),cosP=Math.cos(center[1]*DEG);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const dx=(x+.5-size/2)/scale,dy=-(y+.5-size/2)/scale, r2=dx*dx+dy*dy;
      if(r2>=1)continue;
      const z=Math.sqrt(1-r2),lat=Math.asin(dy*cosP+z*sinP)/DEG;
      let lon=center[0]+Math.atan2(dx,z*cosP-dy*sinP)/DEG;lon=((lon+540)%360)-180;
      const i=y*size+x,id=this.countryAt(lon,lat);idmap[i]=id;selected[i]=Number(id===view.country.id);
      light[i]=.52+.48*Math.max(0,z*.87-dx*.3+dy*.25);
      const step=angular<.5?.1:angular<2?.5:angular<5?1:angular<20?5:30, tolerance=angular/size*.27;
      if(Math.abs(lon/step-Math.round(lon/step))*step<tolerance || Math.abs(lat/step-Math.round(lat/step))*step<tolerance)grids[i]=1;
    }
    const edge=new Uint8Array(count);
    for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++) {
      const i=y*size+x, id=idmap[i];if(id<0)continue;
      const near=[idmap[i-1],idmap[i+1],idmap[i-size],idmap[i+size]];
      if(near.some(n=>n!==id))edge[i]=selected[i] || near.includes(view.country.id) ? 2 : 1;
    }
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const i=y*size+x;if(idmap[i]<0)continue;
      let v=idmap[i] ? (selected[i]&&!view.region?(glasses?55:105):(glasses?10:29))*light[i] : 0;
      if(grids[i])v=Math.max(v,18);
      if(edge[i])v=edge[i]===2&&!view.region?(glasses?136:170):(glasses?34:73)*light[i];
      // A restrained one-pixel halo. Peak stays below full green/white.
      if(!edge[i] && ((x && edge[i-1]===2)||(x<size-1&&edge[i+1]===2)||(y&&edge[i-size]===2)||(y<size-1&&edge[i+size]===2)))v=Math.max(v,45);
      const d=(BAYER[(y%4)*4+x%4]+.5)/16;
      const quantum=glasses&&!edge[i]?51:17;
      gray[i]=Math.min(204,Math.max(0,Math.floor(v/quantum+d)*quantum));
    }
    const mark=(px:number,py:number,level:number)=>{if(px>=0&&px<size&&py>=0&&py<size)gray[py*size+px]=level;};
    if(view.region) {
      for(const [lon,lat] of view.region.points) {
        const p=project(lon,lat,center,scale,size);if(!p.visible)continue;
        const x=Math.round(p.x),y=Math.round(p.y);mark(x,y,204);mark(x+1,y,85);mark(x-1,y,85);mark(x,y+1,85);mark(x,y-1,85);
        if(size>300){mark(x+1,y,119);mark(x,y+1,119);}
      }
      // Locator brackets identify the computed cluster center, not an appellation boundary.
      const p=project(view.region.center[0],view.region.center[1],center,scale,size);
      if(p.visible){const x=Math.round(p.x),y=Math.round(p.y);for(let t=-4;t<=4;t++){if(Math.abs(t)>1){mark(x+t,y,153);mark(x,y+t,153);}}}
    } else if(!selected.some(Boolean)) {
      // At global scale microstates may be below one pixel: retain a visible locator.
      const p=project(view.country.center[0],view.country.center[1],center,scale,size);
      if(p.visible){const x=Math.round(p.x),y=Math.round(p.y);for(let t=-2;t<=2;t++){mark(x+t,y-3,170);mark(x+t,y+3,170);mark(x-3,y+t,170);mark(x+3,y+t,170);}}
    }
    return {size,gray,selected};
  }
}
export function paintFrame(canvas:HTMLCanvasElement, frame:Frame, mode:'green'|'atelier'|'gray'='green') {
  canvas.width=frame.size;canvas.height=frame.size;
  const ctx=canvas.getContext('2d')!,data=ctx.createImageData(frame.size,frame.size);
  for(let i=0;i<frame.gray.length;i++) {
    const v=frame.gray[i],o=i*4;
    if(mode==='gray'){data.data[o]=data.data[o+1]=data.data[o+2]=v;}
    else if(mode==='green'){data.data[o]=Math.round(v*.23);data.data[o+1]=v;data.data[o+2]=Math.round(v*.29);}
    else {const c=frame.selected[i]?[246,176,144]:[210,218,197];data.data[o]=13+v*c[0]/255;data.data[o+1]=23+v*c[1]/255;data.data[o+2]=21+v*c[2]/255;}
    data.data[o+3]=255;
  }
  ctx.putImageData(data,0,0);
}
