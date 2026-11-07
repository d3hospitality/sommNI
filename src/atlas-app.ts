import {locateWine,resolveWineFocus} from './atlas/wine-focus';
import {loadBoundaries} from './atlas/coverage';
import japanPrefectures from './data/japan-prefecture-regions.json';
import { prefectureKey } from './sake';
import { announceWineContext, catalogContext, libraryContext, libraryPhoto } from './wine-context';
import { placeSearchScore } from './atlas/place-search';
import { wineRegionRows, wineRegionFor, wineRegionById } from './atlas/wine-regions';
import { AtlasVoiceCapture, type CaptureState } from './atlas/voice-capture';
import { betaProvider } from './beta/client';
import { getLocale } from './intelligence/client';
import { openPlaceGlasses } from './intelligence/glasses';
// ═══════════════════════════════════════════════════════════════════
// Wine Atlas inside sommNI — integration layer around src/atlas/ (Codex's module).
//
//  • Home › Wine Atlas: AtlasGlasses owns the display and its events until double tap
//    from the country list returns Home. Its own serial transport is the only sender
//    while it is active; the app image queue is idle before it opens.
//  • Catalog country lists: the static globe becomes a live one. The renderer paints the
//    hovered country and the frame goes through the app-wide image queue (no second transport).
//  • Phone takeovers (Study, Winebrary) claim the display, which awaits Atlas close().
//
// Geography note: regions are winerymap point clusters, not appellation boundaries.
// Catalog browsing stays country → grape → wine until region mappings are reviewed.
// ═══════════════════════════════════════════════════════════════════

import { OsEventTypeList, RebuildPageContainer, TextContainerProperty, type EvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { GlobeRenderer, type AtlasData, type Country, type Region } from './atlas/renderer';
import { AtlasNavigator } from './atlas/navigator';
import { AtlasGlasses } from './atlas/glasses';
import { claimDisplay, dropDisplay } from './display';
import { rebuildGlassesPage, invalidateImages, imageIdle, currentImageEpoch, pushGrayImage, pushLogoToGlasses, sendSerial, pushTastingNotesImages } from './image-utils';
import { rebuildHomePage, buildTastingNotesPage } from './pages';
import { allCatalogWines, lookupWineById, catalogPhoto, type CatalogWine } from './identity';
import { readLibrary, showWineFromAtlas, vintageShort, setWinePlacer, setWineSceneBuilder, setPlaceSceneBuilder, fallbackPlace, type WinePlace } from './winebrary-glasses';
import { planWineScene, type ScenePlan } from './wine-scene';
import { TYPE_DISPLAY } from './constants';
import type { LibraryWine } from './winebrary';
import regionLinks from './data/atlas-region-links.json';

let bridge: EvenAppBridge | null = null;
let baseUrl = '';
let rendererPromise: Promise<GlobeRenderer> | null = null;
let glasses: AtlasGlasses | null = null;
let navigator: CatalogAtlasNavigator | null = null;
let active = false;

export interface AtlasStatus { active: boolean; mode: string; country: string; region: string | null; error: string | null }
let lastError: string | null = null;

let listening = false;
export function connectAtlasGlasses(b: EvenAppBridge, url: string): void {
  bridge = b; baseUrl = url;
  if (!listening) { listening = true; window.addEventListener('winelens-library-changed', () => { void atlasLibraryChanged(); }); window.addEventListener('sommni-catalog-updated', () => { void atlasLibraryChanged(); }); window.addEventListener('pagehide',()=>{void cancelAtlasVoice(false).catch(console.warn);}); }
  // My Winebrary browses Red/White… › country › region with the same placement as the Atlas,
  // and its detail page draws the wine's map scene.
  setWinePlacer(placeLibraryWines);
  setWineSceneBuilder(libraryWineScene);
  setPlaceSceneBuilder(placeScene);
}
/** Regions list → the country; wines list → the region glowing inside it (no bottle). */
async function placeScene(countryName: string, regionName: string | null): Promise<ScenePlan | null> {
  const renderer = await loadAtlasRenderer();
  const country = renderer.data.countries.find(c => c.name === countryName) ?? countryByAnyName(renderer, countryName);
  if (!country) return null;
  const focus=resolveWineFocus(renderer.data,await loadBoundaries().catch(()=>({countries:{},regions:[]})),{country:country.name,region:regionName});
  return planWineScene(renderer,{country,region:focus?.cluster??null,context:focus?.boundary??null,imageUrl:null});
}

/** Type › country › region for Winebrary wines, using the Atlas's places (country names from the map). */
async function placeLibraryWines(wines: LibraryWine[]): Promise<Map<string, WinePlace>> {
  let renderer: GlobeRenderer | null = null;
  try { renderer = await loadAtlasRenderer(); } catch { renderer = null; }
  const links = linkTable();
  const out = new Map<string, WinePlace>();
  for (const wine of wines) {
    const base = fallbackPlace(wine);
    const twin = wine.wine_id ? lookupWineById(wine.wine_id) : null;
    const type = twin ? TYPE_DISPLAY[twin.type] : base.type;
    if (!renderer) { out.set(wine.id, { ...base, type }); continue; }
    const placed = placeLibraryWine(renderer, links, wine);
    out.set(wine.id, {
      type,
      country: placed.country?.name ?? (twin?.country || base.country),
      region: placed.regions[0]?.name ?? (placed.place || base.region),
      mapped: !!placed.country,
    });
  }
  return out;
}
async function libraryWineScene(wine: LibraryWine): Promise<ScenePlan | null> {
  const renderer = await loadAtlasRenderer();
  const placed = placeLibraryWine(renderer, linkTable(), wine);
  if (!placed.country) return null;
  const twin=lookupWineById(wine.wine_id),focus=resolveWineFocus(renderer.data,await loadBoundaries().catch(()=>({countries:{},regions:[]})),{country:wine.metadata?.country||twin?.country,region:wine.region||twin?.wine.region,state:wine.metadata?.state});
  return planWineScene(renderer,{country:placed.country,region:focus?.cluster??placed.regions[0]??null,context:focus?.boundary??null,imageUrl:libraryPhoto(wine)});
}

/** Catalog browsing shares the Winebrary bottle-over-origin renderer. */
export async function catalogBrowseScene(wineId: string | null, country: string): Promise<ScenePlan | null> {
  const item = lookupWineById(wineId);
  if (!item) return placeScene(country, null);
  return libraryWineScene({id:item.id,wine_id:item.id,wine_name:item.wine.name,producer:null,vintage:null,notes:null,region:item.wine.region,metadata:{country:item.country},image_url:catalogPhoto(item.id,baseUrl)||undefined});
}

/** Map data is ~1 MB: load it once, on first use (Atlas entry or first country list). */
export function loadAtlasRenderer(): Promise<GlobeRenderer> {
  if (!rendererPromise) {
    const root = baseUrl || new URL('./', location.href).href;
    rendererPromise = GlobeRenderer.load(new URL('atlas/', root).href).then(renderer=>{renderer.data.regions=[...renderer.data.regions.filter(r=>r.country!=='JPN'),...japanPrefectures as Region[]];const japan=renderer.data.countries.find(c=>c.code==='JPN');if(japan)japan.regionCount=47;return renderer;});
    rendererPromise.catch(() => { rendererPromise = null; });
  }
  return rendererPromise;
}

export function atlasStatus(): AtlasStatus {
  return {
    active,
    mode: navigator?.mode ?? 'countries',
    country: navigator?.country.name ?? '',
    region: navigator && navigator.mode !== 'countries' ? navigator.region?.name ?? null : null,
    error: lastError,
  };
}
/** Foreground lifecycle keeps the cursor while stopping queued Atlas frames. */
export async function pauseAtlasGlasses(): Promise<void> { await cancelAtlasVoice(false); await glasses?.close(); }
export async function resumeAtlasGlasses(): Promise<void> { if (active) await glasses?.open(); }
function announce(): void {
  if(active&&navigator){const entry=navigator.mode==='detail'&&!navigator.infoSelected?navigator.wines[navigator.wineIndex]:null;announceWineContext(entry?(entry.kind==='catalog'?catalogContext(entry.item):libraryContext(entry.wine)):{title:navigator.mode==='countries'?'Explore '+navigator.country.name:navigator.region?.name||navigator.country.name,country:navigator.country.name,region:navigator.mode==='countries'?null:navigator.view.region?.name});}
  window.dispatchEvent(new CustomEvent('winelens-atlas-change', { detail: atlasStatus() })); }
function fail(error: Error): void { lastError = error.message; console.error('[Atlas] ' + error.message); announce(); }

async function release(): Promise<void> {
  if (!glasses) return;
  active = false;
  await cancelAtlasVoice(false);
  try { await glasses.close(); } finally { announce(); }
}

/** Double tap on the country list: Atlas has already closed its transport. */
async function exitToHome(): Promise<void> {
  active = false; dropDisplay('atlas'); announce();
  if (!bridge) return;
  if (!await rebuildGlassesPage(bridge, rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}

// All mapped places remain reachable for learning. Saved wines mark coverage;
// catalog and personal wines are attached to their source groups without gating history.
interface RegionLink { region: string; clusters: string[]; link: string; review: string; note: string }
/** A wine listed in a region view: one of yours (Winebrary) or one from the sommNI catalog. */
export type AtlasEntry = { kind: 'library'; wine: LibraryWine } | { kind: 'catalog'; item: CatalogWine };
export interface CatalogAtlas {
  data: AtlasData; countries: Country[];
  /** Catalog wines per country code. */
  countryWines: Map<string, number>;
  /** Wines per atlas region id, yours first. */
  entries: Map<string, AtlasEntry[]>;
  mineByRegion: Map<string, number>; mineByCountry: Map<string, number>;
  /** Region rows without map geometry (a catalog/Winebrary place with no linked cluster). */
  unmapped: Set<string>;
  unlinked: string[];
}

const ISO2: Record<string, string> = { US: 'USA', FR: 'FRA', IT: 'ITA', ES: 'ESP', PT: 'PRT', DE: 'DEU', AT: 'AUT', NZ: 'NZL', ZA: 'ZAF', LB: 'LBN', AU: 'AUS', AR: 'ARG', CL: 'CHL', GR: 'GRC', CY: 'CYP', MX: 'MEX', HU: 'HUN', GB: 'GBR', UK: 'GBR', CA: 'CAN', CH: 'CHE', IL: 'ISR', GE: 'GEO', UY: 'URY', BR: 'BRA', SI: 'SVN', HR: 'HRV', RO: 'ROU', MD: 'MDA', CN: 'CHN', JP: 'JPN' };
const norm = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const linkTable = () => new Map((regionLinks as { links: RegionLink[] }).links.map(l => [l.region, l]));

function countryByAnyName(renderer: GlobeRenderer, raw: string | null | undefined): Country | null {
  if (!raw) return null;
  const text = raw.trim();
  const code = ISO2[text.toUpperCase()] ?? (text.length === 3 ? text.toUpperCase() : null);
  if (code) { const hit = renderer.data.countries.find(c => c.code === code); if (hit) return hit; }
  return atlasCountryFor(renderer, text) ?? renderer.data.countries.find(c => norm(c.name) === norm(text)) ?? null;
}

/** Where a Winebrary wine sits: its catalog twin if saved from the catalog, else its own region/country text. */
function placeLibraryWine(renderer: GlobeRenderer, links: Map<string, RegionLink>, wine: LibraryWine): { country: Country | null; regions: Region[]; place: string } {
  const twin=lookupWineById(wine.wine_id),origin={country:wine.metadata?.country||twin?.country,region:wine.region||twin?.wine.region,state:wine.metadata?.state};
  const found=locateWine(renderer.data,origin);
  return {country:found.country,regions:found.cluster?[found.cluster]:[],place:found.origin.region||found.origin.subdivision};
}

export function catalogAtlas(renderer: GlobeRenderer, libraryItems: LibraryWine[] = []): CatalogAtlas {
  const links = linkTable();
  const countryWines = new Map<string, number>(), mineByRegion = new Map<string, number>(), mineByCountry = new Map<string, number>();
  const regions = new Map<string, Region>(renderer.data.regions.map(r=>[r.id,r])), unmapped = new Set<string>(), unlinked = new Set<string>();
  const mine = new Map<string, AtlasEntry[]>(), catalog = new Map<string, AtlasEntry[]>();
  const push = (map: Map<string, AtlasEntry[]>, id: string, entry: AtlasEntry) => map.set(id, [...(map.get(id) ?? []), entry]);
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  // A place with no linked cluster still gets a row, so every wine can be found. No geometry is invented:
  // the view frames the country and draws no winery dots.
  const placeRow = (country: Country, place: string): Region => {
    const name = place || 'Other wines';
    const id = `place:${country.code}:${norm(name)}`;
    let row = regions.get(id);
    if (!row) {
      row = { id, name, sourceKey: '', country: country.code, center: country.center, radius: 5, points: [], count: 0, geometryKind: 'winery-cluster' };
      regions.set(id, row); unmapped.add(id);
    }
    return row;
  };
  for (const item of allCatalogWines()) {
    const country = atlasCountryFor(renderer, item.country);
    if (!country) continue;
    bump(countryWines, country.code);
    let linked = (links.get(item.wine.region)?.clusters ?? [])
      .map(name => renderer.data.regions.find(r => r.name === name && r.country === country.code))
      .filter((r): r is Region => !!r);
    if(!linked.length&&country.code==='JPN')linked=renderer.data.regions.filter(r=>r.country==='JPN'&&prefectureKey(r.name)===prefectureKey(item.wine.region));
    if (!linked.length) { unlinked.add(item.wine.region); linked = [placeRow(country, item.wine.region.split(',')[0].trim())]; }
    for (const r of linked) { regions.set(r.id, r); push(catalog, r.id, { kind: 'catalog', item }); }
  }
  for (const wine of libraryItems) {
    const placed = placeLibraryWine(renderer, links, wine);
    if (!placed.country) continue;           // no country: stays in My Winebrary only
    bump(mineByCountry, placed.country.code);
    const rows = placed.regions.length ? placed.regions : [placeRow(placed.country, placed.place)];
    for (const r of rows) { regions.set(r.id, r); push(mine, r.id, { kind: 'library', wine }); bump(mineByRegion, r.id); }
  }
  const entries = new Map<string, AtlasEntry[]>();
  for (const id of regions.keys()) entries.set(id, [...(mine.get(id) ?? []), ...(catalog.get(id) ?? [])]);
  // Broad wine regions stay visible above appellations, without losing the precise rows.
  const uniqueEntries = [...new Map([...entries.values()].flat().map(entry => [
    entry.kind === 'catalog' ? 'catalog:'+entry.item.id : 'library:'+entry.wine.id, entry,
  ])).values()];
  for (const area of wineRegionRows(renderer.data)) {
    const wines = uniqueEntries.filter(entry => {
      const twin = entry.kind === 'catalog' ? entry.item : lookupWineById(entry.wine.wine_id);
      const country = twin?.country ?? (entry.kind === 'library' ? entry.wine.metadata?.country ?? entry.wine.region?.split(',')[1] ?? '' : '');
      const place = twin?.wine.region ?? (entry.kind === 'library' ? entry.wine.region ?? '' : '');
      return wineRegionFor(country, place)?.id === area.id;
    });
    regions.set(area.id, area); entries.set(area.id, wines);
    mineByRegion.set(area.id, wines.filter(w=>w.kind==='library').length);
  }
  const countries = renderer.data.countries
    .filter(c => (countryWines.get(c.code) ?? 0) > 0 || (mineByCountry.get(c.code) ?? 0) > 0)
    .sort((a, b) => ((mineByCountry.get(b.code) ?? 0) - (mineByCountry.get(a.code) ?? 0)) || ((countryWines.get(b.code) ?? 0) - (countryWines.get(a.code) ?? 0)) || a.name.localeCompare(b.name));
  return { data: { ...renderer.data, regions: [...regions.values()] }, countries, countryWines, entries, mineByRegion, mineByCountry, unmapped, unlinked: [...unlinked].sort() };
}

const entryLabel = (e: AtlasEntry) => e.kind === 'library' ? [e.wine.wine_name, vintageShort(e.wine)].filter(Boolean).join(' ') : e.item.wine.name;

type AtlasMenuKind='search'|'scope'|'clear'|'info'|'country'|'region'|'all';
type AtlasMenuItem={kind:AtlasMenuKind;label:string;id?:string};
export class CatalogAtlasNavigator extends AtlasNavigator {
  wineIndex=0;
  infoSelected=false;
  pendingPlace:false|{country:string;region:string|null}=false;
  pending:AtlasEntry|null=null;
  pendingSearch=false;
  query='';
  searchMessage='';
  showAllRegions=false;
  wineAreaId:string|null=null;
  private allAreaWines=false;
  private menuAction:AtlasMenuKind|null=null;
  constructor(private scope:CatalogAtlas,public signedIn:boolean){super(scope.data);this.countries=scope.countries;}
  setScope(scope:CatalogAtlas,signedIn:boolean):void {
    const code=this.country?.code,regionId=this.region?.id,mode=this.mode;
    this.scope=scope;this.data=scope.data;this.countries=scope.countries;this.signedIn=signedIn;
    this.countryIndex=Math.max(0,this.countries.findIndex(c=>c.code===code));
    const index=this.regions.findIndex(r=>r.id===regionId);this.regionIndex=Math.max(0,index);
    if(mode==='detail'&&index<0&&!(this.allAreaWines&&scope.entries.has(this.wineAreaId??''))){this.mode='regions';this.infoSelected=false;this.menuAction=null;}
    this.wineIndex=Math.min(this.wineIndex,Math.max(0,this.wines.length-1));
  }
  chooseCountry(code:string):void {this.wineAreaId=null;this.allAreaWines=false;super.chooseCountry(code);this.query='';this.searchMessage='';this.showAllRegions=false;this.menuAction=null;this.infoSelected=false;this.wineIndex=0;}
  chooseRegion(id:string):void {
    this.query='';
    if(wineRegionById(id)){this.wineAreaId=id;this.allAreaWines=false;this.mode='regions';this.regionIndex=0;this.menuAction='all';this.infoSelected=false;return;}
    if(!(this.scope.entries.get(id)?.length))this.showAllRegions=true;super.chooseRegion(id);this.menuAction=null;this.infoSelected=true;this.wineIndex=0;
  }
  get region():Region|undefined{return this.allAreaWines&&this.wineAreaId?this.scope.data.regions.find(r=>r.id===this.wineAreaId):super.region;}
  get view(){return this.mode==='regions'&&(this.menuAction||this.infoSelected)?{country:this.country,...(this.wineAreaId?{region:this.scope.data.regions.find(r=>r.id===this.wineAreaId)}:{})}:super.view;}
  get wines():AtlasEntry[]{return this.region?this.scope.entries.get(this.region.id)??[]:[];}
  private count(region:Region){return this.scope.entries.get(region.id)?.length??0;}
  get regions():Region[]{
    let list=super.regions;if(!this.scope)return list;
    list=list.filter(r=>wineRegionById(r.id)||!wineRegionFor(r.country,r.name)||!['bordeaux','burgundy','bourgogne'].includes(norm(r.name)));
    if(this.wineAreaId){
      const area=this.wineAreaId;
      const entryIds=new Set((this.scope.entries.get(area)??[]).map(e=>e.kind==='catalog'?'catalog:'+e.item.id:'library:'+e.wine.id));
      list=list.filter(r=>!wineRegionById(r.id)&&wineRegionFor(r.country,r.name)?.id===area&&
        !['bordeaux','burgundy','bourgogne'].includes(norm(r.name)));
      list=list.filter(r=>!(this.scope.entries.get(r.id)?.length)||(this.scope.entries.get(r.id)??[]).some(e=>entryIds.has(e.kind==='catalog'?'catalog:'+e.item.id:'library:'+e.wine.id)));
    }else if(!this.query){list=list.filter(r=>!!wineRegionById(r.id)||!wineRegionFor(r.country,r.name));}
    return list.filter(r=>this.query?placeSearchScore(r.name,this.query,this.country.name)>0:this.showAllRegions||this.count(r)>0)
      .sort((a,b)=>Number(this.count(b)>0)-Number(this.count(a)>0)||(this.query?placeSearchScore(b.name,this.query,this.country.name)-placeSearchScore(a.name,this.query,this.country.name):0)||Number(!!wineRegionById(b.id))-Number(!!wineRegionById(a.id))||(this.scope.mineByRegion.get(b.id)??0)-(this.scope.mineByRegion.get(a.id)??0)||this.count(b)-this.count(a)||a.name.localeCompare(b.name));
  }
  get title(){return this.mode==='countries'?'WINE ATLAS':(wineRegionById(this.wineAreaId??'')?.name??this.country.name)+(this.query?' · SEARCH':'');}
  get labels():string[]{return this.mode==='countries'?this.countries.map(c=>c.name):this.regions.map(r=>`${this.count(r)}w · ${r.name}`);}
  private get menu():AtlasMenuItem[]{
    const entries:AtlasMenuItem[]=[{kind:'search',label:'Search by voice'}];
    if(this.mode==='regions'&&this.wineAreaId&&!this.query)entries.push({kind:'all',label:'View all wines · '+(this.scope.entries.get(this.wineAreaId)?.length??0)});
    if(this.mode==='countries')entries.push(...this.countries.filter(c=>!this.query||placeSearchScore(c.name,this.query,c.code)>0).map(c=>({kind:'country' as const,id:c.code,label:c.name})));
    else entries.push(...this.regions.map(r=>({kind:'region' as const,id:r.id,label:this.count(r)?`${this.count(r)}w · ${r.name}`:`/ ${r.name}`})));
    if(this.query)entries.push({kind:'clear',label:'Clear search'});
    else if(this.mode==='regions')entries.push({kind:'scope',label:this.showAllRegions?'Only regions with wines':'All regions & history'});
    if(this.mode==='regions')entries.push({kind:'info',label:'About '+(wineRegionById(this.wineAreaId??'')?.name??this.country.name)});
    return entries;
  }
  private get cursor(){const id=this.mode==='countries'?this.country.code:this.region?.id;return Math.max(0,this.menu.findIndex(item=>this.menuAction?item.kind===this.menuAction:item.id===id));}
  private focus(item:AtlasMenuItem){
    this.infoSelected=false;this.searchMessage='';
    if(item.kind==='country'){this.countryIndex=this.countries.findIndex(c=>c.code===item.id);this.regionIndex=0;this.menuAction=null;}
    else if(item.kind==='region'){this.regionIndex=this.regions.findIndex(r=>r.id===item.id);this.menuAction=null;}
    else{this.menuAction=item.kind;this.infoSelected=item.kind==='info';}
  }
  search(text:string){
    if(!text.trim()){this.searchMessage='No speech heard. Tap to retry.';this.menuAction='search';return;}
    // A region spoken at the country menu should not fail just because it is not a country.
    if(this.mode==='countries'&&!this.countries.some(c=>placeSearchScore(c.name,text,c.code)>0)){
      const hits=this.scope.data.regions.filter(r=>placeSearchScore(r.name,text,this.countries.find(c=>c.code===r.country)?.name??'')>0)
        .sort((a,b)=>placeSearchScore(b.name,text)-placeSearchScore(a.name,text)||this.count(b)-this.count(a));
      const hit=hits[0],countryIndex=hit?this.countries.findIndex(c=>c.code===hit.country):-1;
      if(countryIndex>=0){this.countryIndex=countryIndex;this.mode='regions';}
    }
    this.query=text.trim();this.regionIndex=0;this.infoSelected=false;this.menuAction=null;this.searchMessage='';
    const match=this.menu.find(item=>item.kind==='region'||item.kind==='country');
    if(match)this.focus(match);else{this.menuAction='search';this.searchMessage='No match. Tap to try again.';}
  }
  get hint():string {
    if(this.searchMessage)return this.searchMessage;
    if(this.mode!=='detail'){
      const selected=this.menu[this.cursor];
      if(selected.kind==='search')return 'Tap: speak · Double tap: back';
      if(selected.kind==='scope')return 'Tap: switch region list';
      if(selected.kind==='all')return 'Tap: all wines in this region';
      if(selected.kind==='clear')return 'Tap: clear search';
      if(selected.kind==='info')return 'Tap: place history';
      return this.mode==='regions'?`${this.regionIndex+1}/${this.regions.length} · Tap: ${wineRegionById(this.region?.id??'')?'appellations':'wines'}`:'Tap: regions · Voice above';
    }
    if(this.infoSelected)return 'Tap: history · Scroll: wines';
    return this.wines.length?`${this.wineIndex+1}/${this.wines.length} · Tap: open wine`:'Double tap: regions';
  }
  get rows():string {
    if(this.mode!=='detail'){
      const items=this.menu,index=this.cursor,start=Math.max(0,Math.min(index-2,items.length-6));
      return items.slice(start,start+6).map((item,i)=>`${start+i===index?'>':' '} ${item.label}`).join('\n');
    }
    const region=this.region!,wines=this.wines,mine=this.scope.mineByRegion.get(region.id)??0,catalog=wines.length-mine;
    const header=mine&&catalog?`MINE ${mine} · CATALOG ${catalog}`:mine?`MY WINEBRARY · ${mine}`:`SOMMNI CATALOG · ${catalog}`;
    const name=this.scope.unmapped.has(region.id)?`${region.name} · not mapped yet`:region.name;
    if(!wines.length)return ['> About '+name,'','No wines here yet','History stays open. Tap to learn.'].join('\n');
    const start=Math.max(0,Math.min(this.wineIndex-1,wines.length-4));
    const list=wines.slice(start,start+4).map((wine,i)=>`${!this.infoSelected&&start+i===this.wineIndex?'>':' '} ${entryLabel(wine)}`);
    return [`${this.infoSelected?'>':' '} About ${name}`,header,...list].join('\n');
  }
  scroll(delta:number):void {
    if(this.mode!=='detail'){const menu=this.menu;this.focus(menu[Math.max(0,Math.min(menu.length-1,this.cursor+delta))]);return;}
    if(!this.wines.length){this.infoSelected=true;return;}
    if(this.infoSelected){if(delta>0)this.infoSelected=false;return;}
    if(delta<0&&this.wineIndex===0){this.infoSelected=true;return;}
    this.wineIndex=Math.max(0,Math.min(this.wines.length-1,this.wineIndex+delta));
  }
  select():void {
    if(this.mode==='detail'){
      if(this.infoSelected||!this.wines.length)this.pendingPlace={country:this.country.name,region:this.region?.name??null};
      else this.pending=this.wines[this.wineIndex]??null;
      return;
    }
    const item=this.menu[this.cursor];
    if(item.kind==='search'){this.pendingSearch=true;return;}
    if(item.kind==='all'){this.allAreaWines=true;this.mode='detail';this.wineIndex=0;this.infoSelected=false;this.menuAction=null;return;}
    if(item.kind==='info'){this.pendingPlace={country:this.country.name,region:wineRegionById(this.wineAreaId??'')?.name??null};return;}
    if(item.kind==='scope'){this.showAllRegions=!this.showAllRegions;this.regionIndex=0;this.menuAction=this.regions.length?null:'search';this.infoSelected=false;return;}
    if(item.kind==='clear'){this.query='';this.regionIndex=0;this.menuAction=null;this.searchMessage='';return;}
    if(item.kind==='country'){this.mode='regions';this.query='';this.showAllRegions=false;this.regionIndex=0;this.menuAction=this.regions.length?null:'search';this.infoSelected=false;return;}
    if(item.id&&wineRegionById(item.id)){this.chooseRegion(item.id);return;}
    this.mode='detail';this.wineIndex=0;this.infoSelected=true;this.menuAction=null;
  }
  back():void {
    if(this.mode==='detail'){const all=this.allAreaWines;this.allAreaWines=false;this.mode='regions';this.wineIndex=0;this.infoSelected=false;this.menuAction=all?'all':null;return;}
    if(this.query){this.query='';this.regionIndex=0;this.menuAction=null;this.searchMessage='';return;}
    if(this.wineAreaId){const id=this.wineAreaId;this.wineAreaId=null;this.allAreaWines=false;this.regionIndex=Math.max(0,this.regions.findIndex(r=>r.id===id));this.menuAction=null;this.showAllRegions=false;return;}
    super.back();this.query='';this.showAllRegions=false;this.menuAction=null;this.infoSelected=false;
  }
  get exitsOnBack(){return this.mode==='countries'&&!this.query;}
}

let voiceCapture:AtlasVoiceCapture|null=null;
let voiceTraffic:Promise<unknown>=Promise.resolve();
// Atlas transport is stopped during capture. These page and microphone calls share one queue.
function voiceSerial<T>(task:()=>Promise<T>):Promise<T>{const next=voiceTraffic.catch(()=>{}).then(task);voiceTraffic=next;return next;}
export function buildAtlasVoicePage(state:CaptureState,country:string){
  const status=state==='opening'?'Opening microphone…':state==='listening'?'Listening · say a place name':'Finding your region…';
  return new RebuildPageContainer({containerTotalNum:1,textObject:[new TextContainerProperty({containerID:1,containerName:'atlas-voice',xPosition:20,yPosition:18,width:536,height:252,isEventCapture:1,content:`SEARCH BY VOICE\n${country}\n\n${status}\n${state==='listening'?'Speak now · up to 6 seconds\nTap when finished':'Please wait'}\nDouble tap: cancel`})]});
}
async function cancelAtlasVoice(restore:boolean){
  const capture=voiceCapture;if(!capture)return;voiceCapture=null;
  await capture.cancel();await voiceTraffic.catch(()=>{});
  if(restore&&active)await glasses?.open();
}
async function startAtlasVoice(){
  if(!bridge||!navigator||voiceCapture||!active)return;
  const nav=navigator,b=bridge;
  const finish=async(message?:string,text?:string)=>{
    if(voiceCapture!==capture)return;
    voiceCapture=null;
    if(!active)return;
    if(message){nav.searchMessage=message;lastError=message;}else{nav.search(text??'');lastError=null;}
    await glasses?.open();announce();
  };
  const capture=new AtlasVoiceCapture({
    control:open=>voiceSerial(()=>b.audioControl(open)),
    state:state=>voiceSerial(async()=>{if(voiceCapture!==capture||!active)return;if(!await b.rebuildPageContainer(buildAtlasVoicePage(state,nav.mode==='countries'?'Say a country or region':nav.country.name+' · say a region')))throw Error('Voice page was not accepted.');}),
    transcribe:async(pcm,signal)=>{
      let binary='';for(const byte of pcm)binary+=String.fromCharCode(byte);
      const result=await betaProvider({action:'transcribe',pcm:btoa(binary),sample_rate:16000,locale:getLocale()},signal);
      return typeof result.text==='string'?result.text:'';
    },
    result:text=>finish(undefined,text),
    error:error=>finish(error.name==='AbortError'?'Search timed out. Tap to retry.':error.message),
  });
  voiceCapture=capture;lastError=null;
  try{await glasses?.close();if(voiceCapture===capture)await capture.start();}
  catch(error){await capture.cancel();await finish(error instanceof Error?error.message:String(error));}
}

function libraryScope(): { items: LibraryWine[]; signedIn: boolean } {
  const source = readLibrary();
  return { items: source.userId ? source.items : [], signedIn: !!source.userId };
}

/** Called when the Winebrary loads or changes: re-scope, and redraw if the Atlas is showing. */
export async function atlasLibraryChanged(): Promise<void> {
  if (!navigator || !rendererPromise) return;
  const renderer = await rendererPromise;
  const { items, signedIn } = libraryScope();
  navigator.setScope(catalogAtlas(renderer, items), signedIn);
  announce();
  if (active) glasses?.refresh();
}

// ═══ Opening a wine from a region view ═══
// Yours → the Winebrary wine page; catalog → the tasting notes page. Double tap returns to the
// same Atlas view. Each page claims the display, so the Atlas transport is idle first.
let notesOpen = false;
let openingWine = false;
function selectedBottle(): string | null | undefined {
  if (!navigator || navigator.mode !== 'detail' || navigator.infoSelected) return undefined;
  const entry = navigator.wines[navigator.wineIndex];
  if (!entry) return null;
  return entry.kind==='library'?libraryPhoto(entry.wine):catalogPhoto(entry.item.id,baseUrl);
}
async function openCatalogNotes(item: CatalogWine): Promise<void> {
  if (!bridge) return;
  await claimDisplay('atlas-notes', async () => { notesOpen = false; invalidateImages(); await imageIdle(); });
  invalidateImages();
  await imageIdle();
  if (!await rebuildGlassesPage(bridge, buildTastingNotesPage(item.wine, item.id))) throw new Error('The glasses did not accept the tasting notes.');
  notesOpen = true;
  void pushTastingNotesImages(bridge, baseUrl, item.id).catch(error => console.warn('[Atlas] bottle image unavailable', error));
}
async function openPending(): Promise<void> {
  const entry = navigator?.pending;
  if (!navigator || !entry || openingWine) return;
  openingWine = true;
  navigator.pending = null;
  try {
    if (entry.kind === 'library') await showWineFromAtlas(entry.wine, () => openAtlasOnGlasses());
    else await openCatalogNotes(entry.item);
  } catch (error) {
    // A refused notes page must keep the user in the same wine list, never fall through to Home.
    try { await openAtlasOnGlasses(); } catch (restoreError) { fail(restoreError instanceof Error ? restoreError : new Error(String(restoreError))); }
    fail(error instanceof Error ? error : new Error(String(error)));
  } finally { openingWine = false; }
}
function changed(): void {
  if(navigator?.pendingSearch){navigator.pendingSearch=false;void startAtlasVoice().catch(error=>fail(error instanceof Error?error:Error(String(error))));}
  if(navigator?.pendingPlace){const place=navigator.pendingPlace;const wines=place.region?navigator.wines.flatMap(w=>w.kind==='catalog'?[w.item]:[]):allCatalogWines().filter(w=>w.country===place.country);navigator.pendingPlace=false;void openPlaceGlasses(place.country,place.region,wines,()=>openAtlasOnGlasses()).catch(console.warn);}
  if (navigator?.pending) void openPending();
  announce();
}

/** Home › Wine Atlas (also used by the phone "Open on glasses" button). */
export async function openAtlasOnGlasses(countryCode?: string): Promise<void> {
  if (!bridge) throw new Error('Connect your Even G2 glasses first.');
  const renderer = await loadAtlasRenderer();
  // Catalog/bottle/study images must be finished (or cancelled) before Atlas sends anything.
  invalidateImages();
  await imageIdle();
  await claimDisplay('atlas', release);
  const { items, signedIn } = libraryScope();
  if (!navigator) navigator = new CatalogAtlasNavigator(catalogAtlas(renderer, items), signedIn);
  else navigator.setScope(catalogAtlas(renderer, items), signedIn);
  if (countryCode) navigator.chooseCountry(countryCode);
  if (!glasses) glasses = new AtlasGlasses(bridge, navigator, renderer, changed, fail, exitToHome, selectedBottle);
  lastError = null;
  await glasses.open();
  active = true;
  announce();
}

/** Atlas consumes events before any other module while it owns the display. */
export function handleAtlasGlassesEvent(event: EvenHubEvent): boolean {
  if(voiceCapture){
    if(event.audioEvent){voiceCapture.feed(event.audioEvent.audioPcm);return true;}
    const type=event.textEvent?.eventType??event.listEvent?.eventType??event.sysEvent?.eventType;
    if(type===OsEventTypeList.DOUBLE_CLICK_EVENT)void cancelAtlasVoice(true).catch(fail);
    else if((type===0||type===undefined&&!!(event.sysEvent||event.textEvent||event.listEvent))&&voiceCapture.state==='listening')void voiceCapture.finish().catch(fail);
    return true;
  }
  if (openingWine) return true;
  if (notesOpen) {
    // Tasting notes opened from the Atlas: the text scrolls by itself; double tap goes back.
    const type = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      openingWine = true;
      void openAtlasOnGlasses().catch(error => fail(error instanceof Error ? error : new Error(String(error)))).finally(() => { openingWine = false; });
    }
    return true;
  }
  return active && !!glasses && glasses.handle(event);
}

// ═══ Catalog country list: live globe ═══
const GLOBE_SIZE = 190;          // matches the catalog panel (two 190×95 image containers, IDs 3/4)
const GLOBE_SETTLE_MS = 160;     // follow the settled cursor, not every scroll step
let globeTimer: ReturnType<typeof setTimeout> | undefined;
let globeWake: (() => void) | null = null;   // a superseded wait resolves (and then sends nothing)

export function atlasCountryFor(renderer: GlobeRenderer, name: string): Country | null {
  const alias: Record<string, string> = { 'United States': 'USA', 'USA': 'USA', 'US': 'USA' };
  const code = alias[name];
  return renderer.data.countries.find(c => code ? c.code === code : c.name === name) ?? null;
}

export interface CatalogGlobeOptions { settle?: boolean; lead?: () => Promise<unknown>; names?: [string, string] }

/**
 * Paint a catalog panel globe (image containers 3/4, 190×95 each) turned to the first
 * country, with every listed country highlighted. One country on hover or on its grape list;
 * several for a wine type's footprint. Returns false when the atlas data is unavailable
 * (callers keep their previous image). Superseded requests never send.
 */
export async function pushCatalogGlobe(b: EvenAppBridge, countryNames: string | string[], options: CatalogGlobeOptions = {}): Promise<boolean> {
  const { settle = false, lead, names = ['globe-top', 'globe-bottom'] } = options;
  clearTimeout(globeTimer); globeWake?.(); globeWake = null;
  invalidateImages();
  const epoch = currentImageEpoch();
  if (lead) await sendSerial(lead, epoch);
  let renderer: GlobeRenderer;
  try { renderer = await loadAtlasRenderer(); } catch { return false; }
  const countries = (Array.isArray(countryNames) ? countryNames : [countryNames])
    .map(name => atlasCountryFor(renderer, name)).filter((c): c is Country => !!c);
  if (epoch !== currentImageEpoch()) return true;
  if (!countries.length) return false;
  if (settle) await new Promise<void>(resolve => { globeWake = resolve; globeTimer = setTimeout(resolve, GLOBE_SETTLE_MS); });
  if (epoch !== currentImageEpoch()) return true;
  announceWineContext({title:countries.length===1?countries[0].name:'Explore these wine countries',country:countries[0].name});
  const center = countries[0].center;
  const gray = renderer.render({ country: countries[0], center }, GLOBE_SIZE).gray;
  // Footprint: each further country lights its own outline on the same camera (pixel max).
  for (const country of countries.slice(1)) {
    const other = renderer.render({ country, center }, GLOBE_SIZE).gray;
    for (let i = 0; i < gray.length; i++) if (other[i] > gray[i]) gray[i] = other[i];
  }
  const half = GLOBE_SIZE / 2;
  try {
    await pushGrayImage(b, 3, names[0], GLOBE_SIZE, half, gray.subarray(0, GLOBE_SIZE * half), epoch);
    await pushGrayImage(b, 4, names[1], GLOBE_SIZE, half, gray.subarray(GLOBE_SIZE * half), epoch);
  } catch (error) { console.warn('[Atlas] catalog globe transfer failed', error); }
  return true;
}
