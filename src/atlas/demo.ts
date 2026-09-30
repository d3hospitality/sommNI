import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { GlobeRenderer, paintFrame } from './renderer';
import { AtlasNavigator } from './navigator';
import { AtlasGlasses, atlasTexts } from './glasses';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const country=$<HTMLSelectElement>('country'),region=$<HTMLSelectElement>('region');
let glasses:AtlasGlasses|undefined;
function error(e:unknown){$('error').hidden=false;$('error').textContent=String(e instanceof Error?e.message:e);console.error('[Atlas]',e);}
async function main(){
  const renderer=await GlobeRenderer.load(new URL('./atlas/',location.href).href);
  const nav=new AtlasNavigator(renderer.data);
  country.replaceChildren(...nav.countries.map(c=>new Option(c.name,c.code)));country.disabled=false;
  const query=new URLSearchParams(location.search);if(query.has('country'))nav.chooseCountry(query.get('country')!);
  if(query.has('region')){const r=nav.regions.find(r=>r.name.toLowerCase()===query.get('region')!.toLowerCase());if(r)nav.chooseRegion(r.id);}
  let lastCountry='';
  let camera:{center:[number,number];radius:number}|undefined;
  let animation=0;
  function animateEarth(){
    const view=nav.view, target={center:view.region?.center??view.country.center,radius:view.radius??90};
    cancelAnimationFrame(animation);
    if(!camera||matchMedia('(prefers-reduced-motion: reduce)').matches){camera=target;paintFrame($<HTMLCanvasElement>('earth'),renderer.render({...view,...camera},560),'atelier');return;}
    const start={...camera},startTime=performance.now();
    const lonDelta=((target.center[0]-start.center[0]+540)%360)-180;
    function step(now:number){
      const t=Math.min(1,(now-startTime)/420),ease=1-Math.pow(1-t,3);
      camera={center:[start.center[0]+lonDelta*ease,start.center[1]+(target.center[1]-start.center[1])*ease],radius:Math.exp(Math.log(start.radius)+(Math.log(target.radius)-Math.log(start.radius))*ease)};
      paintFrame($<HTMLCanvasElement>('earth'),renderer.render({...view,...camera},560),'atelier');
      if(t<1)animation=requestAnimationFrame(step);
    }
    animation=requestAnimationFrame(step);
  }
  function render(){
    const countryChanged=lastCountry!==nav.country.code;lastCountry=nav.country.code;
    country.value=nav.country.code;
    if(countryChanged)region.replaceChildren(new Option('Select a region…',''),...nav.regions.map(r=>new Option(`${r.name} · ${r.count}`,r.id)));
    region.disabled=!nav.regions.length;region.value=nav.mode==='countries'?'':nav.region?.id??'';
    $('place-name').textContent=nav.mode==='countries'?nav.country.name:nav.region?.name??nav.country.name;
    $('level-label').textContent=nav.mode==='countries'?'COUNTRY IN FOCUS':nav.mode==='regions'?'REGION EXPLORER':'REGION IN FOCUS';
    $('breadcrumb').textContent=nav.mode==='countries'?`WORLD / ${nav.country.name.toUpperCase()}`:`${nav.country.name.toUpperCase()} / WINE REGIONS`;
    const center=nav.view.region?.center??nav.country.center;
    $('coordinates').textContent=`${Math.abs(center[1]).toFixed(1)}° ${center[1]>=0?'N':'S'} · ${Math.abs(center[0]).toFixed(1)}° ${center[0]>=0?'E':'W'}`;
    $('coverage').textContent=nav.mode==='countries'?`${nav.country.regionCount} source regions · ${nav.country.wineryCount.toLocaleString()} mapped wineries`:`${nav.region?.count.toLocaleString()} winery locations in source`;
    $('geometry').textContent=nav.mode==='countries'?'Country outline':'Winery cluster · not a boundary';
    $('region-note').textContent=nav.mode==='countries'?'Scroll through countries to turn the globe. Tap to explore their wine regions.':'Regional views use winerymap location clusters. Their center and extent are calculated from the source points.';
    $<HTMLButtonElement>('back').disabled=nav.mode==='countries';
    $('explore').textContent=nav.mode==='countries'?'Explore regions ↗':nav.mode==='regions'?'Focus region ↗':'Back to regions ↖';
    $<HTMLButtonElement>('explore').disabled=false;
    $('select').textContent=nav.mode==='detail'?'Back to regions':'Tap to select';
    $<HTMLButtonElement>('previous').disabled=nav.mode==='detail'||nav.index===0;
    $<HTMLButtonElement>('next').disabled=nav.mode==='detail'||nav.index===nav.labels.length-1;
    animateEarth();
    const gc=$<HTMLCanvasElement>('glasses'),ctx=gc.getContext('2d')!;
    ctx.fillStyle='#030a05';ctx.fillRect(0,0,576,288);ctx.fillStyle='#61be72';ctx.font='19px Arial';
    const texts=atlasTexts(nav);ctx.fillText(texts.title,12,34,300);
    texts.rows.split('\n').forEach((line,i)=>{ctx.fillStyle=line.startsWith('>')?'#a6e9ad':'#61be72';ctx.fillText(line,12,77+i*28,302);});
    ctx.fillStyle='#61be72';ctx.font='14px Arial';ctx.fillText(texts.hint,12,271,302);
    const sphere=document.createElement('canvas');paintFrame(sphere,renderer.render(nav.view,244),'green');ctx.drawImage(sphere,324,20);
    // Developer inspection is explicit and read-only; no credentials or account state.
    Object.assign(window,{atlasPreview:{renderer,navigator:nav,render}});
  }
  const change=(fn:()=>void)=>{fn();render();glasses?.refresh();};
  country.onchange=()=>change(()=>nav.chooseCountry(country.value));
  region.onchange=()=>change(()=>nav.chooseRegion(region.value));
  $('previous').onclick=()=>change(()=>nav.scroll(-1));$('next').onclick=()=>change(()=>nav.scroll(1));
  $('select').onclick=()=>change(()=>nav.mode==='detail'?nav.back():nav.select());
  $('explore').onclick=()=>change(()=>nav.mode==='detail'?nav.back():nav.select());$('back').onclick=()=>change(()=>nav.back());
  document.addEventListener('keydown',e=>{
    if(e.target instanceof HTMLSelectElement||e.target instanceof HTMLInputElement)return;
    const action=e.key==='ArrowDown'?()=>nav.scroll(1):e.key==='ArrowUp'?()=>nav.scroll(-1):e.key==='Enter'?()=>nav.select():e.key==='Escape'?()=>nav.back():null;
    if(action){e.preventDefault();change(action);}
  });
  render();console.info('[Atlas] READY',renderer.data.countries.length,'country/territory shapes',renderer.data.regions.length,'region clusters');
  // This promise stays pending in an ordinary browser. Only the Even host supplies
  // a working bridge; desktop preview must never claim a hardware connection.
  const host = window as unknown as {flutter_inappwebview?: {callHandler?: unknown}};
  if (typeof host.flutter_inappwebview?.callHandler !== 'function') return;
  void waitForEvenAppBridge().then(async bridge=>{
    glasses=new AtlasGlasses(bridge,nav,renderer,render,error);
    await glasses.open(true);bridge.onEvenHubEvent(e=>glasses?.handle(e));
    $('connection').textContent='Even Hub bridge active';console.info('[Atlas] G2_READY');
  }).catch(error);
}
void main().catch(error);
