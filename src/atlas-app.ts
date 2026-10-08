// ═══════════════════════════════════════════════════════════════════
// Wine Atlas inside wineLENS — integration layer around src/atlas/ (Codex's module).
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

import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { GlobeRenderer, type AtlasData, type Country, type Region, type View } from './atlas/renderer';
import { AtlasNavigator } from './atlas/navigator';
import { AtlasGlasses } from './atlas/glasses';
import { claimDisplay, dropDisplay } from './display';
import { rebuildGlassesPage, invalidateImages, imageIdle, currentImageEpoch, pushGrayImage, pushLogoToGlasses, sendSerial, pushTastingNotesImages } from './image-utils';
import { rebuildHomePage, buildTastingNotesPage } from './pages';
import { allCatalogWines, lookupWineById, type CatalogWine } from './identity';
import { catalogBottleSources } from './bottle-assets';
import type { BottleSource } from './bottle-raster';
import { readLibrary, libraryBottle, showWineFromAtlas, vintageShort, setWinePlacer, setWineSceneBuilder, setPlaceSceneBuilder, fallbackPlace, type WinePlace } from './winebrary-glasses';
import { planWineScene, type ScenePlan } from './wine-scene';
import { TYPE_DISPLAY, WINE_TYPES, type WineType } from './constants';
import type { LibraryWine } from './winebrary';
import regionLinks from './data/atlas-region-links.json';
import { catalogWineShown } from './catalog-view';
import { saveFromGlasses, notesOpened } from './quick-save';

let bridge: EvenAppBridge | null = null;
let baseUrl = '';
let rendererPromise: Promise<GlobeRenderer> | null = null;
let glasses: AtlasGlasses | null = null;
let navigator: CatalogAtlasNavigator | null = null;
let active = false;

export interface AtlasStatus { active: boolean; mode: string; style: string; country: string; region: string | null; error: string | null }
let lastError: string | null = null;

let listening = false;
export function connectAtlasGlasses(b: EvenAppBridge, url: string): void {
  bridge = b; baseUrl = url;
  if (!listening) { listening = true; window.addEventListener('winelens-library-changed', () => { void atlasLibraryChanged(); }); }
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
  const region = regionName ? renderer.data.regions.find(r => r.name === regionName && r.country === country.code) ?? null : null;
  return planWineScene(renderer, { country, region, imageUrl: null });
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
  return planWineScene(renderer, { country: placed.country, region: placed.regions[0] ?? null, imageUrl: libraryBottle(wine) });
}

/** Map data is ~1 MB: load it once, on first use (Atlas entry or first country list). */
export function loadAtlasRenderer(): Promise<GlobeRenderer> {
  if (!rendererPromise) {
    const root = baseUrl || new URL('./', location.href).href;
    rendererPromise = GlobeRenderer.load(new URL('atlas/', root).href);
    rendererPromise.catch(() => { rendererPromise = null; });
  }
  return rendererPromise;
}

export function atlasStatus(): AtlasStatus {
  return {
    active,
    mode: navigator?.mode ?? 'types',
    country: navigator?.country.name ?? '',
    region: navigator && (navigator.mode === 'regions' || navigator.mode === 'detail') ? navigator.region?.name ?? null : null,
    style: navigator ? typeLabel(navigator.type) : 'All wines',
    error: lastError,
  };
}
/** Foreground lifecycle keeps the cursor while stopping queued Atlas frames. */
export async function pauseAtlasGlasses(): Promise<void> { await glasses?.close(); }
export async function resumeAtlasGlasses(): Promise<void> { if (active) await glasses?.open(); }
function announce(): void { window.dispatchEvent(new CustomEvent('winelens-atlas-change', { detail: atlasStatus() })); }
function fail(error: Error): void { lastError = error.message; console.error('[Atlas] ' + error.message); announce(); }

async function release(): Promise<void> {
  if (!glasses) return;
  active = false;
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

// ═══ Scope: the Atlas shows only where wineLENS (and your Winebrary) has wines ═══
// Countries come from the catalog and the signed-in Winebrary. Regions are winerymap clusters
// explicitly linked to a catalog region (src/data/atlas-region-links.json), or named exactly
// like a Winebrary wine's region. Adding wines widens the Atlas automatically; anything
// unmatched stays reachable through catalog browsing and My Winebrary.
interface RegionLink { region: string; clusters: string[]; link: string; review: string; note: string }
/** A wine listed in a region view: one of yours (Winebrary) or one from the wineLENS catalog. */
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
  const twin = wine.wine_id ? lookupWineById(wine.wine_id) : null;
  if (twin) {
    const country = atlasCountryFor(renderer, twin.country);
    const regions = country ? (links.get(twin.wine.region)?.clusters ?? []).map(n => renderer.data.regions.find(r => r.name === n && r.country === country.code)).filter((r): r is Region => !!r) : [];
    return { country, regions, place: twin.wine.region.split(',')[0].trim() };
  }
  const [place = '', suffix] = (wine.region ?? '').split(',').map(p => p.trim());
  const country = countryByAnyName(renderer, wine.metadata?.country) ?? countryByAnyName(renderer, suffix);
  // A catalog region with the same place name (e.g. "Burgundy" → Burgundy, FR) gives the country …
  const link = place ? [...links.values()].find(l => norm(l.region.split(',')[0]) === norm(place)) : undefined;
  const linkCountry = !country && link ? countryByAnyName(renderer, link.region.split(',')[1]?.trim()) : null;
  const known = country ?? linkCountry;
  if (!place) return { country: known, regions: [], place };
  // … and its clusters; otherwise a cluster with exactly this name (in the wine's country, or unambiguous).
  const candidates = link?.clusters.length ? link.clusters.map(n => renderer.data.regions.filter(r => r.name === n)).flat() : renderer.data.regions.filter(r => norm(r.name) === norm(place));
  const inCountry = known ? candidates.filter(r => r.country === known.code) : candidates;
  if (!known && new Set(candidates.map(r => r.country)).size > 1) return { country: null, regions: [], place };
  const regions = inCountry.length ? [inCountry[0]] : [];
  const resolved = known ?? (regions[0] ? renderer.data.countries.find(c => c.code === regions[0].country) ?? null : null);
  return { country: resolved, regions, place };
}

/** A Winebrary wine's style: its catalog twin's, else its own colour. Unknown styles appear under All wines only. */
function libraryStyle(wine: LibraryWine): WineType | null {
  const twin = wine.wine_id ? lookupWineById(wine.wine_id) : null;
  if (twin) return twin.type;
  return ({ red: 'Red', white: 'White', sparkling: 'Sparkling', rose: 'Rose', 'rosé': 'Rose', orange: 'Orange', dessert: 'Dessert' } as Record<string, WineType>)[(wine.metadata?.color ?? '').toLowerCase()] ?? null;
}

export function catalogAtlas(renderer: GlobeRenderer, libraryItems: LibraryWine[] = [], type: AtlasType = null): CatalogAtlas {
  const links = linkTable();
  const countryWines = new Map<string, number>(), mineByRegion = new Map<string, number>(), mineByCountry = new Map<string, number>();
  const regions = new Map<string, Region>(), unmapped = new Set<string>(), unlinked = new Set<string>();
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
    if (type && item.type !== type) continue;
    if (!catalogWineShown(item.id)) continue;   // hidden catalog, or a default wine the person removed
    const country = atlasCountryFor(renderer, item.country);
    if (!country) continue;
    bump(countryWines, country.code);
    let linked = (links.get(item.wine.region)?.clusters ?? [])
      .map(name => renderer.data.regions.find(r => r.name === name && r.country === country.code))
      .filter((r): r is Region => !!r);
    if (!linked.length) { unlinked.add(item.wine.region); linked = [placeRow(country, item.wine.region.split(',')[0].trim())]; }
    for (const r of linked) { regions.set(r.id, r); push(catalog, r.id, { kind: 'catalog', item }); }
  }
  for (const wine of libraryItems) {
    if (type && libraryStyle(wine) !== type) continue;
    const placed = placeLibraryWine(renderer, links, wine);
    if (!placed.country) continue;           // no country: stays in My Winebrary only
    bump(mineByCountry, placed.country.code);
    const rows = placed.regions.length ? placed.regions : [placeRow(placed.country, placed.place)];
    for (const r of rows) { regions.set(r.id, r); push(mine, r.id, { kind: 'library', wine }); bump(mineByRegion, r.id); }
  }
  const entries = new Map<string, AtlasEntry[]>();
  for (const id of regions.keys()) entries.set(id, [...(mine.get(id) ?? []), ...(catalog.get(id) ?? [])]);
  const countries = renderer.data.countries
    .filter(c => countryWines.has(c.code) || mineByCountry.has(c.code))
    .sort((a, b) => ((mineByCountry.get(b.code) ?? 0) - (mineByCountry.get(a.code) ?? 0)) || ((countryWines.get(b.code) ?? 0) - (countryWines.get(a.code) ?? 0)) || a.name.localeCompare(b.name));
  return { data: { ...renderer.data, regions: [...regions.values()] }, countries, countryWines, entries, mineByRegion, mineByCountry, unmapped, unlinked: [...unlinked].sort() };
}

const entryLabel = (e: AtlasEntry) => e.kind === 'library' ? [e.wine.wine_name, vintageShort(e.wine)].filter(Boolean).join(' ') : e.item.wine.name;

/** A wine style to browse the Atlas by; null = every wine. */
export type AtlasType = WineType | null;
const STYLE_LABEL: Record<WineType, string> = { Red: 'Red', White: 'White', Sparkling: 'Sparkling', Rose: 'Rosé', Orange: 'Orange', Dessert: 'Dessert' };
const typeLabel = (type: AtlasType) => type ? STYLE_LABEL[type] : 'All wines';
const scopeSize = (scope: CatalogAtlas) => [...scope.countryWines.values(), ...scope.mineByCountry.values()].reduce((a, b) => a + b, 0);

class CatalogAtlasNavigator extends AtlasNavigator {
  wineIndex = 0;
  /** Set by a tap on a wine in the region view; atlas-app opens it. */
  pending: AtlasEntry | null = null;
  typeIndex = 0;
  /** All wines, then each style that has wines (catalog + yours), with counts. */
  types: { type: AtlasType; count: number }[] = [];
  private scope: CatalogAtlas;
  constructor(private scopeFor: (type: AtlasType) => CatalogAtlas, public signedIn: boolean) {
    const all = scopeFor(null);
    super(all.data);
    this.scope = all; this.countries = all.countries; this.mode = 'types';
    this.types = this.typeOptions(all);
  }
  private typeOptions(all: CatalogAtlas) {
    return [{ type: null as AtlasType, count: scopeSize(all) }, ...WINE_TYPES.map(type => ({ type: type as AtlasType, count: scopeSize(this.scopeFor(type)) })).filter(t => t.count > 0)];
  }
  get type(): AtlasType { return this.types[this.typeIndex]?.type ?? null; }
  /** Point the Atlas at one style: its countries (most wines first), its regions, its wines. */
  private useType(index: number): void {
    this.typeIndex = Math.max(0, Math.min(this.types.length - 1, index));
    this.scope = this.scopeFor(this.type); this.data = this.scope.data; this.countries = this.scope.countries;
    this.countryIndex = 0; this.regionIndex = 0; this.wineIndex = 0;
  }
  get atTop(): boolean { return this.mode === 'types'; }
  /** Picking a style lights every country that makes it, turned to the one with the most wines. */
  get view(): View { return this.mode === 'types' ? { ...super.view, footprint: this.countries.map(c => c.id) } : super.view; }
  get index(): number { return this.mode === 'types' ? this.typeIndex : super.index; }

  /** New scope (Winebrary loaded, signed out …): same style, and the same country/region when still present. */
  rescope(scopeFor: (type: AtlasType) => CatalogAtlas, signedIn: boolean): void {
    const code = this.country?.code, regionId = this.region?.id, mode = this.mode, type = this.type;
    this.scopeFor = scopeFor; this.signedIn = signedIn;
    this.types = this.typeOptions(scopeFor(null));
    this.typeIndex = Math.max(0, this.types.findIndex(t => t.type === type));
    this.scope = scopeFor(this.type); this.data = this.scope.data; this.countries = this.scope.countries;
    this.countryIndex = Math.max(0, this.countries.findIndex(c => c.code === code));
    const r = regionId ? this.regions.findIndex(x => x.id === regionId) : -1;
    if ((mode === 'regions' || mode === 'detail') && r >= 0) this.regionIndex = r;
    else { if (mode !== 'types') this.mode = 'countries'; this.regionIndex = 0; }
    this.wineIndex = Math.min(this.wineIndex, Math.max(0, this.wines.length - 1));
  }
  /** Straight to a country (phone "Open on glasses"): all wines, that country. */
  chooseCountry(code: string): void {
    if (!this.countries.some(c => c.code === code)) this.useType(0);
    super.chooseCountry(code);
  }
  get wines(): AtlasEntry[] { return this.region ? this.scope.entries.get(this.region.id) ?? [] : []; }
  get title(): string {
    if (this.mode === 'types') return 'WINE ATLAS · PICK A STYLE';
    return this.mode === 'countries' ? `${typeLabel(this.type).toUpperCase()} · ${this.countries.length} ${this.countries.length === 1 ? 'COUNTRY' : 'COUNTRIES'}` : super.title;
  }
  get labels(): string[] {
    if (this.mode === 'types') return this.types.map(t => `${typeLabel(t.type)} · ${t.count}`);
    if (this.mode !== 'countries') return this.regions.map(r => { const n = this.scope.mineByRegion.get(r.id) ?? 0; return n ? `${r.name} (${n})` : r.name; });
    return this.countries.map(c => { const n = this.scope.mineByCountry.get(c.code) ?? 0; return n ? `${c.name} (${n})` : c.name; });
  }
  get hint(): string {
    if (this.mode === 'types') return `${this.typeIndex + 1} / ${this.types.length}   Tap: countries`;
    if (this.mode === 'detail') return this.wines.length ? `${this.wineIndex + 1} / ${this.wines.length}   Tap: open wine` : 'Double tap: regions';
    return super.hint;
  }
  /** Region view: your Winebrary wines, then catalog wines from this place. Scroll + tap opens one. */
  get rows(): string {
    if (this.mode !== 'detail') return super.rows;
    const r = this.region!, wines = this.wines;
    const mine = this.scope.mineByRegion.get(r.id) ?? 0, catalog = wines.length - mine;
    const header = mine && catalog ? `MINE ${mine} · CATALOG ${catalog}` : mine ? `MY WINEBRARY · ${mine}` : `WINELENS CATALOG · ${catalog}`;
    const name = this.scope.unmapped.has(r.id) ? `${r.name} · not mapped yet` : r.name;
    if (!wines.length) return [name, '', 'No wines here yet'].join('\n');
    const start = Math.max(0, Math.min(this.wineIndex - 1, wines.length - 4));
    const list = wines.slice(start, start + 4).map((w, i) => `${start + i === this.wineIndex ? '>' : ' '} ${entryLabel(w)}`);
    return [name, header, ...list].join('\n');
  }
  /** Your wines first, then mapped places, then catalog wines, then the source's winery count. */
  get regions(): Region[] {
    const scope = this.scope;
    const list = super.regions;
    if (!scope) return list;
    const mine = (r: Region) => scope.mineByRegion.get(r.id) ?? 0;
    const mapped = (r: Region) => scope.unmapped.has(r.id) ? 0 : 1;
    const all = (r: Region) => scope.entries.get(r.id)?.length ?? 0;
    return list.sort((a, b) => mine(b) - mine(a) || mapped(b) - mapped(a) || all(b) - all(a) || b.count - a.count || a.name.localeCompare(b.name));
  }
  scroll(delta: number): void {
    if (this.mode === 'types') { this.useType(this.typeIndex + delta); return; }
    if (this.mode === 'detail') { this.wineIndex = Math.max(0, Math.min(this.wines.length - 1, this.wineIndex + delta)); return; }
    super.scroll(delta);
  }
  select(): void {
    if (this.mode === 'types') { if (this.countries.length) this.mode = 'countries'; return; }
    if (this.mode === 'detail') { this.pending = this.wines[this.wineIndex] ?? null; return; }
    if (this.mode === 'regions') this.wineIndex = 0;
    super.select();
  }
  back(): void {
    if (this.mode === 'countries') { this.mode = 'types'; return; }
    if (this.mode === 'detail') this.wineIndex = 0;
    super.back();
  }
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
  navigator.rescope(type => catalogAtlas(renderer, items, type), signedIn);
  announce();
  if (active) glasses?.refresh();
}

// ═══ Opening a wine from a region view ═══
// Yours → the Winebrary wine page; catalog → the tasting notes page. Double tap returns to the
// same Atlas view. Each page claims the display, so the Atlas transport is idle first.
let notesOpen = false;
let notesWineId: string | null = null;
let openingWine = false;
function selectedBottle(): BottleSource | null | undefined {
  if (!navigator || navigator.mode !== 'detail') return undefined;
  const entry = navigator.wines[navigator.wineIndex];
  if (!entry) return null;
  if (entry.kind === 'library') return libraryBottle(entry.wine);
  const sources = catalogBottleSources(baseUrl, entry.item.id);
  return sources.length ? sources : null;
}
async function openCatalogNotes(item: CatalogWine): Promise<void> {
  if (!bridge) return;
  await claimDisplay('atlas-notes', async () => { notesOpen = false; invalidateImages(); await imageIdle(); });
  invalidateImages();
  await imageIdle();
  if (!await rebuildGlassesPage(bridge, buildTastingNotesPage(item.wine, item.id))) throw new Error('The glasses did not accept the tasting notes.');
  notesOpen = true;
  notesWineId = item.id;
  notesOpened();
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
  const scopeFor = (type: AtlasType) => catalogAtlas(renderer, items, type);
  if (!navigator) navigator = new CatalogAtlasNavigator(scopeFor, signedIn);
  else navigator.rescope(scopeFor, signedIn);
  if (countryCode) navigator.chooseCountry(countryCode);
  if (!glasses) glasses = new AtlasGlasses(bridge, navigator, renderer, changed, fail, exitToHome, selectedBottle);
  lastError = null;
  await glasses.open();
  active = true;
  announce();
}

/** Atlas consumes events before any other module while it owns the display. */
export function handleAtlasGlassesEvent(event: EvenHubEvent): boolean {
  if (openingWine) return true;
  if (notesOpen) {
    // Tasting notes opened from the Atlas: the text scrolls by itself; tap saves; double tap goes back.
    const type = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType;
    if ((type === undefined || type === OsEventTypeList.CLICK_EVENT) && event.textEvent?.containerName === 'notes' && bridge) {
      void saveFromGlasses(bridge, notesWineId);
      return true;
    }
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
  let renderer: GlobeRenderer;
  try { renderer = await loadAtlasRenderer(); } catch { return false; }
  const countries = (Array.isArray(countryNames) ? countryNames : [countryNames])
    .map(name => atlasCountryFor(renderer, name)).filter((c): c is Country => !!c);
  if (!countries.length) return false;
  invalidateImages();
  const epoch = currentImageEpoch();
  // Text leads the image, in the same queue, so the two never interleave on the bridge.
  if (lead) void sendSerial(lead, epoch).catch(error => console.warn('[Atlas] catalog text update failed', error));
  if (settle) await new Promise<void>(resolve => { globeWake = resolve; globeTimer = setTimeout(resolve, GLOBE_SETTLE_MS); });
  if (epoch !== currentImageEpoch()) return true;
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
