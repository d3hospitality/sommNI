import { bottleRowCells } from '../bottle-rows';
import { watchWinePhotos, catalogContext, mountWineContext } from '../wine-context';
import { catalogPhoto, allCatalogWines, type CatalogWine } from '../identity';
import { WINE_TYPES, TYPE_DISPLAY, type WineType } from '../constants';
import { getFavorites } from '../sync';
import { browseCatalog, catalogOrigin, type CatalogSelection, type CatalogFilter } from './catalog-browse';
import { referenceNotes } from '../reference-notes';
import './catalog.css';

const selection:CatalogSelection={filter:'All',query:'',country:'',region:'',grouping:'auto',sort:'name'};
let favorites=new Set<string>(),revision=0,selectedWine='',catalogView:'rows'|'cards'='rows';
const expandedWines=new Set<string>();
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function showBetaCatalogGrape(grape:string){Object.assign(selection,{filter:'All',query:grape,country:'',region:'',grouping:'variety'});}
export function showBetaCatalogType(type:WineType){Object.assign(selection,{filter:type,query:'',country:'',region:''});}

function row(entry:CatalogWine){
 const wine=entry.wine,parts=wine.name.split(' – '),photo=catalogPhoto(entry.id,new URL('./',location.href).href),origin=catalogOrigin(entry),sake=entry.type==='Sake';
 const note=referenceNotes(entry.community?wine.palate:[['NOSE',wine.nose],['PALATE',wine.palate],['FINISH',wine.finish],['BEHIND THE WINE',wine.anecdote]].filter(([,text])=>text).map(([label,text])=>label+'\n'+text).join('\n\n'));
 return `<details class="wl-catalog-row" data-catalog-row="${esc(entry.id)}" ${expandedWines.has(entry.id)?'open':''}><summary class="bottle-row-summary">${bottleRowCells({name:parts[0],producer:parts.slice(1).join(' – '),photo,vintage:entry.vintages?.join(', '),country:origin.country,region:origin.region,variety:wine.grape,style:sake?wine.style:TYPE_DISPLAY[entry.type],sake,favorite:favorites.has(entry.id)})}</summary><div class="wl-row-expanded">${photo?`<img class="wl-row-full-bottle wine-thumb" src="${esc(photo)}" alt="${esc(parts[0])} bottle photograph" loading="lazy">`:''}<div class="wl-row-information"><dl>${[[sake?'Prefecture':'Region',origin.region],[sake?'Rice':'Grape',wine.grape],['Style',wine.style],['Vintages',entry.vintages?.join(', ')]].filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${note?`<p class="wl-row-note">${esc(note)}</p>`:''}<small class="cat-source">${entry.community?'Community supplied · details subject to review':'Reference notes · exact vintage may differ'}</small><div class="wl-row-actions"><button data-wine-notes="${esc(entry.id)}">Tasting notes & story ↗</button><button data-save-library="${esc(entry.id)}">Save to Winebrary ＋</button><button data-cat-origin="${esc(entry.id)}">View origin ↗</button></div></div></div></details>`;
}

function card(entry:CatalogWine){
 const [name,...producer]=entry.wine.name.split(' – '),origin=catalogOrigin(entry),photo=catalogPhoto(entry.id,new URL('./',location.href).href);
 return `<article class="wl-bottle-card"><button class="wl-bottle-open" data-wine-notes="${esc(entry.id)}"><div class="wl-bottle-stage">${photo?`<img class="wine-thumb" src="${esc(photo)}" alt="${esc(name)} bottle" loading="lazy">`:'<span class="wl-photo-placeholder">PHOTO<br>TO COME</span>'}${entry.vintages?.length?`<span class="wl-vintage">${esc(entry.vintages.join(', '))}</span>`:''}</div><div class="wl-bottle-copy"><p class="wl-kicker">${esc(origin.country)} · ${esc(origin.region)}</p><h3>${esc(name)}</h3><p>${esc(producer.join(' – ')||entry.wine.grape)} <span>↗</span></p></div></button></article>`;
}

export async function renderBetaCatalog(){
 const root=document.getElementById('beta-catalog');if(!root)return;const current=++revision;
 const nextFavorites=await getFavorites();if(current!==revision)return;favorites=new Set(nextFavorites);
 const all=allCatalogWines();
 root.innerHTML=`<div class="wl-section-heading"><div><p class="wl-kicker">OUR COLLECTIVE WINE CATALOG</p><h2 id="cat-title"></h2></div><button class="wl-primary" id="cat-add">＋ Add a wine</button></div>
 <div class="wl-library-toolbar"><p class="wl-muted">${all.length} bottles · Growing together</p><label class="wl-search-label"><span class="sr-only">Search the catalog</span><input id="cat-search" type="search" value="${esc(selection.query)}" placeholder="Search wines, producers, grapes…" autocomplete="off"></label></div>
 <div class="wl-view-toolbar"><div class="wl-view-switch" role="group" aria-label="Catalog view"><button data-catalog-view="rows" aria-pressed="${catalogView==='rows'}">Rows</button><button data-catalog-view="cards" aria-pressed="${catalogView==='cards'}">Bottles</button></div><label>Sort<select id="cat-sort"><option value="name">Wine name</option><option value="producer">Producer</option><option value="vintage">Newest vintage</option></select></label><label>Group by<select id="cat-group"><option value="auto">Place → style</option><option value="country">Country</option><option value="variety">Grape / rice</option><option value="style">Style</option></select></label><span id="cat-count" role="status"></span></div>
 <div id="cat-origin"></div><div id="cat-styles" class="cat-filters" role="group" aria-label="Filter by style"></div>
 <div class="cat-list-hint"><span>Tap a bottle to explore its notes</span><button id="cat-reset" class="wl-text-button" hidden>Clear filters ×</button></div>
 <details id="cat-map-panel" class="cat-map-panel" hidden><summary>Bottle & origin <span id="cat-preview-name">Select a wine</span></summary><aside id="catalog-context" aria-label="Selected wine and origin"></aside></details><div id="cat-results"></div>`;
 root.querySelector('#cat-add')!.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('sommni-add-wine')));
 const context=root.querySelector<HTMLElement>('#catalog-context')!,preview=mountWineContext(context),panel=root.querySelector<HTMLDetailsElement>('#cat-map-panel')!;
 const showContext=(wine:CatalogWine)=>{selectedWine=wine.id;root.querySelector('#cat-preview-name')!.textContent=wine.wine.name.split(' – ')[0];context.hidden=false;if(panel.open)void preview(catalogContext(wine));};
 panel.addEventListener('toggle',()=>{if(panel.open){const wine=all.find(w=>w.id===selectedWine);if(wine)showContext(wine);}else panel.hidden=true;});
 const renderResults=()=>{
  const result=browseCatalog(all,selection,favorites);
  const originSelect=(kind:'country'|'region',choices:[string,number][])=>{const value=selection[kind];const options=value&&!choices.some(([name])=>name===value)?[...choices,[value,0] as [string,number]]:choices;return `<select id="cat-${kind}" ${kind==='region'&&!selection.country?'disabled':''}><option value="">${kind==='country'?'All countries':selection.country?'All regions':'Choose country first'}</option>${options.map(([name,count])=>`<option value="${esc(name)}" ${value===name?'selected':''}>${esc(name)} · ${count}</option>`).join('')}</select>`;};
  root.querySelector('#cat-origin')!.innerHTML=`<div class="bottle-origin-filters" aria-label="Browse by place"><label for="cat-country"><span>01 / Country</span>${originSelect('country',result.countries)}</label><span class="bottle-origin-arrow" aria-hidden="true">→</span><label for="cat-region"><span>02 / ${selection.country==='Japan'?'Prefecture':'Region'}</span>${originSelect('region',result.regions)}</label></div>`;
  const filterPill=(type:CatalogFilter)=>{const count=result.styleCount(type),label=type==='All'?'All':type==='Favorites'?'Favorites':type==='Unclassified'?'To identify':TYPE_DISPLAY[type];return `<button class="cat-filter-pill ${type==='Unclassified'?'cat-filter-unclassified':''}" data-cat-filter="${type}" aria-pressed="${selection.filter===type}" aria-label="${type==='Unclassified'?'Style to confirm':label}, ${count} ${count===1?'bottle':'bottles'}">${type==='All'?'':type==='Favorites'?'<span class="cat-filter-star" aria-hidden="true">☆</span>':`<span class="cat-filter-dot" data-style="${type}" aria-hidden="true"></span>`}<span class="cat-filter-label">${label}</span><span class="cat-filter-count" aria-hidden="true">${count}</span></button>`;};
  root.querySelector('#cat-styles')!.innerHTML=`<div class="cat-filter-bar"><span class="cat-filter-heading" aria-hidden="true">Style</span><div class="cat-filter-shortcuts">${filterPill('All')}${filterPill('Favorites')}</div></div><div class="cat-filter-options">${WINE_TYPES.filter(type=>result.styleCount(type)>0||type===selection.filter).map(filterPill).join('')}</div>`;
  root.querySelector('#cat-title')!.textContent=result.title;
  const path=[selection.country,selection.region,selection.filter==='All'?'':selection.filter==='Favorites'?'Favorites':TYPE_DISPLAY[selection.filter]].filter(Boolean).join(' / ');
  root.querySelector('#cat-count')!.textContent=`${result.wines.length} ${result.wines.length===1?'bottle':'bottles'}${path?` · ${path}`:''}${selection.query.trim()?` · “${selection.query.trim()}”`:''}`;
  root.querySelector('#cat-results')!.innerHTML=result.wines.length?result.groups.map(([label,wines],index)=>`<section class="cat-bottle-group" aria-labelledby="cat-heading-${index}"><div class="cat-group-title"><h3 id="cat-heading-${index}">${esc(label)}</h3><span>${wines.length} ${wines.length===1?'bottle':'bottles'}</span></div><div class="${catalogView==='rows'?'wl-compact-list bottle-row-list':'wl-library-grid'}" aria-label="${esc(label)} bottles">${wines.map(catalogView==='rows'?row:card).join('')}</div></section>`).join(''):'<div class="wl-empty"><h3>No bottles here yet.</h3><p>Clear a filter or try another wine, producer or grape.</p><button data-cat-clear class="wl-text-button">Show all bottles ↗</button></div>';
  const focused=result.wines.find(w=>w.id===selectedWine)||result.groups[0]?.[1][0];
  if(focused)showContext(focused);else{context.hidden=true;panel.hidden=true;panel.open=false;root.querySelector('#cat-preview-name')!.textContent='No matching wine';}
  root.querySelectorAll<HTMLDetailsElement>('[data-catalog-row]').forEach(detail=>{const wine=result.wines.find(w=>w.id===detail.dataset.catalogRow)!;detail.querySelector('summary')!.addEventListener('focus',()=>showContext(wine));detail.addEventListener('toggle',()=>{if(detail.open){expandedWines.add(wine.id);showContext(wine);}else expandedWines.delete(wine.id);});});
  root.querySelectorAll<HTMLButtonElement>('[data-cat-origin]').forEach(button=>button.onclick=()=>{const wine=result.wines.find(w=>w.id===button.dataset.catOrigin)!;showContext(wine);panel.hidden=false;panel.open=true;showContext(wine);panel.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});});
  root.querySelector<HTMLButtonElement>('#cat-reset')!.hidden=!selection.query&&!selection.country&&!selection.region&&selection.filter==='All';
  root.querySelectorAll<HTMLButtonElement>('[data-cat-filter]').forEach(button=>button.onclick=()=>{selection.filter=button.dataset.catFilter as CatalogFilter;renderResults();root.querySelector<HTMLButtonElement>(`[data-cat-filter="${selection.filter}"]`)?.focus();});
  root.querySelector<HTMLSelectElement>('#cat-country')!.onchange=event=>{selection.country=(event.target as HTMLSelectElement).value;selection.region='';renderResults();root.querySelector<HTMLSelectElement>('#cat-region')!.focus();};
  root.querySelector<HTMLSelectElement>('#cat-region')!.onchange=event=>{selection.region=(event.target as HTMLSelectElement).value;renderResults();root.querySelector<HTMLSelectElement>('#cat-region')!.focus();};
  root.querySelector<HTMLButtonElement>('[data-cat-clear]')?.addEventListener('click',clear);
  watchWinePhotos(root.querySelector('#cat-results')!);
 };
 root.querySelectorAll<HTMLButtonElement>('[data-catalog-view]').forEach(button=>button.onclick=()=>{catalogView=button.dataset.catalogView as 'rows'|'cards';root.querySelectorAll<HTMLButtonElement>('[data-catalog-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.catalogView===catalogView)));renderResults();});
 const clear=()=>{Object.assign(selection,{query:'',country:'',region:'',filter:'All'});root.querySelector<HTMLInputElement>('#cat-search')!.value='';renderResults();};
 root.querySelector<HTMLInputElement>('#cat-search')!.oninput=event=>{selection.query=(event.target as HTMLInputElement).value;renderResults();};
 root.querySelector<HTMLButtonElement>('#cat-reset')!.onclick=clear;
 const group=root.querySelector<HTMLSelectElement>('#cat-group')!,sort=root.querySelector<HTMLSelectElement>('#cat-sort')!;
 group.value=selection.grouping;group.onchange=()=>{selection.grouping=group.value as CatalogSelection['grouping'];renderResults();};
 sort.value=selection.sort;sort.onchange=()=>{selection.sort=sort.value as CatalogSelection['sort'];renderResults();};
 renderResults();
}
