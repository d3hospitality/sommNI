import {savedLocations, wineLocations, cleanLocations, atLocation} from './saved-locations';
import {createLibraryPhotoState,missingPhotoTools,missingPhotoAction} from './winebrary-photos';
import {wineOrigin} from './wine-origin';
import {bottlePhotoUpload, bindBottlePhotoUpload} from './research/photo-upload';
import {foodPairingsHtml} from './food-pairings';
import {photoChoices} from './research/photo-choices';
import { countryLabel, regionLabel, originFilters } from './origin-filters';
import { bottleRowCells } from './bottle-rows';
import { isSake, sakeFields, bindSakeFields, sakeSummary } from './sake';
import { bindWinebrarySwipe } from './winebrary-swipe';
import { initLabelReview } from './research/label-phone';
import { libraryPhoto, watchWinePhotos } from './wine-context';
import { mountWineCommunity } from './community/initiative-ui';
import {showAccountPairing,showCloudAccount,initAccountPairing} from './account-pairing';
import {cloudCollection,isGuestLibrary} from './cloud-library';
import { findBottleCandidates, clipBottleCandidate, initBottleJobs, queueBottleArtwork, bottleJobStatuses } from './research/bottle-jobs';
import { highlightArrival } from './research/arrival';
import './winebrary-manage.css';
import { artworkStore, artworkOwner, setArtworkOwner, localWineArtwork, bottlePhoto, bottleCacheKey } from './artwork-store';
import { shareWineControl, finishWineArtwork, retryWineContributions, type WineSubmission } from './wine-contributions';
import { bottleImageUrl } from './bottle-assets';
import { stageCanvas, stageCacheKey } from './bottle-raster';
import { allCatalogWines } from './identity';
import { createBottleCutout, photoData, bottleCutoutEndpoint, bottleIdentity, inlineBottle } from './research/bottles';
import { getCatalogAnecdote, anecdoteSourcesHtml } from './catalog-anecdotes';
import { referenceNotes } from './reference-notes';
import { localizeNotes } from './intelligence/translation';
import { FREE_BETA } from './beta/config';
import { localCollection, localWines } from './beta/store';
import { betaProvider } from './beta/client';
import { researchAction } from './research/client';
import { mountWineNotesExport } from './research/notes';
import { account as auth, claimAccountCode, embeddedHost } from './account-client';
import { ACCOUNT_SITE, API_URL } from './account-config';
import { lookupWineById } from './identity';
import { useAccount, forgetAccount, unsyncedEvents } from './study/store';
import { syncStudy, setStudyAuth } from './study/sync';
import { showWineOnGlasses, canShowWine, clearPrivateGlasses, drawGlassesPreview, setLibrarySource, libraryChanged, saveLibraryCache, clearLibraryCache } from './winebrary-glasses';

export interface LibraryWine {
  id: string; wine_name: string; producer: string | null; vintage: number | null;
  region: string | null; notes: string | null; wine_id?: string; image_url?: string;
  metadata: { saved_locations?: string[]; sake_classification?: string; sake_style?: string; rice_variety?: string; vintage_state?: string; country?: string; state?:string; grape?: string; color?: string; image_path?: string; image_source?: string; bottle_provenance?: Record<string,string>; tasting_notes?: string; research_sources?: {sources: {title:string;url:string}[]} } | null;
}
interface ImageDraft { path: string; url: string; source: 'photograph' | 'generated'; provenance?: Record<string,unknown> }
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let userId: string | null = FREE_BETA ? 'beta-local' : null;
let items: LibraryWine[] = [];
let loading = false;
let notice = '';
let search = '';
let libraryCountry='', libraryRegion='', libraryLocation='';
let missingPhotosOnly=false;
const libraryPhotos=createLibraryPhotoState(libraryPhoto);
let generation = 0;
let dialog: HTMLDialogElement;
let root: HTMLElement;
let busy = false;
let dialogRevision = 0;
let libraryView: 'rows' | 'cards' = 'rows';
let librarySort = 'country';
const expandedWines = new Set<string>();
let arrivedWineId: string | null = null;
let bottleStatuses=new Map<string,{message:string;state:string}>();

export function vintageLabel(wine: LibraryWine): string {
  return wine.vintage ? String(wine.vintage) : wine.metadata?.vintage_state === 'non_vintage' ? 'Non-vintage' : 'Vintage unknown';
}
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  if (FREE_BETA) return isGuestLibrary()?localCollection(path,method,body):cloudCollection(path,method,body);
  const { data: { session } } = await auth.auth.getSession();
  if (!session || session.user.id !== userId) throw new Error('Sign in again to continue.');
  const response = await fetch(API_URL + path, {
    method, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not complete this action. Try again.');
  return result;
}
function feedback(message: string) {
  const el = document.getElementById('wl-feedback');
  if (el) el.textContent = message;
}
function openDialog(html: string) {
  if (busy) return;
  dialogRevision++;
  dialog.innerHTML = `<button class="wl-close" aria-label="Close dialog">×</button>${html}<p id="wl-feedback" class="wl-feedback" role="status" aria-live="polite"></p>`;
  dialog.querySelector('.wl-close')!.addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
function setBusy(value: boolean) {
  busy = value;
  dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = value);
  dialog.setAttribute('aria-busy', String(value));
}
async function run(task: () => Promise<void>) {
  if (busy) return;
  const revision=dialogRevision;
  setBusy(true);
  try { await task(); } catch (error) { if(revision===dialogRevision) feedback(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
  finally { if(revision===dialogRevision) setBusy(false); }
}
function requireAccount(action: () => void) { if (userId) action(); else signIn(); }
function signIn() { void showAccountPairing(); }

async function refresh(quiet=false) {
  let changed=true;
  const epoch = ++generation;
  if (!userId) { items = []; render(); return; }
  loading = true; if(!quiet){notice = ''; render();}
  try {
    const result = await api('/api/collection?limit=500');
    if (epoch !== generation) return;
    const cached=await Promise.all(result.items.map((wine:LibraryWine)=>localWineArtwork(wine,userId!,true).catch(()=>wine)));
    if(epoch!==generation)return;
    const unchanged=JSON.stringify(items)===JSON.stringify(cached);
    items=cached;
    const hadNotice=!!notice;notice='';
    if(quiet&&unchanged&&!hadNotice){changed=false;return;}
    bottleStatuses=await bottleJobStatuses().catch(()=>new Map());
    if(epoch!==generation)return;
    for(const wine of items)void finishWineArtwork(wine,userId!,true).catch(console.warn);
    if (items.length === 500) notice = 'Showing your 500 most recent wines.';
    if (userId) void saveLibraryCache(userId, items);
  } catch (e) { if (epoch === generation) {if(quiet&&items.length)changed=false;else notice = e instanceof Error ? e.message : 'Could not load your Winebrary.';} }
  finally { if (epoch === generation) { loading = false; if(changed){render(); libraryChanged();} } }
}
function bottleCaption(w:LibraryWine){const p=w.metadata?.bottle_provenance;return p?.identity_check?`<p class="wl-muted small">AI-matched reference photograph · ${esc(p.vintage_binding||'Exact vintage unverified')}</p>`:'';}
function bottleStatus(w:LibraryWine){const status=bottleStatuses.get(w.id);return !w.image_url?`<small role="status">${esc(status?.message||'Find a matching label or upload your own bottle photo.')}</small>`:'';}
function render() {
  const origins=items.map(w=>({country:countryLabel(wineOrigin(w.metadata?.country,w.region).country),region:regionLabel(w.region,w.metadata?.country||'')}));
  if(libraryCountry&&!origins.some(o=>o.country===libraryCountry)){libraryCountry='';libraryRegion='';}
  if(libraryRegion&&!origins.some(o=>o.country===libraryCountry&&o.region===libraryRegion))libraryRegion='';
  const locations=savedLocations(items);if(libraryLocation&&!locations.some(l=>atLocation({metadata:{saved_locations:[l.name]}},libraryLocation)))libraryLocation='';
  const scoped = items.filter(w=>atLocation(w,libraryLocation)).map(w=>({...w,image_url:libraryPhotos.photo(w)||undefined})).filter(w=>(!libraryCountry||countryLabel(wineOrigin(w.metadata?.country,w.region).country)===libraryCountry)&&(!libraryRegion||regionLabel(w.region,w.metadata?.country||'')===libraryRegion)).filter(w => `${w.wine_name} ${w.producer} ${w.vintage} ${w.region} ${w.metadata?.country} ${w.metadata?.grape} ${sakeSummary(w.metadata)}`.toLowerCase().includes(search.toLowerCase()));
  const missing=scoped.filter(w=>!w.image_url);
  const visible=missingPhotosOnly?missing:scoped;
  if(librarySort==='name')visible.sort((a,b)=>a.wine_name.localeCompare(b.wine_name));
  if(librarySort==='vintage')visible.sort((a,b)=>(b.vintage??0)-(a.vintage??0));
  if(librarySort==='country')visible.sort((a,b)=>countryLabel(a.metadata?.country).localeCompare(countryLabel(b.metadata?.country))||regionLabel(a.region,a.metadata?.country||'').localeCompare(regionLabel(b.region,b.metadata?.country||''))||a.wine_name.localeCompare(b.wine_name)||(b.vintage??0)-(a.vintage??0));
  root.innerHTML = `<div class="wl-section-heading"><div><p class="wl-kicker">COLLECT A LITTLE CURIOSITY</p><h2>Your Winebrary<span>.</span></h2></div><button class="wl-primary" id="wl-add">＋ Add a wine</button></div>
    <div class="wl-library-toolbar"><p class="wl-muted">${userId ? `${items.length} saved ${items.length === 1 ? 'wine' : 'wines'} · ${isGuestLibrary() ? 'Saved on this device' : 'Synced to your account'}` : 'A home for every bottle, every vintage, every discovery.'}</p>${userId ? `<label class="wl-search-label"><span class="sr-only">Search your wines</span><input id="wl-search" type="search" value="${esc(search)}" placeholder="Search your wines…"></label><button id="wl-refresh" class="wl-text-button">Refresh</button><button id="wl-artwork" class="wl-text-button">Offline bottles & uploads</button>` : ''}</div>
    ${userId ? `<div class="wl-view-toolbar"><button id="wl-view-all" class="wl-text-button">View All</button><div class="wl-view-switch" role="group" aria-label="Library view"><button data-library-view="rows" aria-pressed="${libraryView==='rows'}">Rows</button><button data-library-view="cards" aria-pressed="${libraryView==='cards'}">Bottles</button></div><label>Sort<select id="wl-sort">${[['recent','Recently added'],['name','Wine name'],['vintage','Newest vintage'],['country','Country / region']].map(([value,label])=>`<option value="${value}" ${value===librarySort?'selected':''}>${label}</option>`).join('')}</select></label><span>${visible.length} shown</span></div>` : ''}
    ${userId&&locations.length?`<label class="wl-location-filter">Saved Location<select id="wl-location"><option value="">All Saved Wines</option>${locations.map(l=>`<option value="${esc(l.name)}" ${l.name===libraryLocation?'selected':''}>${esc(l.name)} · ${l.count}</option>`).join('')}</select></label>`:''}
    ${userId&&items.length?originFilters('wl-origin',origins,libraryCountry,libraryRegion):''}
    ${userId&&!loading?missingPhotoTools(missing.length,missingPhotosOnly):''}
    ${notice ? `<p role="status" class="wl-notice">${esc(notice)} <button id="wl-retry" class="wl-text-button">Retry</button></p>` : ''}
    ${loading ? '<p class="wl-empty" role="status">Opening your Winebrary…</p>' : !userId ? `<div class="wl-empty wl-welcome"><span class="wl-lens-mark" aria-hidden="true">◎</span><h3>Good taste has a memory.</h3><p>Save a wine you love. Add another year. Make it yours.</p><button id="wl-start" class="wl-primary">Open my Winebrary ↗</button></div>` : visible.length ? libraryView==='rows' ? libraryRows(visible) : `<div class="wl-library-grid">${visible.map(w => `<article class="wl-bottle-card"><button class="wl-bottle-open" data-wine="${esc(w.id)}" data-row-id="${esc(w.id)}"><div class="wl-bottle-stage">${w.image_url ? `<img src="${esc(w.image_url)}" alt="${esc(w.wine_name)} bottle" loading="lazy">` : '<span class="wl-photo-placeholder">BOTTLE PHOTO<br>MISSING</span>'}<span class="wl-vintage">${esc(vintageLabel(w))}</span></div><div class="wl-bottle-copy"><p class="wl-kicker">${esc(w.metadata?.color || 'WINE')} · ${esc(w.region || 'YOUR COLLECTION')}</p><h3>${esc(w.wine_name)}</h3><p>${esc(w.producer || w.metadata?.grape || 'Explore this bottle')} <span>↗</span></p>${w.metadata?.image_source === 'generated' ? '<small>Studio rendering · reviewed by you</small>' : ''}</div></button>${!w.image_url?missingPhotoAction(w.id,w.wine_name,esc):''}</article>`).join('')}</div>` : `<div class="wl-empty"><h3>${missingPhotosOnly?'No missing photos here.':search||libraryCountry ? 'No bottles found.' : 'Your first bottle starts here.'}</h3><p>${missingPhotosOnly?'Your photos are ready. Show all wines to return to your collection.':search||libraryCountry ? 'Try another country, region or search.' : 'Add a new wine or bring a favorite over from the catalog.'}</p>${!missingPhotosOnly?'<button class="wl-primary" id="wl-first">Add a wine ↗</button>':''}</div>`}`;
  root.querySelector<HTMLSelectElement>('#wl-origin-country')?.addEventListener('change',e=>{libraryCountry=(e.target as HTMLSelectElement).value;libraryRegion='';render();root.querySelector<HTMLSelectElement>('#wl-origin-region')?.focus();});
  root.querySelector<HTMLSelectElement>('#wl-origin-region')?.addEventListener('change',e=>{libraryRegion=(e.target as HTMLSelectElement).value;render();root.querySelector<HTMLSelectElement>('#wl-origin-region')?.focus();});
  bindWinebrarySwipe(root);
  root.querySelector<HTMLSelectElement>('#wl-location')?.addEventListener('change',e=>{libraryLocation=(e.target as HTMLSelectElement).value;libraryCountry='';libraryRegion='';render();});
  root.querySelector('#wl-view-all')?.addEventListener('click',()=>{libraryLocation='';libraryCountry='';libraryRegion='';search='';missingPhotosOnly=false;librarySort='country';libraryView='rows';render();});
  root.querySelector('#wl-missing-photos')?.addEventListener('click',()=>{missingPhotosOnly=!missingPhotosOnly;render();root.querySelector<HTMLButtonElement>('#wl-missing-photos')?.focus();});
  root.querySelector('#wl-find-photos')?.addEventListener('click',()=>{const wines=missing.slice(0,10).flatMap(w=>items.find(item=>item.id===w.id)??[]);if(wines.length===1)photoStudio(wines[0]);else if(wines.length)window.dispatchEvent(new CustomEvent('sommni-polish-labels',{detail:{wines}}));});
  // Capture before thumbnail fallback replaces the failing image. Never erase the stored URL.
  root.querySelectorAll<HTMLImageElement>('[data-row-id] img').forEach(img=>{
    const row=img.closest<HTMLElement>('[data-row-id]'),wine=items.find(w=>w.id===row?.dataset.rowId),url=img.getAttribute('src');
    const failed=()=>{if(wine&&url&&libraryPhotos.fail(wine,url))queueMicrotask(()=>{if(root.isConnected)render();});};
    img.addEventListener('error',failed,{once:true});if(img.complete&&!img.naturalWidth)failed();
  });
  watchWinePhotos(root);
  root.querySelectorAll<HTMLDetailsElement>('[data-expand-wine]').forEach(el=>el.addEventListener('toggle',()=>{const id=el.dataset.expandWine!;if(el.open)expandedWines.add(id);else expandedWines.delete(id);}));
  root.querySelectorAll<HTMLButtonElement>('[data-edit-photo]').forEach(b=>b.onclick=()=>{const wine=items.find(w=>w.id===b.dataset.editPhoto);if(wine)photoStudio(wine);});
  root.querySelectorAll<HTMLButtonElement>('[data-polish-wine]').forEach(b=>b.onclick=()=>{const wine=items.find(w=>w.id===b.dataset.polishWine);if(wine)window.dispatchEvent(new CustomEvent('sommni-polish-labels',{detail:{wines:[wine]}}));});
  root.querySelectorAll<HTMLButtonElement>('[data-retry-bottle]').forEach(b=>b.onclick=()=>{const w=items.find(w=>w.id===b.dataset.retryBottle);if(w&&userId)void queueBottleArtwork(w,userId,true);});
  root.querySelectorAll<HTMLButtonElement>('[data-library-view]').forEach(b=>b.onclick=()=>{libraryView=b.dataset.libraryView as 'rows'|'cards';render();});
  root.querySelector<HTMLSelectElement>('#wl-sort')?.addEventListener('change',e=>{librarySort=(e.target as HTMLSelectElement).value;render();});
  root.querySelectorAll<HTMLButtonElement>('[data-edit-wine]').forEach(b=>b.onclick=()=>editWine(items.find(w=>w.id===b.dataset.editWine)));
  root.querySelectorAll<HTMLButtonElement>('[data-remove-wine]').forEach(b=>b.onclick=()=>{const wine=items.find(w=>w.id===b.dataset.removeWine);if(wine)removeWines([wine]);});
  if(arrivedWineId&&!loading){const row=[...root.querySelectorAll<HTMLElement>('[data-row-id]')].find(el=>el.dataset.rowId===arrivedWineId);if(row){highlightArrival(row);arrivedWineId=null;}}
  root.querySelector('#wl-add')!.addEventListener('click', () => requireAccount(() => window.dispatchEvent(new CustomEvent('sommni-add-wine'))));
  root.querySelector('#wl-first')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('sommni-add-wine')));
  root.querySelector('#wl-start')?.addEventListener('click', signIn);
  root.querySelector('#wl-retry')?.addEventListener('click', ()=>void refresh());
  root.querySelector('#wl-refresh')?.addEventListener('click', ()=>{libraryPhotos.reset();void refresh();});
  root.querySelector('#wl-artwork')?.addEventListener('click',()=>void artworkStatus());
  root.querySelectorAll<HTMLImageElement>('.wl-bottle-stage img').forEach(img => img.addEventListener('error', () => {
    const placeholder=document.createElement('span'); placeholder.className='wl-photo-placeholder'; placeholder.textContent='PHOTO UNAVAILABLE'; img.replaceWith(placeholder);
  }));
  root.querySelector<HTMLInputElement>('#wl-search')?.addEventListener('input', e => {
    search = (e.target as HTMLInputElement).value; render();
    const input = root.querySelector<HTMLInputElement>('#wl-search')!; input.focus();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-wine]').forEach(b => b.addEventListener('click', () => detail(items.find(w => w.id === b.dataset.wine)!)));
  const homeCount = document.getElementById('home-library');
  if (homeCount) homeCount.textContent = loading ? '—' : String(items.length);
  const accountButton = document.getElementById('wl-account')!;
  accountButton.textContent = isGuestLibrary() ? 'Link account ↗' : 'Account linked ✓';
}
function libraryRows(visible: LibraryWine[]) {
  let previousCountry='', previousRegion='';
  return `<div class="wl-swipe-hint"><span class="wl-swipe-arrow" aria-hidden="true">←</span><span>Swipe left for <strong>Edit · Remove</strong></span><small>Tap a wine for notes</small></div><div class="wl-compact-list bottle-row-list" aria-label="Your wines overview">${visible.map(w=>{
    const country=countryLabel(wineOrigin(w.metadata?.country,w.region).country), region=regionLabel(w.region,w.metadata?.country||'')||'Region not set';
    const divider=librarySort==='country'?`${country!==previousCountry?`<h3 class="wl-origin-divider">${esc(country)}</h3>`:''}${country!==previousCountry||region!==previousRegion?`<h4 class="wl-region-divider">${esc(region)}</h4>`:''}`:'';
    previousCountry=country;previousRegion=region;
    const year=w.vintage?String(w.vintage):w.metadata?.vintage_state==='non_vintage'?'NV':'—';
    const notes=referenceNotes(w.metadata?.tasting_notes||'');
    return `${divider}<article data-row-id="${esc(w.id)}" class="wl-compact-row"><div class="wl-swipe-dock" aria-hidden="true" inert><button data-edit-wine="${esc(w.id)}" aria-label="Edit ${esc(w.wine_name)}">Edit</button><button data-remove-wine="${esc(w.id)}" aria-label="Remove ${esc(w.wine_name)}">Remove</button><button data-close-actions aria-label="Close actions for ${esc(w.wine_name)}">×</button></div><div class="wl-swipe-content"><details data-expand-wine="${esc(w.id)}" ${expandedWines.has(w.id)?'open':''}><summary class="bottle-row-summary">${bottleRowCells({name:w.wine_name,producer:w.producer,photo:w.image_url,vintage:year,country:w.metadata?.country,region:w.region,variety:isSake(w)?w.metadata?.rice_variety:w.metadata?.grape,style:isSake(w)?[w.metadata?.sake_classification,w.metadata?.sake_style].filter(Boolean).join(' · '):w.metadata?.color,sake:isSake(w)})}</summary><div class="wl-row-expanded">${w.image_url?`<img class="wl-row-full-bottle" src="${esc(w.image_url)}" alt="${esc(w.wine_name)} bottle photograph" loading="lazy">`:''}<div class="wl-row-information"><dl>${[['Country',wineOrigin(w.metadata?.country,w.region).country],['State / province',wineOrigin(w.metadata?.country,w.region,w.metadata?.state).subdivision],[isSake(w)?'Prefecture / region':'Region',wineOrigin(w.metadata?.country,w.region).region],[isSake(w)?'Rice variety':'Grape',isSake(w)?w.metadata?.rice_variety:w.metadata?.grape],['Classification',w.metadata?.sake_classification],['Sake styles',w.metadata?.sake_style],['Style',w.metadata?.color],['Vintage',vintageLabel(w)],['Saved Locations',wineLocations(w).join(' · ')]].filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${bottleStatus(w)}${notes?`<p class="wl-row-note">${esc(notes.length>400?notes.slice(0,400)+'…':notes)}</p>`:''}<div class="wl-row-actions balanced-actions"><button data-wine="${esc(w.id)}">Tasting notes ↗</button><button data-edit-photo="${esc(w.id)}">Edit Bottle Photo</button></div></div></div></details>${!w.image_url?missingPhotoAction(w.id,w.wine_name,esc):''}<button class="wl-row-more" data-row-actions aria-label="Actions for ${esc(w.wine_name)}" aria-expanded="false">⋯</button></div></article>`;
  }).join('')}</div>`;
}
function removeWines(wines: LibraryWine[]) {
  if(!wines.length)return;const scope=userId;
  openDialog(`<p class="wl-kicker">YOUR WINEBRARY</p><h2>Remove ${wines.length===1?'this wine':`${wines.length} wines`}?</h2><ul class="wl-remove-list">${wines.map(w=>`<li>${esc(w.wine_name)} · ${esc(vintageLabel(w))}</li>`).join('')}</ul><p>This removes your personal entry from ${isGuestLibrary()?'this device':'your account'}. Shared bottle details and artwork stay in the collective catalog. Other vintages stay in your Winebrary.</p><button id="wl-confirm-remove" class="wl-primary">Remove ${wines.length===1?'wine':`${wines.length} wines`}</button><button id="wl-keep" class="wl-outline">Keep wine</button>`);
  dialog.querySelector('#wl-keep')!.addEventListener('click',()=>dialog.close());
  dialog.querySelector('#wl-confirm-remove')!.addEventListener('click',()=>void run(async()=>{
    const failed:string[]=[];let removed=0;
    for(const wine of wines){if(scope!==userId)return;try{await api(`/api/collection?id=${encodeURIComponent(wine.id)}`,'DELETE');removed++;}catch{failed.push(wine.wine_name);}}
    if(scope!==userId)return;await refresh();
    if(failed.length)feedback(`${removed} removed. Could not remove: ${failed.join(', ')}. Close this window and retry those wines.`);
    else dialog.close();
  }));
}
function editWine(wine?: Partial<LibraryWine>, newVintage = false) {
  const editing = !!wine?.id && !newVintage;
  const vintageState = newVintage ? 'year' : wine?.metadata?.vintage_state || (wine?.vintage ? 'year' : 'unknown');
  const field = (name: string, label: string, value: unknown = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  openDialog(`<p class="wl-kicker">${editing ? 'YOUR COLLECTION' : 'MAKE ROOM FOR SOMETHING GOOD'}</p><h2>${editing ? 'Edit this wine.' : newVintage ? 'Another year. New story.' : 'Add a wine.'}</h2>
    <form id="wl-wine-form"><div class="wl-form-grid">${field('wine_name','Wine name',wine?.wine_name,'required maxlength="300"')}${field('producer','Producer',wine?.producer,'maxlength="200"')}
    <label>Vintage<select name="vintage_state" aria-label="Vintage"><option value="year" ${vintageState==='year'?'selected':''}>Known year</option><option value="non_vintage" ${vintageState==='non_vintage'?'selected':''}>Non-vintage</option><option value="unknown" ${vintageState==='unknown'?'selected':''}>I don’t know yet</option></select></label>
    ${field('vintage','Year',newVintage ? '' : wine?.vintage,'type="number" min="1800" max="'+(new Date().getFullYear()+1)+'" step="1"')}
    </div><details class="wl-edit-extra" ${editing?'open':''}><summary>More details & notes · optional</summary><div class="wl-form-grid">${field('region','Region',wine?.region,'maxlength="200"')}${field('country','Country',wine?.metadata?.country,'maxlength="100"')}${field('grape','Grape',wine?.metadata?.grape,'maxlength="200"')}
    <label>Wine style<select name="color" aria-label="Wine style">${['','Red','White','Sparkling','Rose','Orange','Dessert','Sake'].map(c=>`<option ${c===(wine?.metadata?.color||'')?'selected':''}>${c||'Not sure yet'}</option>`).join('')}</select></label></div>${sakeFields(wine?.metadata||{})}
    <label>Saved Locations<textarea name="saved_locations" rows="2" maxlength="12000" placeholder="One restaurant or location per line">${esc(wineLocations({metadata:wine?.metadata||null}).join('\n'))}</textarea><small>For example: Runway 84 · Fort Lauderdale. Separate from where the wine is made.</small></label>
    <label>Your tasting notes<textarea name="notes" maxlength="2000" rows="3" placeholder="What made this bottle memorable?">${esc(newVintage ? '' : wine?.notes)}</textarea></label></details>
    <p class="wl-muted small">${newVintage ? 'This creates a separate entry. The previous year keeps its own notes and photo.' : 'Save now. We’ll look up a matching bottle photograph and prepare its transparent sprite.'}</p>
    ${shareWineControl('wl-share-master',!editing)}<button class="wl-primary" type="submit">${editing ? 'Save changes' : isGuestLibrary() ? 'Save locally to Winebrary' : 'Save to Winebrary'} ↗</button></form>`);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  bindSakeFields(form);
  const state = form.querySelector<HTMLSelectElement>('[name=vintage_state]')!;
  const year = form.querySelector<HTMLInputElement>('[name=vintage]')!;
  const syncYear = () => { year.disabled = state.value !== 'year'; year.required = state.value === 'year'; };
  syncYear(); state.addEventListener('change', syncYear);
  form.addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    const account = userId;
    const values = Object.fromEntries(new FormData(form));
    if(values.color==='Sake')values.grape='';
    const result = await api('/api/collection', editing ? 'PATCH' : 'POST', { ...values, metadata:{saved_locations:cleanLocations(String(values.saved_locations||'').split('\n'))}, ...(editing ? { id: wine!.id } : { wine_id: wine?.wine_id || null }) });
    if (account !== userId) return;
    const message=await finishWineArtwork(result.item,account!,true);
    if(account!==userId)return;arrivedWineId=result.item.id;setBusy(false); detail(result.item);feedback(message); await refresh();
  }); });
}
let disposePublicTasting:(()=>void)|undefined;
function detail(wine: LibraryWine) {
  wine={...wine,image_url:libraryPhoto(wine)||undefined};
  disposePublicTasting?.();
  const scope=userId;void (scope?localWineArtwork(wine,scope):Promise.resolve(wine)).catch(()=>wine);
  const anecdote=wine.wine_id?getCatalogAnecdote(wine.wine_id):undefined;
  openDialog(`<p class="wl-kicker">${esc(vintageLabel(wine))} · ${esc(wine.metadata?.color || 'WINE')}</p><h2>${esc(wine.wine_name)}</h2><p class="wl-muted">${esc([wine.producer, wine.region, wine.metadata?.country].filter(Boolean).join(' · '))}</p>
    ${bottleCaption(wine)}<div class="wl-detail-grid"><div class="wl-detail-photo">${wine.image_url ? `<img src="${esc(wine.image_url)}" alt="${esc(wine.wine_name)} bottle">` : '<span class="wl-photo-placeholder">YOUR BOTTLE<br>IN FOCUS<span>＋</span></span>'}</div><div><p class="wl-kicker">YOUR NOTES</p><p class="wl-notes">${esc(wine.notes || 'Add your first impression. This is your space.')}</p><p class="wl-muted small">${esc(isSake(wine)?sakeSummary(wine.metadata):wine.metadata?.grape || '')}</p><button id="wl-photo" class="wl-primary">${wine.image_url ? 'Change bottle image' : 'Add bottle photo'} ↗</button><button id="wl-edit" class="wl-outline">Edit wine</button><button id="wl-vintage" class="wl-outline">＋ Add another vintage</button></div></div>
    ${foodPairingsHtml({grape:wine.metadata?.grape,color:wine.metadata?.color})}
    ${wine.metadata?.tasting_notes ? `<p class="wl-kicker">REVIEWED REFERENCE NOTES</p><p class="wl-notes">${esc(referenceNotes(wine.metadata.tasting_notes))}</p><p class="wl-muted small">${(wine.metadata as any)?.reference_kind === 'catalogue' ? 'Catalogue reference notes; exact vintage unconfirmed.' : 'AI-assisted research, reviewed before saving.'} Your personal notes stay separate.</p>` : ''}
    ${anecdote?`<section class="wl-catalog-anecdote"><p class="wl-kicker">BEHIND THE WINE</p><h3>${esc(anecdote.title)}</h3><p class="wl-notes">${esc(anecdote.anecdote)}</p>${anecdoteSourcesHtml(anecdote)}</section>`:''}
    <div id="wl-wine-notes-export" class="wl-notes-export"></div>
    <div class="wl-hud-label"><span>EVEN G2 · DISPLAY PREVIEW</span><span>576 × 288</span></div><canvas id="wl-g2-preview" class="wl-hud-canvas" role="img" aria-label="Preview of this wine on the Even G2 display"></canvas>
    <p class="wl-muted small">Layout preview. Glasses use the built-in G2 typeface and green display.</p><button id="wl-send" class="wl-primary">Show on glasses ↗</button>
    <button id="wl-remove" class="wl-text-button">Remove from Winebrary</button>`);
  const community=document.createElement('section');dialog.append(community);disposePublicTasting=mountWineCommunity(community,auth,{ref:wine.wine_id||'',name:wine.wine_name,producer:wine.producer||'',vintage:wine.vintage?String(wine.vintage):wine.metadata?.vintage_state==='non_vintage'?'NV':'unknown'},()=>{dialog.close();void showAccountPairing()});dialog.addEventListener('close',()=>disposePublicTasting?.(),{once:true});
  void localizeNotes(dialog);
  mountWineNotesExport(dialog.querySelector<HTMLElement>('#wl-wine-notes-export')!,wine);
  void drawGlassesPreview(wine,dialog.querySelector<HTMLCanvasElement>('#wl-g2-preview')!);
  dialog.querySelector('#wl-edit')!.addEventListener('click', () => editWine(wine));
  dialog.querySelector('#wl-vintage')!.addEventListener('click', () => {dialog.close();window.dispatchEvent(new CustomEvent('sommni-add-wine',{detail:{query:[wine.producer,wine.wine_name].filter(Boolean).join(' ')}}));});
  dialog.querySelector('#wl-photo')!.addEventListener('click', () => photoStudio(wine));
  dialog.querySelector('#wl-send')!.addEventListener('click', () => run(async () => {
    if (!canShowWine()) throw new Error('Open sommNI in Even Hub and connect your G2 glasses first.');
    await showWineOnGlasses(wine); feedback('Wine sent to the Even Hub bridge.');
  }));
  dialog.querySelector('#wl-remove')!.addEventListener('click', () => removeWines([wine]));
}
function photoStudio(wine: LibraryWine, searchOnOpen=true) {
  let draft:ImageDraft|null=null,original:ImageDraft|null=null,options:import('./research/bottle-jobs').BottleCandidate[]=[],selected=-1,operation=0;
  const account=userId;
  openDialog(`<div class="bottle-studio-heading"><p class="wl-kicker">BOTTLE PHOTO</p><h2>Pick your bottle.</h2><p>${esc(wine.wine_name)}${wine.vintage?' · '+esc(wine.vintage):''}</p></div><div class="bottle-studio-tools"><button id="wl-search-photos" class="wl-outline" type="button">Search again</button>${bottlePhotoUpload('wl-file')}</div><p class="wl-muted small">Choose the closest label. The pictured year may differ.</p><div id="wl-photo-options"></div><p id="wl-photo-status" class="bottle-studio-status" role="status" aria-live="polite"></p><div id="wl-image-review" class="bottle-studio-preview"></div><div class="bottle-studio-save"><button id="wl-approve" class="wl-primary" hidden>Save bottle photo</button><button id="wl-cutout" class="wl-outline" hidden>Remove background</button></div><details class="bottle-studio-advanced"><summary>Photo options</summary><p>JPEG, PNG or WebP up to 15 MB. A full bottle on a plain background works best.</p><button id="wl-original" class="wl-text-button" hidden>Use original photo</button><button id="wl-render" class="wl-text-button" hidden>Create studio rendering</button><p>Studio rendering sends your selected photo to OpenAI. Check its label before saving.</p></details>`);
  bindBottlePhotoUpload(document,'wl-file');
  const studioRevision=dialogRevision,current=()=>account===userId&&studioRevision===dialogRevision&&dialog.open;
  const get=<T extends HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
  const status=(message:string)=>{if(current())get('wl-photo-status').textContent=message;};
  const preview=()=>{
    get('wl-image-review').innerHTML=draft?`<img src="${esc(draft.url)}" alt="Selected bottle photograph"><p><strong>✓ Selected</strong><br>${esc(draft.provenance?.vintage_binding||'Your photograph. Check the label and year.')}<br>Save to use it in your Winebrary and on glasses.</p>`:'';
    get('wl-approve').hidden=!draft;get('wl-cutout').hidden=!original||!!draft?.provenance;get('wl-original').hidden=!original||original===draft;get('wl-render').hidden=!original;
    if(draft)highlightArrival(get('wl-image-review'));
  };
  const renderOptions=()=>{
    get('wl-photo-options').innerHTML=photoChoices(options,selected);
    get('wl-photo-options').querySelectorAll<HTMLButtonElement>('[data-photo-option]').forEach(b=>b.onclick=()=>void run(async()=>{
      const token=++operation,choice=Number(b.dataset.photoOption),option=options[choice];if(!option)return;
      selected=choice;renderOptions();status('Removing the background from your chosen photo…');
      try{const next=await clipBottleCandidate(option);if(!current()||token!==operation)return;draft=next;original={url:option.photo,path:option.photo,source:'photograph'};preview();status('Ready. Save this bottle photo.');}
      catch(error){if(current()&&token===operation){selected=-1;renderOptions();status((error as Error).message+' Try another photo or upload yours.');}}
    }));
  };
  const search=async(refresh=false)=>{
    const token=++operation;get<HTMLButtonElement>('wl-search-photos').disabled=true;status('Finding up to 3 bottle photos…');
    try{const found=await findBottleCandidates(wine,artworkOwner()!,refresh);if(!current()||token!==operation)return;options=found;selected=-1;renderOptions();status(`${found.length} photo${found.length===1?'':'s'} found. Choose your closest match, or upload yours.`);}
    catch(error){if(current()&&token===operation)status((error as Error).message);}
    finally{if(current())get<HTMLButtonElement>('wl-search-photos').disabled=false;}
  };
  get('wl-search-photos').onclick=()=>void search(true);
  get<HTMLInputElement>('wl-file').onchange=event=>{const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;void run(async()=>{
    const token=++operation;status('Preparing your photo…');
    try{const photo=await photoData(file);if(!current()||token!==operation)return;selected=-1;renderOptions();draft=original={url:photo,path:photo,source:'photograph'};preview();status('Your photo is ready. Save it now or remove its background.');}
    catch(error){status((error as Error).message);}finally{input.value='';}
  });};
  get('wl-cutout').onclick=()=>void run(async()=>{if(!original)return;const token=++operation;status('Removing the background…');try{const next=await createBottleCutout(original.url);if(!current()||token!==operation)return;draft=next;preview();status('Transparent bottle ready to save.');}catch(error){status((error as Error).message+' Your original is still selected and can be saved.');}});
  get('wl-original').onclick=()=>{draft=original;preview();status('Original selected.');};
  get('wl-render').onclick=()=>void run(async()=>{if(!original)return;const token=++operation;status('Creating a studio rendering…');try{const result=await betaProvider({action:'studio',photo:original.url});if(!current()||token!==operation)return;draft=result.draft;preview();status('Check the label and year before saving.');}catch(error){status((error as Error).message);}});
  get('wl-approve').onclick=()=>void run(async()=>{
    if(!draft)return;const token=++operation;status('Saving your bottle photo…');
    try{const photo=await inlineBottle(draft);if(!current()||token!==operation)return;
      const result=await researchAction({action:'attach_bottle',collection_id:wine.id,expected:bottleIdentity(wine),only_if_missing:false,photo,provenance:draft.provenance});if(!current())return;
      const message=await finishWineArtwork(result.item,account!,true);if(!current())return;
      window.dispatchEvent(new CustomEvent('sommni-bottle-photo-saved',{detail:{wine:result.item}}));
      arrivedWineId=result.item.id;setBusy(false);detail(result.item);feedback(message);await refresh();
    }catch(error){status((error as Error).message+' Your selected photo is still here; try Save again.');}
  });
  if(searchOnOpen)void search();else status('Upload a bottle photo or take one with your camera.');
}

async function artworkStatus(){
 const scope=artworkOwner(),rows=await artworkStore<any[]>('getAll'),uploads=rows.filter((r):r is WineSubmission=>r.kind==='submission'&&r.scope===scope),pending=uploads.filter(r=>r.state==='pending');
 const ids=[...new Set(allCatalogWines().map(w=>w.legacyId).filter((id):id is string=>!!id))];
 const keys=(await Promise.all(ids.map(id=>bottleCacheKey(bottleImageUrl(import.meta.env.BASE_URL,id))))).filter((key):key is string=>!!key);
 const counts=(saved:any[])=>{const existing=new Set(saved.filter(r=>r.blob&&r.scope==='catalog').map(r=>r.id));return {photos:keys.filter(key=>existing.has(key)).length,sprites:keys.filter(key=>existing.has(stageCacheKey(key,100,240))).length}};
 const {photos,sprites}=counts(rows);
 openDialog(`<p class="wl-kicker">ON YOUR DEVICE · IN OUR REVIEW QUEUE</p><h2>Bottles that stay with you.</h2><p><span id="wl-cache-count">${photos}/${ids.length} catalog photos and ${sprites}/${ids.length} G2 sprites saved locally.</span> Your added bottle artwork is stored with your own Winebrary.</p><button id="wl-cache-catalog" class="wl-primary">Save all ${ids.length} catalog bottles & sprites offline ↓</button><p class="wl-muted small">About 35 MB, plus sprites. Photos are also saved as you browse. Browser data clearing removes offline copies; keep a library backup.</p><h3>Master Winebrary submissions</h3><p>${pending.length} waiting to upload · ${uploads.length-pending.length} received for review</p>${uploads.slice(-8).reverse().map(row=>`<p><strong>${esc(row.name)}</strong> · ${row.state==='sent'?'Received for review':esc(row.error||'Waiting for a connection')}</p>`).join('')}<button id="wl-retry-uploads" class="wl-outline">Retry pending uploads ↗</button><p class="wl-muted small">Added wine details and bottle artwork are sent for review. Personal notes and ratings stay private. Received does not mean published.</p>`);
 dialog.querySelector('#wl-retry-uploads')!.addEventListener('click',()=>void run(async()=>{await retryWineContributions();setBusy(false);await artworkStatus();}));
 dialog.querySelector('#wl-cache-catalog')!.addEventListener('click',()=>void run(async()=>{
  await navigator.storage?.persist?.().catch(()=>false);let completed=0,failed=0;
  for(let i=0;i<ids.length;i+=3){await Promise.all(ids.slice(i,i+3).map(async id=>{try{const source=bottleImageUrl(import.meta.env.BASE_URL,id);await bottlePhoto(source);await stageCanvas(source,100,240);}catch{failed++;}finally{completed++;feedback(`Preparing offline artwork · ${completed}/${ids.length}`)}}));}
  const {photos,sprites}=counts(await artworkStore<any[]>('getAll'));
  dialog.querySelector('#wl-cache-count')!.textContent=`${photos}/${ids.length} catalog photos and ${sprites}/${ids.length} G2 sprites saved locally.`;
  feedback(photos===ids.length&&sprites===ids.length?'All catalog bottle photos and G2 sprites are saved on this device.':`${photos}/${ids.length} photos and ${sprites}/${ids.length} sprites saved. ${failed?'Some images could not be fetched.':'Device storage may be full.'} Tap again to retry.`);
 }));
}
export function initWinebrary() {
  setArtworkOwner(userId);
  root = document.getElementById('winebrary-content')!;
  document.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-library-notes]');if(button){const wine=items.find(w=>w.id===button.dataset.libraryNotes);if(wine)detail(wine);}});
  window.addEventListener('sommni-manual-wine',()=>requireAccount(()=>editWine()));
  initLabelReview(root);
  window.addEventListener('sommni-upload-bottle-photo',event=>{const wine=items.find(w=>w.id===(event as CustomEvent).detail?.id);if(wine)photoStudio(wine,false);});
  initBottleJobs(async()=>(await api('/api/collection?limit=500')).items);
  window.addEventListener('sommni-bottle-status',()=>{void bottleJobStatuses().then(status=>{bottleStatuses=status;render();});});
  window.addEventListener('winelens-research-saved', event => { arrivedWineId=(event as CustomEvent).detail?.id||null; void refresh(); });
  // The glasses read the same in-memory collection; an error only counts when nothing loaded.
  setLibrarySource(() => ({ userId, loading, error: items.length ? '' : notice, items }));
  dialog = document.createElement('dialog'); dialog.className='wl-dialog'; dialog.setAttribute('aria-label','Winebrary'); document.body.append(dialog);
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  initAccountPairing();
  document.getElementById('wl-account')!.addEventListener('click',()=>void showCloudAccount());
  document.querySelectorAll('[data-wl-add]').forEach(el=>el.addEventListener('click',()=>requireAccount(()=>window.dispatchEvent(new CustomEvent('sommni-add-wine')))));
  document.querySelectorAll<HTMLElement>('[data-open-tab]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();document.querySelector<HTMLButtonElement>(`.tab[data-tab="${el.dataset.openTab}"]`)?.click();}));
  document.addEventListener('click', e => {
    const button=(e.target as HTMLElement).closest<HTMLElement>('[data-save-library]'); if (!button) return;
    const found=lookupWineById(button.dataset.saveLibrary);
    if (!found) return; // unknown catalog ID: never save it as some other wine
    // Personal notes start empty: catalog tasting notes are attributed reference text, not the user's observations.
    requireAccount(()=>editWine({ wine_name:found.wine.name, wine_id:found.id, region:found.wine.region, notes:'', metadata:{color:found.type,country:found.country,grape:found.wine.grape,vintage_state:'unknown'} }));
  });
  auth.auth.onAuthStateChange((_event, session) => {
    const next=session?.user.id || (FREE_BETA?'beta-local':null);
    if (next === userId) return;
    window.dispatchEvent(new Event('sommni-library-account-changing'));
    const previous=userId;setArtworkOwner(next);
    if (previous) {  void clearPrivateGlasses().catch(console.error); if(previous!=='beta-local')void clearLibraryCache(); if(previous!=='beta-local')void forgetAccount(previous).catch(console.error); }
    // Study progress follows the account: the previous owner's reviews leave memory before the next log loads.
    setStudyAuth(session ? { userId: session.user.id, token: () => auth.auth.getSession().then(r => r.data.session?.access_token ?? null) } : null);
    void useAccount(next==='beta-local'?null:next).then(() => { if (session) setTimeout(() => void syncStudy(), 0); });
    dialogRevision++;
    userId=next; items=[]; search=''; libraryLocation=''; libraryCountry=''; libraryRegion=''; missingPhotosOnly=false;libraryPhotos.reset(); expandedWines.clear(); arrivedWineId=null; generation++; loading=false;
    // Do not await Supabase requests inside its auth callback.
    dialog.close(); setBusy(false); render(); setTimeout(()=>void refresh(),0);
  });
  // Website saves use the same collection. Refresh when returning to the companion,
  // and while it remains visible, without disrupting an open editor or notes page.
  const refreshLinked=()=>{if(userId&&userId!=='beta-local'&&!loading&&!busy&&document.visibilityState==='visible'&&!document.querySelector('dialog[open]'))void refresh(true);};
  window.addEventListener('focus',refreshLinked);
  window.addEventListener('online',refreshLinked);
  document.addEventListener('visibilitychange',refreshLinked);
  window.addEventListener('sommni-library-refresh-request',refreshLinked);
  window.setInterval(refreshLinked,60_000);
  render(); void refresh();
  // Guided setup offers account linking without interrupting first-time exploration.
  void auth.auth.getSession().then(({data:{session}})=> {
    if (!session || session.user.id === userId) return;
    userId=session.user.id;setArtworkOwner(userId); void refresh();
    setStudyAuth({ userId: session.user.id, token: () => auth.auth.getSession().then(r => r.data.session?.access_token ?? null) });
    void useAccount(session.user.id).then(() => void syncStudy());
  });
}
