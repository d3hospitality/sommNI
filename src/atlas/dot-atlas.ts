/** Original sommNI point-field renderer. Geographic lookup only is shared with the
 * atlas data loader. No map tiles, borrowed artwork, or existing atlas pixels are drawn.
 * Land dots are geographic samples; winery points retain their separate provenance. */
import type { Country, GlobeRenderer, Region } from './renderer';

export type DotView = 'globe' | 'map';
export interface DotSelection { country: Country; region: Region | null; label: string }
interface LandPoint { lon: number; lat: number; country: number }
const DEG = Math.PI / 180;
export const wrapLongitude = (lon: number) => ((lon + 540) % 360) - 180;
export function globePoint(lon: number, lat: number, center: [number, number], radius: number, size: number) {
  const delta = wrapLongitude(lon - center[0]) * DEG, phi = lat * DEG, origin = center[1] * DEG;
  const depth = Math.sin(origin) * Math.sin(phi) + Math.cos(origin) * Math.cos(phi) * Math.cos(delta);
  return {x: size / 2 + radius * Math.cos(phi) * Math.sin(delta), y: size / 2 - radius * (Math.cos(origin) * Math.sin(phi) - Math.sin(origin) * Math.cos(phi) * Math.cos(delta)), depth};
}

export class DotAtlas {
  private land: LandPoint[] = [];
  constructor(private geography: GlobeRenderer) {
    // Fibonacci sphere: near-uniform surface spacing without polar stripes.
    const count = 26000, golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const lat = Math.asin(1 - 2 * (i + .5) / count) / DEG;
      const lon = wrapLongitude(i * golden / DEG);
      const country = geography.countryAt(lon,lat);
      if (country > 0) this.land.push({lon,lat,country});
    }
  }
  draw(canvas: HTMLCanvasElement, selection: DotSelection, view: DotView, rotation = 0, compact = false): void {
    const size = compact ? 288 : 720;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0,0,size,size);
    const factor = size / 720;
    ctx.save(); ctx.scale(factor,factor);
    const S = 720, R = 280;
    const center: [number, number] = [...(selection.region?.center ?? selection.country.center)];
    center[0] = wrapLongitude(center[0] + rotation);
    const seed = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    // Sparse decorative stars are outside the land geometry, with no geographic meaning.
    if (!compact) for (let i=0;i<54;i++) {
      const x=seed(i+1)*S,y=seed(i+91)*S;
      ctx.fillStyle=`rgba(184,203,191,${.11+seed(i+201)*.16})`;
      ctx.beginPath();ctx.arc(x,y,i%9===0?1.2:.65,0,Math.PI*2);ctx.fill();
    }
    if (view === 'globe') {
      const halo = ctx.createRadialGradient(360,360,210,360,360,325);
      halo.addColorStop(0,'rgba(95,139,128,0)');halo.addColorStop(.65,'rgba(95,139,128,.035)');halo.addColorStop(1,'rgba(95,139,128,0)');
      ctx.fillStyle=halo;ctx.fillRect(0,0,S,S);
      // An interrupted orbital guide, never country borders.
      if (!compact) {ctx.strokeStyle='#657d7133';ctx.lineWidth=.7;ctx.setLineDash([1,9]);ctx.beginPath();ctx.ellipse(360,360,R+25,R+25,-.4,.08,5.9);ctx.stroke();ctx.setLineDash([]);}
      for (const dot of this.land) {
        const p = globePoint(dot.lon,dot.lat,center,R,S);
        if (p.depth <= .035) continue;
        const own = dot.country === selection.country.id;
        const alpha = (own ? .8 : .28) * (.3 + .7 * p.depth);
        ctx.fillStyle = compact ? `rgba(96,220,108,${own?.8:.35})` : own ? `rgba(235,174,132,${alpha})` : `rgba(151,179,165,${alpha})`;
        ctx.beginPath();ctx.arc(p.x,p.y,(own?1.85:1.35)*(.6+.4*p.depth),0,Math.PI*2);ctx.fill();
      }
      // Micro countries can be smaller than the sampling interval: their regional
      // locator remains present, without claiming additional country geometry.
      const origin = selection.region?.center ?? selection.country.center;
      const anchor = globePoint(origin[0],origin[1],center,R,S);
      if (anchor.depth > .05) this.locator(ctx,anchor.x,anchor.y,selection,compact);
      if (!compact) this.caption(ctx,selection.region ? 'REGION LOCATOR' : 'COUNTRY LOCATOR',rotation ? 'Turn back to the wine to recenter.' : 'A place in a world of wine.');
    } else {
      // Keep country context visible. A separate inset expands the actual source
      // points; a cluster radius is not the geographic extent of a wine region.
      const nearby = this.land.filter(p => p.country === selection.country.id && Math.abs(wrapLongitude(p.lon-selection.country.center[0])) < 45 && Math.abs(p.lat-selection.country.center[1]) < 45);
      const cosOrigin = Math.max(.2,Math.cos(center[1]*DEG));
      const span = Math.max(2, ...nearby.map(p => Math.max(Math.abs(wrapLongitude(p.lon-center[0]))*cosOrigin,Math.abs(p.lat-center[1]))))*1.05;
      // Local equirectangular view with longitude corrected for latitude.
      const cos = Math.max(.2,Math.cos(center[1]*DEG));
      const mapPoint = (lon:number,lat:number) => ({x:360+wrapLongitude(lon-center[0])*cos/span*270,y:360-(lat-center[1])/span*270});
      // Sample at screen-dot spacing: local zoom stays detailed without raster magnification.
      for (let y=70;y<650;y+=9) for(let x=60;x<660;x+=9) {
        const lon=wrapLongitude(center[0]+(x-360)/270*span/cos),lat=center[1]-(y-360)/270*span;
        if (lat < -90 || lat > 90) continue;
        const country=this.geography.countryAt(lon,lat); if(country<=0)continue;
        const edge=Math.min(x-50,670-x,y-60,660-y)/60;
        ctx.fillStyle=country===selection.country.id?`rgba(235,174,132,${Math.min(.65,edge*.65)})`:'#79978933';
        ctx.beginPath();ctx.arc(x,y,1.4,0,Math.PI*2);ctx.fill();
      }
      if(selection.region) for(const [lon,lat] of selection.region.points) {
        const p=mapPoint(lon,lat);if(p.x<35||p.x>685||p.y<35||p.y>685)continue;
        ctx.fillStyle=compact?'#82dd86':'#e9b68b';ctx.beginPath();ctx.arc(p.x,p.y,compact?3.5:3,0,Math.PI*2);ctx.fill();
      }
      this.locator(ctx,360,360,selection,compact);
      if (!compact && selection.region?.points.length) {
        const points = selection.region.points, focus = selection.region.center;
        const dx = points.map(p=>wrapLongitude(p[0]-focus[0])*cos),dy=points.map(p=>p[1]-focus[1]);
        const extent=Math.max(.0001,...dx.map(Math.abs),...dy.map(Math.abs));
        const cx=555,cy=535,r=75;
        ctx.fillStyle='#0b1714';ctx.strokeStyle='#6a827866';ctx.lineWidth=.8;
        ctx.beginPath();ctx.arc(cx,cy,r+8,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle='#dec3a366';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(374,374);ctx.lineTo(cx-62,cy-62);ctx.stroke();ctx.setLineDash([]);
        // Fit both dimensions into the circular inset, including diagonal points.
        const scale=r*.62/extent;
        points.forEach((_,i)=>{ctx.fillStyle='#f3c7a1';ctx.beginPath();ctx.arc(cx+dx[i]*scale,cy-dy[i]*scale,3,0,Math.PI*2);ctx.fill();});
        ctx.textAlign='center';ctx.fillStyle='#b9c6b8';ctx.font='9px "Space Grotesk",sans-serif';ctx.fillText('LOCAL POINT DETAIL',cx,cy+r+25);ctx.textAlign='left';
      }
      if(!compact) this.caption(ctx,selection.region?'RECORDED WINERY LOCATIONS':'COUNTRY CONTEXT',selection.region?`${selection.region.points.length} source points · inset enlarged · not a boundary`:'No linked winery cluster for this wine.');
    }
    ctx.restore();
    canvas.dataset.view = view;
    canvas.dataset.region = selection.region?.name ?? '';
    canvas.dataset.pointCount = String(selection.region?.points.length ?? 0);
    canvas.setAttribute('aria-label',`${view==='globe'?'Dotted globe':'Dotted map'}: ${selection.label}, ${selection.country.name}. ${selection.region?'Region locator from recorded winery locations, not an appellation boundaries map.':'Country locator only; region is not mapped.'}`);
  }
  private locator(ctx: CanvasRenderingContext2D,x:number,y:number,selection:DotSelection,compact:boolean):void {
    const color=compact?'#a5ffa4':'#f3c7a1';
    ctx.strokeStyle=color;ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();
    if(compact)return;
    // Label stays in the left hemisphere, away from the bottle and detail plane.
    const left=x>310, endX=left?Math.max(90,x-135):Math.min(550,x+105),endY=Math.max(165,y-90);
    ctx.strokeStyle='#e6ba9299';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(x,y-15);ctx.lineTo(x,endY);ctx.lineTo(endX,endY);ctx.stroke();
    ctx.textAlign=left?'right':'left';ctx.font='500 17px "Space Grotesk",sans-serif';ctx.fillStyle='#f4dec7';
    const words=selection.label.split(' ');let line='',row=0;
    for(const word of words){if(ctx.measureText(`${line} ${word}`).width>185&&line){ctx.fillText(line,endX,endY-25+row*20);row++;line=word;}else line+=(line?' ':'')+word;}
    ctx.fillText(line,endX,endY-25+row*20);
    ctx.font='10px "Space Grotesk",sans-serif';ctx.fillStyle='#bcc9b9';ctx.fillText(selection.region?'REGION FOCUS':'COUNTRY ONLY',endX,endY+18+row*20);ctx.textAlign='left';
  }
  private caption(ctx:CanvasRenderingContext2D,title:string,detail:string):void {
    ctx.textAlign='center';ctx.fillStyle='#b9c6b8';ctx.font='9px "Space Grotesk",sans-serif';ctx.fillText(title,360,662);
    ctx.fillStyle='#85998b';ctx.font='10px "Space Grotesk",sans-serif';ctx.fillText(detail,360,682);ctx.textAlign='left';
  }
}
