import { attachPlaceWheel } from './place-wheel';
import { attachBottleSwipe } from './bottle-swipe';
import { collectiveSnapshot, refreshCollectiveAtlas } from '../community/atlas-state';
import { bottleRowHead, bottleRowCells } from '../bottle-rows';
import { prefectureKey } from '../sake';
import { catalogContext, libraryContext, glassesContext, wineThumbnail, watchWinePhotos, type WineContext } from '../wine-context';
import { normalizePlace, placeSearchScore } from './place-search';
import { wineRegionContexts, wineRegionById, wineRegionFor } from './wine-regions';
import { getLocale } from '../intelligence/client';
import { atlasCountryFor } from '../atlas-app';
import { openPlaceInsight } from './insights';
import { allCatalogWines, type CatalogWine } from '../identity';
import { storyCards, STORY_SOURCES } from '../history/content';
import links from '../data/atlas-region-links.json';
import type { GlobeRenderer, Country } from './renderer';
import type { DotSelection } from './dot-atlas';
import { wrapLongitude } from './dot-atlas';
import { OrbitGlobe, unproject, regionAt, fitCamera, type Boundaries, type BoundaryRegion, type Camera, type Point } from './globe-model';
import './browser-explorer.css';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
import { regionalCatalog, loadBoundaries, winebraryCoverage, collectiveCoverage } from './coverage';
import { readLibrary } from '../winebrary-glasses';
import { OrbitMotion } from './orbit-motion';
export async function createBrowserAtlas(dialog:HTMLElement,geography:GlobeRenderer,initial:DotSelection){
 const boundaries=await loadBoundaries(),model=new OrbitGlobe(geography,boundaries),motion=new OrbitMotion();
 const modal=dialog instanceof HTMLDialogElement?dialog:null;let inView=!!modal;
 const isOpen=()=>modal?modal.open:inView&&!document.querySelector('dialog[open]');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let coverage=collectiveCoverage(geography.data,boundaries,collectiveSnapshot());
 void refreshCollectiveAtlas();
 let country=initial.country,region:BoundaryRegion|null=null,camera:Camera={center:[...country.center],zoom:1},hover:BoundaryRegion|null=null,frame=0,painted=0;
 let selectedAppellation='';
 let catalog=allCatalogWines();
 const coverageByWine=()=>new Map(catalog.map(w=>[w.id,winebraryCoverage(geography.data,boundaries,[{id:w.id,wine_id:w.id,wine_name:w.wine.name,producer:null,vintage:null,notes:null,region:w.wine.region,metadata:{country:w.country}}]).regions]));
 let catalogRegions=coverageByWine();
 dialog.innerHTML=`<div class="depth-dialog-top"><div><p class="wl-kicker">SOMMNI / THE LIVING ATLAS</p><h2 id="dot-title">Wine Atlas</h2></div><button id="dot-close" type="button" aria-label="Close dot atlas">×</button></div><details class="orbit-place-search"><summary>Search countries & regions</summary><div class="orbit-search"><label for="orbit-search-input">Search countries & regions</label><div class="orbit-search-row"><input id="orbit-search-input" type="search" placeholder="Try Bordeaux, Burgundy, Bourgogne…" autocomplete="off" aria-controls="orbit-search-results"><button type="button" id="orbit-voice" aria-label="Search places by voice">Voice search</button><button type="button" data-browse-notes>Search wines ↗</button></div><div id="orbit-search-results" aria-label="Place search results" hidden></div><p id="orbit-search-status" role="status"></p></div></details><div class="orbit-layout"><div class="orbit-stage"><div class="orbit-map"><canvas id="dot-explorer" width="720" height="720" tabindex="0" role="img" aria-describedby="orbit-help"></canvas><button class="orbit-stage-bottle" id="orbit-bottle" type="button" aria-label="Open wine tasting notes" hidden></button></div><div class="orbit-bottle-dock"><div id="orbit-bottle-nav" class="orbit-bottle-nav" hidden><button type="button" id="orbit-bottle-prev" aria-label="Previous wine">←</button><div><p id="orbit-selected-wine" aria-live="polite"></p><span id="orbit-bottle-count"></span></div><button type="button" id="orbit-bottle-next" aria-label="Next wine">→</button></div></div><p id="orbit-bottle-help" hidden>Swipe bottle · tap for notes · drag globe</p><p id="orbit-help">Drag to turn · tap a country · pinch to zoom</p><div class="orbit-primary-tools"><button id="orbit-spin" aria-pressed="false">Spin</button><button id="orbit-world">World view</button><details class="orbit-map-options"><summary>Map options</summary><div class="orbit-tools" role="group" aria-label="Globe controls"><button id="dot-west" aria-label="Turn globe west">←</button><button id="dot-east" aria-label="Turn globe east">→</button><button id="orbit-plus" aria-label="Zoom in">＋</button><button id="orbit-minus" aria-label="Zoom out">−</button></div></details></div><div class="atlas-legend"><span><i class="owned"></i>Shared master catalog</span><span><i class="unexplored"></i>No shared wine yet · history open</span></div><div class="orbit-path" id="orbit-path"></div><p id="dot-status" role="status"></p></div><aside class="orbit-details"><p class="wl-kicker">CHOOSE A PLACE</p><label>Country<select id="orbit-country">${geography.data.countries.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.code}">${esc(c.name)}</option>`).join('')}</select></label><label>Region<select id="orbit-region"></select></label><label id="orbit-appellation-label" hidden>Appellation / subregion<select id="orbit-appellation" aria-label="Appellation or subregion"></select></label><p class="orbit-boundary-note">Highlighted borders are administrative regions, not wine appellations.</p><div id="orbit-info"></div></aside></div><details class="dot-credits"><summary>Map sources & credits</summary><p>Original sommNI globe. Country and administrative boundaries: Natural Earth (public domain), simplified for display. Winery locations: Oliver Dressler / winerymap (MIT), collected in 2024. Source groups can cross administrative borders. Coverage is incomplete. <a href="./atlas/SOURCES.md" target="_blank" rel="noopener noreferrer">Data and attribution</a>.</p></details>`;
 const get=<T extends HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
 const canvas=get<HTMLCanvasElement>('dot-explorer'),countries=get<HTMLSelectElement>('orbit-country'),regions=get<HTMLSelectElement>('orbit-region');
 const placeWheels=[attachPlaceWheel(countries,'Country'),attachPlaceWheel(regions,'Region'),attachPlaceWheel(get<HTMLSelectElement>('orbit-appellation'),'Appellation')];
 const wineAreas=wineRegionContexts(boundaries);
 const selectableRegions=[...wineAreas,...boundaries.regions];
 const countryRegions=()=>selectableRegions.filter(r=>r.country===country.code&&r.name);
 const administrativeRegions=()=>boundaries.regions.filter(r=>r.country===country.code&&r.name);
 const placeSearch=get<HTMLInputElement>('orbit-search-input'),placeResults=get('orbit-search-results');
 const places=[...geography.data.countries.map(c=>({name:c.name,country:c,region:null as BoundaryRegion|null})),...selectableRegions.flatMap(r=>{const c=geography.data.countries.find(c=>c.code===r.country);return c&&r.name?[{name:r.name,country:c,region:r}]:[]})];
 function clearSearch(){placeSearch.value='';placeResults.innerHTML='';placeResults.hidden=true;get('orbit-search-status').textContent='';}
 placeSearch.addEventListener('input',()=>{
  const query=placeSearch.value.trim();if(!query){clearSearch();return;}
  const matches=places.filter(p=>placeSearchScore(p.name,query,p.country.name)>0).sort((a,b)=>placeSearchScore(b.name,query,b.country.name)-placeSearchScore(a.name,query,a.country.name)||a.name.localeCompare(b.name));
  placeResults.hidden=false;placeResults.innerHTML=matches.slice(0,8).map(p=>`<button type="button" data-place-country="${esc(p.country.code)}" ${p.region?`data-place-region="${esc(p.region.id)}"`:''}><strong>${esc(p.name)}</strong><span>${p.region?esc(p.country.name)+' · '+esc(p.region.kind):'Country / territory'}</span></button>`).join('');
  get('orbit-search-status').textContent=matches.length?`${matches.length} matching places${matches.length>8?' · showing the first 8; keep typing to narrow down':''}`:'No matching place. Try a country or regional name, such as Piedmont.';
 });
 placeResults.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-place-country]');if(!button)return;const next=geography.data.countries.find(c=>c.code===button.dataset.placeCountry);if(!next)return;chooseCountry(next);const found=selectableRegions.find(r=>r.id===button.dataset.placeRegion);if(found)chooseRegion(found);clearSearch();const fold=placeSearch.closest<HTMLDetailsElement>('details.orbit-place-search');if(fold){fold.open=false;fold.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});}});
 placeSearch.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();placeResults.querySelector<HTMLButtonElement>('button')?.click();}else if(event.key==='Escape'&&placeSearch.value){event.preventDefault();event.stopPropagation();clearSearch();}});

 const voiceButton=get<HTMLButtonElement>('orbit-voice');
 const SpeechRecognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
 let recognition:any=null;
 if(!SpeechRecognition){voiceButton.disabled=true;voiceButton.title='Voice search is available on the G2 glasses or in a browser with speech recognition. Type a place here.';}
 voiceButton.addEventListener('click',()=>{
  if(recognition){recognition.abort();return;}
  const session=new SpeechRecognition();recognition=session;session.lang=getLocale();session.continuous=false;session.interimResults=false;
  voiceButton.textContent='Stop listening';voiceButton.setAttribute('aria-pressed','true');get('orbit-search-status').textContent='Listening… say a country or region. Your browser handles speech recognition.';
  session.onresult=(event:any)=>{if(recognition!==session||!isOpen())return;placeSearch.value=event.results[0][0].transcript;placeSearch.dispatchEvent(new Event('input'));};
  session.onerror=(event:any)=>{if(recognition===session)get('orbit-search-status').textContent=event.error==='not-allowed'?'Microphone access was denied. You can still type a place.':'No speech received. Try again or type a place.';};
  session.onend=()=>{if(recognition===session){recognition=null;voiceButton.textContent='Voice search';voiceButton.setAttribute('aria-pressed','false');}};
  try{session.start();}catch{session.onend();get('orbit-search-status').textContent='Voice search could not start. Type a country or region.';}
 });

 function syncMotion(){get('orbit-spin').textContent=motion.spinning?'Ⅱ Pause spin':'↻ Spin globe';get('orbit-spin').setAttribute('aria-pressed',String(motion.spinning));}
 let manuallyPaused=reduced.matches,resumeTimer:ReturnType<typeof setTimeout>|null=null;
 const clearResume=()=>{if(resumeTimer!==null)clearTimeout(resumeTimer);resumeTimer=null;};
 const stop=()=>{clearResume();motion.stop();syncMotion();};
 function resumeAfterExploring(){
  clearResume();if(manuallyPaused||reduced.matches||!isOpen()||document.hidden)return;
  resumeTimer=setTimeout(()=>{resumeTimer=null;if(manuallyPaused||reduced.matches||!isOpen()||document.hidden||pointers.size)return;motion.spinning=true;motion.resetClock();syncMotion();draw();},4000);
 }

 function paint(time=0){
  frame=0;if(!isOpen()||document.hidden)return;
  if(time-painted>=50){const delta=motion.step(time);camera.center[0]=wrapLongitude(camera.center[0]+delta[0]/Math.max(1,camera.zoom));camera.center[1]=Math.max(-89,Math.min(89,camera.center[1]+delta[1]));model.draw(canvas,camera,country,region,hover,coverage);painted=time;}
  if(motion.active)frame=requestAnimationFrame(paint);else syncMotion();
 }
 function draw(){painted=0;if(!frame&&isOpen()&&!document.hidden)frame=requestAnimationFrame(paint)}
 function visibility(){if(document.hidden){clearResume();recognition?.abort();if(frame)cancelAnimationFrame(frame);frame=0;}else{motion.resetClock();draw();resumeAfterExploring();}}
 document.addEventListener('visibilitychange',visibility);
 reduced.addEventListener('change',()=>{if(reduced.matches){stop();draw();}});
 const updateCoverage=()=>{coverage=collectiveCoverage(geography.data,boundaries,collectiveSnapshot());info();options();draw();};
 window.addEventListener('winelens-library-changed',updateCoverage);window.addEventListener('sommni-atlas-snapshot',updateCoverage);
 function regionalWines(target:BoundaryRegion|null=region):CatalogWine[]{
  const wines=catalog.filter(w=>atlasCountryFor(geography,w.country)?.code===country.code);if(!target)return wines;
  if(wineRegionById(target.id))return wines.filter(w=>wineRegionFor(w.country,w.wine.region)?.id===target.id);
  const clusters=new Set(geography.data.regions.filter(r=>target.clusters.includes(r.id)).map(r=>r.name));
  return wines.filter(w=>catalogRegions.get(w.id)?.has(target.id)||(country.code==='JPN'&&prefectureKey(w.wine.region)===prefectureKey(target.name))||regionalCatalog[target.id]?.includes(w.wine.region)||links.links.some(l=>l.region===w.wine.region&&l.clusters.some(c=>clusters.has(c))));
 }
 function matchedWines(target:BoundaryRegion|null=region):CatalogWine[]{
  const wines=regionalWines(target);
  return target===region&&selectedAppellation?wines.filter(w=>normalizePlace(w.wine.region.split(',')[0])===selectedAppellation):wines;
 }
 function appellationOptions(){
  const area=region&&wineRegionById(region.id),label=get('orbit-appellation-label'),select=get<HTMLSelectElement>('orbit-appellation');
  label.hidden=!area;if(!area){selectedAppellation='';return;}
  const groups=new Map<string,{name:string,count:number}>();
  for(const w of regionalWines(region)){const name=w.wine.region.split(',')[0].trim(),key=normalizePlace(name);if(['bordeaux','burgundy'].includes(key))continue;const current=groups.get(key);groups.set(key,{name,count:(current?.count??0)+1});}
  if(selectedAppellation&&!groups.has(selectedAppellation))selectedAppellation='';
  select.innerHTML='<option value="">View all wines</option>'+[...groups].sort((a,b)=>b[1].count-a[1].count||a[1].name.localeCompare(b[1].name)).map(([key,item])=>`<option value="${esc(key)}">${esc(item.name)} · ${item.count}</option>`).join('');select.value=selectedAppellation;
 }
 get<HTMLSelectElement>('orbit-appellation').addEventListener('change',event=>{
  selectedAppellation=(event.target as HTMLSelectElement).value;stop();
  const cluster=geography.data.regions.find(r=>r.country===country.code&&normalizePlace(r.name)===selectedAppellation);
  const area=region&&wineRegionById(region.id);
  if(cluster)camera={center:[...cluster.center],zoom:24};else if(area)camera={center:[...area.center],zoom:area.radius>1?12:18};
  previewWine(null);info();draw();resumeAfterExploring();
 });
 let bottleDeck:WineContext[]=[],currentBottle:WineContext|null=null;
 const bottleKey=(wine:WineContext|null)=>wine?.libraryId?'library:'+wine.libraryId:wine?.catalogId?'catalog:'+wine.catalogId:'';
 const bottle=get<HTMLButtonElement>('orbit-bottle');
 function previewWine(wine:WineContext|null){
  currentBottle=wine;
  const stage=dialog.querySelector<HTMLElement>('.orbit-stage')!;
  stage.dataset.bottle=String(!!wine?.photo);
  bottle.hidden=!wine;bottle.innerHTML=wine?wineThumbnail(wine.photo,wine.title):'';
  delete bottle.dataset.libraryNotes;delete bottle.dataset.wineNotes;
  if(wine?.libraryId)bottle.dataset.libraryNotes=wine.libraryId;else if(wine?.catalogId)bottle.dataset.wineNotes=wine.catalogId;
  bottle.setAttribute('aria-label',wine?'Open tasting notes for '+wine.title:'Open wine tasting notes');
  get('orbit-selected-wine').textContent=wine?.title||'';
  const index=bottleDeck.findIndex(w=>bottleKey(w)===bottleKey(wine));
  get('orbit-bottle-nav').hidden=!wine;get('orbit-bottle-help').hidden=!wine;
  get('orbit-bottle-count').textContent=index>=0?`${index+1} / ${bottleDeck.length} · ${[wine?.region?.split(',')[0],wine?.vintage].filter(Boolean).join(' · ')}`:'';
  get<HTMLButtonElement>('orbit-bottle-prev').disabled=index<=0;
  get<HTMLButtonElement>('orbit-bottle-next').disabled=index<0||index>=bottleDeck.length-1;
  get('orbit-info').querySelectorAll<HTMLElement>('.wine-photo-row').forEach(row=>{
   const active=wine?.libraryId?row.dataset.libraryNotes===wine.libraryId:!!wine?.catalogId&&row.dataset.wineNotes===wine.catalogId;
   if(active)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
  });
  watchWinePhotos(stage);
 }
 function stepBottle(delta:number){
  const index=bottleDeck.findIndex(w=>bottleKey(w)===bottleKey(currentBottle));
  const next=bottleDeck[Math.max(0,Math.min(bottleDeck.length-1,index+delta))];
  if(next){previewWine(next);stop();resumeAfterExploring();}
 }
 get('orbit-bottle-prev').addEventListener('click',()=>stepBottle(-1));
 get('orbit-bottle-next').addEventListener('click',()=>stepBottle(1));
 attachBottleSwipe(bottle,stepBottle);
 function info(){
  placeWheels.forEach(wheel=>wheel.sync());
  const wines=matchedWines(),appellation=selectedAppellation?regionalWines().find(w=>normalizePlace(w.wine.region.split(',')[0])===selectedAppellation)?.wine.region.split(',')[0]:null,clusters=geography.data.regions.filter(r=>r.country===country.code&&(!region||region.clusters.includes(r.id)));
  const personal=readLibrary().items.filter(w=>{if(selectedAppellation&&normalizePlace((w.region??'').split(',')[0])!==selectedAppellation)return false;const coverage=winebraryCoverage(geography.data,boundaries,[w]);if(region&&wineRegionById(region.id))return wineRegionFor(w.metadata?.country??w.region?.split(',')[1]??'',w.region??'')?.id===region.id;return region?coverage.regions.has(region.id):coverage.countries.has(country.code);});
  const saved=region?(wineRegionById(region.id)?wines.length:coverage.regionCounts.get(region.id)??0):coverage.countryCounts.get(country.code)??0;
  const grapes=[...new Set(wines.map(w=>w.wine.grape))].slice(0,7);
  const stories=wines.flatMap(w=>storyCards(w.id,'region')).filter((s,i,a)=>a.findIndex(x=>x.source===s.source&&x.title===s.title)===i);
  get('orbit-path').innerHTML=`<button class="place-heading" data-place-insight="country">${esc(country.name)} ↗</button>${region?` / <button class="place-heading" data-place-insight="region">${esc(region.name)} ↗</button>`:''}`;
  get('dot-status').textContent=region?`${region.name}: ${wineRegionById(region.id)?'administrative context highlighted, not an appellation boundary':'boundary highlighted'}. Bottle photographs are reference images; vintages may differ.`:`${country.name} selected. Pick a region to narrow the wines.`;
  const row=(w:WineContext)=>`<button class="wine-photo-row bottle-row-summary" ${w.libraryId?`data-library-notes="${esc(w.libraryId)}"`:`data-wine-notes="${esc(w.catalogId)}"`}>${bottleRowCells({name:w.title,photo:w.photo,vintage:w.vintage,country:w.country,region:w.region,variety:w.grape,style:w.style,sake:w.sake})}</button>`;
  const groups=new Map<string,CatalogWine[]>();for(const wine of wines)groups.set(wine.type,[...(groups.get(wine.type)||[]),wine]);
  get('orbit-info').innerHTML=`<button class="place-heading wl-kicker" id="dot-country" data-place-insight="country" ${region?'':'hidden'}>${esc(country.name)} ↗</button><h3 id="dot-region"><button class="place-heading" data-place-insight="region">${esc(appellation??region?.name??country.name)} ↗</button></h3><p class="coverage-status" data-covered="${saved>0}">${saved?`${saved} shared wine${saved===1?'':'s'} · our collective effort`:'No shared wine here yet · history is open'}</p>
   <p class="orbit-stats">${wines.length} wines${personal.length?` · ${personal.length} in your Winebrary`: ""}</p>
   ${personal.length?`<details class="orbit-wine-group"><summary>Your Winebrary <span>${personal.length}</span></summary><div class="orbit-wines bottle-row-list">${personal.length?bottleRowHead(personal.every(w=>w.metadata?.color==='Sake'),personal.some(w=>w.metadata?.color==='Sake')):''}${personal.map(w=>row(libraryContext(w))).join('')||'<p class="orbit-muted">No saved bottles from this place yet. Open a catalog wine below to save it.</p>'}</div></details>`:''}
   ${[...groups].map(([style,rows],i)=>`<details class="orbit-wine-group" ${i===0&&!matchMedia('(max-width:760px)').matches?'open':''}><summary>${esc(style)} <span>${rows.length} wines</span></summary><div class="orbit-wines bottle-row-list">${bottleRowHead(style==='Sake')}${rows.map(w=>row(catalogContext(w))).join('')}</div></details>`).join('')||'<p class="orbit-muted">No linked catalog wines yet. This place’s history is still open.</p>'}
   <details><summary>About ${esc(region?.name||country.name)}</summary><p>${esc(region?.kind??'Country / territory')} · ${region?'administrative boundary, not an appellation or vineyard pin':'country boundary'}</p>${grapes.length?`<h4>Grapes / rice in this selection</h4><p>${grapes.map(esc).join(' · ')}</p>`:''}<button class="wl-text-button" data-place-insight="region">Explore the place history ↗</button>${stories.map(s=>`<article class="orbit-history"><strong>${esc(s.date)} · ${esc(s.title)}</strong><p>${esc(s.cue)}</p><details><summary>Read the regional insight</summary><p>${esc(s.detail)}</p></details><a href="${esc(STORY_SOURCES[s.source].url)}" target="_blank" rel="noopener noreferrer">${esc(STORY_SOURCES[s.source].publisher)} ↗</a></article>`).join('')}</details>
   <details><summary>${clusters.length} recorded wine-area groups</summary><p class="orbit-muted">Source groups indicate winery locations, not appellation borders.</p><div class="orbit-clusters">${clusters.map(c=>`<span>${esc(c.name)}</span>`).join('')||'<p>No locations recorded here.</p>'}</div></details><button class="wl-text-button" data-browse-notes>Browse all tasting notes ↗</button>`;
  watchWinePhotos(get('orbit-info'));
  get('orbit-info').querySelectorAll<HTMLButtonElement>('.wine-photo-row').forEach(button=>{
   const context=button.dataset.libraryNotes?personal.find(w=>w.id===button.dataset.libraryNotes):wines.find(w=>w.id===button.dataset.wineNotes);
   if(!context)return;const update=()=>previewWine('wine_name' in context?libraryContext(context):catalogContext(context));
   button.addEventListener('focus',update);button.addEventListener('pointerenter',update);
  });
  const personalIds=new Set(personal.map(w=>w.wine_id).filter(Boolean));
  bottleDeck=[...personal.map(libraryContext),...wines.filter(w=>!personalIds.has(w.id)).map(catalogContext)];
  previewWine(bottleDeck.find(w=>bottleKey(w)===bottleKey(currentBottle))??bottleDeck[0]??null);
 }
 const catalogChanged=()=>{catalog=allCatalogWines();catalogRegions=coverageByWine();updateCoverage();};
 window.addEventListener('sommni-catalog-updated',catalogChanged);
 function followGlasses(){
  const selected=glassesContext();if(!selected||!isOpen())return;
  const fixture={id:'selected',wine_name:selected.title,producer:null,vintage:null,notes:null,region:selected.region||null,wine_id:selected.catalogId,metadata:{country:selected.country}};
  const covered=winebraryCoverage(geography.data,boundaries,[fixture]);
  const found=geography.data.countries.find(c=>covered.countries.has(c.code))||atlasCountryFor(geography,selected.country);if(!found)return;
  chooseCountry(found);const area=wineRegionFor(found.code,selected.region??'');const next=selectableRegions.find(r=>r.id===area?.id)??boundaries.regions.find(r=>covered.regions.has(r.id));if(next)chooseRegion(next);
  if(area){const key=normalizePlace((selected.region??'').split(',')[0]);const option=[...(get('orbit-appellation') as HTMLSelectElement).options].find(o=>o.value===key);if(option){selectedAppellation=key;(get('orbit-appellation') as HTMLSelectElement).value=key;info();draw();}}
  if(selected.photo)previewWine(selected);
 }
 window.addEventListener('sommni-glasses-context',followGlasses);
 dialog.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest<HTMLElement>('[data-place-insight]');if(b)void openPlaceInsight(country.name,b.dataset.placeInsight==='country'?null:(selectedAppellation?regionalWines().find(w=>normalizePlace(w.wine.region.split(',')[0])===selectedAppellation)?.wine.region.split(',')[0]:region?.name)??null,b.dataset.placeInsight==='country'?catalog.filter(w=>atlasCountryFor(geography,w.country)?.code===country.code):matchedWines());});
 function options(){
  countries.value=country.code;const list=countryRegions(),available=new Map(list.map(r=>[r.id,regionalWines(r).length]));
  const priority=(r:BoundaryRegion)=>wineRegionById(r.id)?3:coverage.regions.has(r.id)?2:(available.get(r.id)??0)>0?1:0;
  list.sort((a,b)=>priority(b)-priority(a)||(available.get(b.id)??0)-(available.get(a.id)??0)||a.name.localeCompare(b.name));
  regions.innerHTML=`<option value="">${list.length?'Choose a region…':'No regional boundaries available'}</option>`+[3,2,1,0].map(group=>{const rows=list.filter(r=>priority(r)===group);return rows.length?`<optgroup label="${group===3?'Wine regions':group===2?'Lit by the community':group===1?'Wines in the catalog':'More places · history'}">${rows.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}${available.get(r.id)?' · '+available.get(r.id)+' wines':''}</option>`).join('')}</optgroup>`:''}).join('');
  regions.disabled=!list.length;regions.value=region?.id??'';appellationOptions();placeWheels.forEach(wheel=>wheel.sync());
 }

 function chooseCountry(c:Country){currentBottle=null;stop();selectedAppellation='';country=c;region=null;hover=null;camera=fitCamera(boundaries.countries[c.code]??[]);options();info();draw();resumeAfterExploring();}
 function chooseRegion(r:BoundaryRegion){currentBottle=null;stop();selectedAppellation='';region=r;hover=null;const area=wineRegionById(r.id);camera=area?{center:[...area.center],zoom:area.radius>1?12:18}:fitCamera(r.polygons);regions.value=r.id;appellationOptions();info();draw();resumeAfterExploring();}
 function reset(selection:DotSelection){clearSearch();stop();selectedAppellation='';country=selection.country;region=selection.region?selectableRegions.find(r=>r.id===selection.region?.id)??regionAt(selection.region.center,administrativeRegions()):null;camera={center:[...(selection.region?.center??country.center)],zoom:1};hover=null;motion.spinning=!reduced.matches&&!manuallyPaused;syncMotion();options();info();draw();}
 countries.addEventListener('change',()=>chooseCountry(geography.data.countries.find(c=>c.code===countries.value)!));
 regions.addEventListener('change',()=>{const found=countryRegions().find(r=>r.id===regions.value);if(found)chooseRegion(found);else chooseCountry(country);});
 get('dot-close').hidden=!modal;get('dot-close').addEventListener('click',()=>modal?.close());
 dialog.addEventListener('close',()=>{recognition?.abort();stop();if(frame)cancelAnimationFrame(frame);frame=0;pointers.clear();});
 const zoom=(factor:number)=>{stop();camera.zoom=Math.max(.8,Math.min(28,camera.zoom*factor));draw()};
 get('orbit-plus').addEventListener('click',()=>zoom(1.4));get('orbit-minus').addEventListener('click',()=>zoom(1/1.4));
 get('orbit-world').addEventListener('click',()=>{stop();camera.zoom=1;motion.spinning=!reduced.matches&&!manuallyPaused;syncMotion();draw()});
 get('dot-west').addEventListener('click',()=>{stop();camera.center[0]=wrapLongitude(camera.center[0]-20/camera.zoom);draw()});get('dot-east').addEventListener('click',()=>{stop();camera.center[0]=wrapLongitude(camera.center[0]+20/camera.zoom);draw()});
 get('orbit-spin').addEventListener('click',()=>{manuallyPaused=motion.spinning;stop();motion.spinning=!manuallyPaused;syncMotion();draw()});
 canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key)){e.preventDefault();stop();if(e.key==='Home')camera={center:[...country.center],zoom:1};else if(e.key==='+'||e.key==='=')zoom(1.4);else if(e.key==='-')zoom(1/1.4);else{camera.center[0]=wrapLongitude(camera.center[0]+(e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0)/camera.zoom);camera.center[1]=Math.max(-89,Math.min(89,camera.center[1]+(e.key==='ArrowUp'?10:e.key==='ArrowDown'?-10:0)/camera.zoom));}draw();}});
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.003))},{passive:false});
 const pointers=new Map<number,Point>();let moved=false,start:Point=[0,0],dragTime=0,dragDelta:Point=[0,0],dragSeconds=.016;
 const coordinate=(e:PointerEvent):Point=>{const rect=canvas.getBoundingClientRect(),size=Math.min(rect.width,rect.height);return [(e.clientX-rect.left-(rect.width-size)/2)*720/size,(e.clientY-rect.top-(rect.height-size)/2)*720/size]};
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;stop();canvas.focus({preventScroll:true});const p=coordinate(e);pointers.set(e.pointerId,p);start=p;dragTime=e.timeStamp;dragDelta=[0,0];moved=pointers.size>1;canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');});
 canvas.addEventListener('pointermove',e=>{
  const p=coordinate(e),previous=pointers.get(e.pointerId);
  if(previous){if(Math.hypot(p[0]-start[0],p[1]-start[1])>5)moved=true;
   if(pointers.size===2){const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)![1];const before=Math.hypot(previous[0]-other[0],previous[1]-other[1]),after=Math.hypot(p[0]-other[0],p[1]-other[1]);if(before>1)camera.zoom=Math.max(.8,Math.min(28,camera.zoom*after/before));moved=true;}
   else{dragDelta=[-(p[0]-previous[0])*.18/camera.zoom,(p[1]-previous[1])*.18/camera.zoom];dragSeconds=Math.max(.008,(e.timeStamp-dragTime)/1000);camera.center[0]=wrapLongitude(camera.center[0]+dragDelta[0]);camera.center[1]=Math.max(-89,Math.min(89,camera.center[1]+dragDelta[1]));}dragTime=e.timeStamp;
   pointers.set(e.pointerId,p);hover=null;draw();
  }else if(e.pointerType==='mouse'){const geo=unproject(...p,camera),next=geo?regionAt(geo,administrativeRegions()):null;if(next!==hover){hover=next;draw();}}
 });
 canvas.addEventListener('pointerup',e=>{const p=coordinate(e),click=!moved&&pointers.size===1;pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!pointers.size)canvas.classList.remove('dragging');if(!click){if(!pointers.size&&!reduced.matches&&e.timeStamp-dragTime<120){motion.release(...dragDelta,dragSeconds);syncMotion();draw();}return;}const geo=unproject(...p,camera);if(!geo)return;const id=geography.countryAt(...geo),next=geography.data.countries.find(c=>c.id===id);if(next&&next.code!==country.code)chooseCountry(next);else{const found=regionAt(geo,administrativeRegions());if(found)chooseRegion(found);else if(next)chooseCountry(next);}});
 canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);moved=true;canvas.classList.remove('dragging')});
 canvas.addEventListener('pointerleave',()=>{if(!pointers.size){hover=null;draw();}});
 // A deliberate pause stays paused. Exploration only suspends the idle spin.
 const interacted=(event:Event)=>{if((event.target as HTMLElement).closest('#orbit-spin,#dot-close'))return;resumeAfterExploring();};
 for(const name of ['pointerup','pointercancel','wheel','keydown','change','input'])dialog.addEventListener(name,interacted);
 const observer=modal?null:new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);if(inView){motion.resetClock();draw();resumeAfterExploring();}else{clearResume();recognition?.abort();if(frame)cancelAnimationFrame(frame);frame=0;}},{threshold:.02});
 observer?.observe(canvas);
 const overlayObserver=modal?null:new MutationObserver(()=>{if(isOpen()){motion.resetClock();draw();resumeAfterExploring();}else{if(frame)cancelAnimationFrame(frame);frame=0;}});
 overlayObserver?.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
 options();info();
 return {open(selection:DotSelection){if(modal&&!modal.open)modal.showModal();reset(selection);followGlasses();},destroy(){placeWheels.forEach(wheel=>wheel.destroy());observer?.disconnect();overlayObserver?.disconnect();recognition?.abort();stop();if(frame)cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('sommni-glasses-context',followGlasses);window.removeEventListener('sommni-catalog-updated',catalogChanged);window.removeEventListener('winelens-library-changed',updateCoverage);window.removeEventListener('sommni-atlas-snapshot',updateCoverage);}};
}
