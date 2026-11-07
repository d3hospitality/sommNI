import {wineOrigin} from './wine-origin';
import {resolveWineFocus,blendWineCamera} from './atlas/wine-focus';
import { catalogPhoto, lookupWineById, type CatalogWine } from './identity';
import type { LibraryWine } from './winebrary';
import { loadBoundaries } from './atlas/coverage';
import { OrbitGlobe, type Camera } from './atlas/globe-model';
import './wine-context.css';

export const escapeWine = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export interface WineContext { title: string; country: string; state?:string|null; region?: string | null; grape?: string; style?:string; sake?:boolean; vintage?:string; photo?: string | null; catalogId?: string; libraryId?: string }
export function libraryPhoto(w: LibraryWine): string | null {
  return w.image_url || catalogPhoto(w.wine_id, new URL('./', location.href).href);
}
export function catalogContext(w: CatalogWine): WineContext {
  return {title:w.wine.name,country:w.country,region:w.wine.region,grape:w.wine.grape,style:w.type==='Sake'?w.wine.style:w.type,sake:w.type==='Sake',vintage:w.vintages?.join(', '),photo:catalogPhoto(w.id,new URL('./',location.href).href),catalogId:w.id};
}
export function libraryContext(w: LibraryWine): WineContext {
  const twin=lookupWineById(w.wine_id);
  return {title:[w.wine_name,w.producer].filter(Boolean).join(' · '),country:w.metadata?.country||twin?.country||'',state:w.metadata?.state,region:w.region||twin?.wine.region,grape:w.metadata?.rice_variety||w.metadata?.grape||twin?.wine.grape,style:w.metadata?.color==='Sake'?[w.metadata?.sake_classification,w.metadata?.sake_style].filter(Boolean).join(' · '):w.metadata?.color,sake:w.metadata?.color==='Sake',vintage:w.vintage?String(w.vintage):w.metadata?.vintage_state==='non_vintage'?'NV':undefined,photo:libraryPhoto(w),libraryId:w.id};
}
let current:WineContext|null=null;
export function glassesContext(){return current;}
export function announceWineContext(context:WineContext|null){current=context;window.dispatchEvent(new CustomEvent('sommni-glasses-context',{detail:context}));}
export function announceCatalogWine(id:string|null){const wine=lookupWineById(id);if(wine)announceWineContext(catalogContext(wine));}

export function wineThumbnail(photo:string|null|undefined,title:string):string {
  return photo?`<img class="wine-thumb" src="${escapeWine(photo)}" alt="${escapeWine(title)} bottle" loading="lazy" decoding="async">`:'<span class="wine-photo-missing">Photo pending</span>';
}
export function watchWinePhotos(root:HTMLElement){
  root.querySelectorAll<HTMLImageElement>('.wine-thumb').forEach(img=>{
    const failed=()=>{const label=document.createElement('span');label.className='wine-photo-missing';label.textContent='Photo unavailable';img.replaceWith(label);};
    img.addEventListener('error',failed,{once:true});if(img.complete&&!img.naturalWidth)failed();
  });
}

let mapResources:Promise<{geography:Awaited<ReturnType<typeof import('./atlas-app')['loadAtlasRenderer']>>;boundaries:Awaited<ReturnType<typeof loadBoundaries>>;model:OrbitGlobe}>|null=null;
function contextMap(){return mapResources??=Promise.all([import('./atlas-app'),loadBoundaries()]).then(async([api,boundaries])=>{const geography=await api.loadAtlasRenderer();return {geography,boundaries,model:new OrbitGlobe(geography,boundaries)};}).catch(error=>{mapResources=null;throw error;});}

/** A phone-only photo and geographic context. No images are sent to the glasses. */
export function mountWineContext(root:HTMLElement){
  let revision=0,animation=0;let lastCamera:Camera|null=null;
  let lastKey='';
  root.classList.add('wine-context');
  return async(context:WineContext)=>{
    const key=JSON.stringify(context);if(key===lastKey)return;lastKey=key;
    const ticket=++revision,esc=escapeWine;if(animation)cancelAnimationFrame(animation);
    root.innerHTML=`<div class="wine-context-scene"><canvas aria-label="Wine origin globe"></canvas><div class="wine-context-bottle">${context.photo?wineThumbnail(context.photo,context.title):''}</div></div><div class="wine-context-copy"><p class="wl-kicker">${esc(context.country||'ORIGIN TO CONFIRM')}</p><h3>${esc(context.title)}</h3><p>${esc([...wineOrigin(context.country,context.region,context.state).path.slice(1),context.grape].filter(Boolean).join(' · '))}</p><small class="wine-context-map-status">Locating this wine’s origin…</small>${context.catalogId?`<button class="wl-text-button" data-wine-notes="${esc(context.catalogId)}">Tasting notes ↗</button>`:''}</div>`;
    watchWinePhotos(root);
    try{
      const {geography,boundaries,model}=await contextMap();if(ticket!==revision||!root.isConnected)return;
      const focus=resolveWineFocus(geography.data,boundaries,{country:context.country,region:context.region,state:context.state});
      const status=root.querySelector('.wine-context-map-status')!;
      if(!focus){status.textContent='Origin not mapped yet. Wine details remain available.';return;}
      const canvas=root.querySelector('canvas')!,from=lastCamera||focus.camera,started=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let painted=-Infinity;
      const paint=(time:number)=>{animation=0;if(ticket!==revision||!root.isConnected)return;const progress=reduced?1:Math.min(1,(time-started)/420);if(time-painted>=50||progress===1){lastCamera=blendWineCamera(from,focus.camera,progress);model.draw(canvas,lastCamera,focus.country,focus.boundary,null,undefined,focus.cluster);painted=time;}if(progress<1)animation=requestAnimationFrame(paint);};
      paint(started);

      root.querySelector('canvas')!.setAttribute('aria-label',focus.path.join(' → ')+' origin map');
      status.textContent=focus.path.join(' › ')+(focus.cluster?' · winery-area glow, not an appellation boundary':focus.boundary?' · administrative context':' · country view; precise region not mapped');
    }catch{if(ticket===revision)root.querySelector('.wine-context-map-status')!.textContent='Map unavailable. Bottle and notes are still available.';}
  };
}

export function initGlassesContext(){
  const host=document.querySelector('main');if(!host)return;
  const panel=document.createElement('details');panel.className='glasses-context-panel';panel.hidden=true;panel.open=true;
  panel.innerHTML='<summary>On your glasses <span>Wine & origin</span></summary><div></div>';host.prepend(panel);
  const render=mountWineContext(panel.querySelector('div')!);
  window.addEventListener('sommni-glasses-context',()=>{panel.hidden=!current;if(current)void render(current);});
  window.addEventListener('winelens-glasses-home',()=>announceWineContext(null));
}
