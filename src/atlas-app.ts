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

import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { GlobeRenderer, type AtlasData, type Country, type Region } from './atlas/renderer';
import { AtlasNavigator } from './atlas/navigator';
import { AtlasGlasses } from './atlas/glasses';
import { claimDisplay, dropDisplay } from './display';
import { invalidateImages, imageIdle, currentImageEpoch, pushGrayImage, pushLogoToGlasses, sendSerial } from './image-utils';
import { rebuildHomePage } from './pages';
import { allCatalogWines, lookupWineById } from './identity';
import { readLibrary, showWineFromAtlas, vintageShort } from './winebrary-glasses';
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
  if (!listening) { listening = true; window.addEventListener('winelens-library-changed', () => { void atlasLibraryChanged(); }); }
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
    mode: navigator?.mode ?? 'countries',
    country: navigator?.country.name ?? '',
    region: navigator && navigator.mode !== 'countries' ? navigator.region?.name ?? null : null,
    error: lastError,
  };
}
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
  if (!await bridge.rebuildPageContainer(rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}

// ═══ Scope: the Atlas shows only where wineLENS (and your Winebrary) has wines ═══
// Countries come from the catalog and the signed-in Winebrary. Regions are winerymap clusters
// explicitly linked to a catalog region (src/data/atlas-region-links.json), or named exactly
// like a Winebrary wine's region. Adding wines widens the Atlas automatically; anything
// unmatched stays reachable through catalog browsing and My Winebrary.
interface RegionLink { region: string; clusters: string[]; link: string; review: string; note: string }
export interface CatalogAtlas {
  data: AtlasData; countries: Country[];
  countryWines: Map<string, number>; regionWines: Map<string, number>;
  /** Winebrary wines by atlas region id, and by country code (all wines placed in that country). */
  library: Map<string, LibraryWine[]>; libraryByCountry: Map<string, LibraryWine[]>;
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
function placeLibraryWine(renderer: GlobeRenderer, links: Map<string, RegionLink>, wine: LibraryWine): { country: Country | null; regions: Region[] } {
  const twin = wine.wine_id ? lookupWineById(wine.wine_id) : null;
  if (twin) {
    const country = atlasCountryFor(renderer, twin.country);
    const regions = country ? (links.get(twin.wine.region)?.clusters ?? []).map(n => renderer.data.regions.find(r => r.name === n && r.country === country.code)).filter((r): r is Region => !!r) : [];
    return { country, regions };
  }
  const [place, suffix] = (wine.region ?? '').split(',').map(p => p.trim());
  const country = countryByAnyName(renderer, wine.metadata?.country) ?? countryByAnyName(renderer, suffix);
  if (!place) return { country, regions: [] };
  // A catalog link with the same place name first (e.g. "Russian River" → Russian River Valley) …
  const link = [...links.values()].find(l => norm(l.region.split(',')[0]) === norm(place));
  const candidates = link?.clusters.length ? link.clusters.map(n => renderer.data.regions.filter(r => r.name === n)).flat() : renderer.data.regions.filter(r => norm(r.name) === norm(place));
  // … then an exact cluster name, in the wine's country when known, else only if the name is unambiguous.
  const inCountry = country ? candidates.filter(r => r.country === country.code) : candidates;
  const regions = inCountry.length ? [inCountry[0]] : [];
  const resolvedCountry = country ?? (regions[0] ? renderer.data.countries.find(c => c.code === regions[0].country) ?? null : null);
  if (!country && new Set(candidates.map(r => r.country)).size > 1) return { country: null, regions: [] };
  return { country: resolvedCountry, regions };
}

export function catalogAtlas(renderer: GlobeRenderer, libraryItems: LibraryWine[] = []): CatalogAtlas {
  const links = linkTable();
  const countryWines = new Map<string, number>(), regionWines = new Map<string, number>();
  const linked = new Map<string, Region>(), unlinked = new Set<string>();
  const library = new Map<string, LibraryWine[]>(), libraryByCountry = new Map<string, LibraryWine[]>();
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const { wine, country: countryName } of allCatalogWines()) {
    const country = atlasCountryFor(renderer, countryName);
    if (!country) continue;
    countryWines.set(country.code, (countryWines.get(country.code) ?? 0) + 1);
    const regions = (links.get(wine.region)?.clusters ?? [])
      .map(name => renderer.data.regions.find(r => r.name === name && r.country === country.code))
      .filter((r): r is Region => !!r);
    if (!regions.length) unlinked.add(wine.region);
    for (const r of regions) { linked.set(r.id, r); regionWines.set(r.id, (regionWines.get(r.id) ?? 0) + 1); }
  }
  for (const wine of libraryItems) {
    const { country, regions } = placeLibraryWine(renderer, links, wine);
    if (country) add(libraryByCountry, country.code, wine);
    for (const r of regions) { linked.set(r.id, r); add(library, r.id, wine); }
  }
  const mine = (code: string) => libraryByCountry.get(code)?.length ?? 0;
  const countries = renderer.data.countries
    .filter(c => countryWines.has(c.code) || mine(c.code) > 0)
    .sort((a, b) => (mine(b.code) - mine(a.code)) || ((countryWines.get(b.code) ?? 0) - (countryWines.get(a.code) ?? 0)) || a.name.localeCompare(b.name));
  return { data: { ...renderer.data, regions: [...linked.values()] }, countries, countryWines, regionWines, library, libraryByCountry, unlinked: [...unlinked].sort() };
}

const wineLabel = (wine: LibraryWine) => [wine.wine_name, vintageShort(wine)].filter(Boolean).join(' ');

class CatalogAtlasNavigator extends AtlasNavigator {
  wineIndex = 0;
  /** Set by a tap on a Winebrary wine in the region view; atlas-app opens it. */
  pendingWine: LibraryWine | null = null;
  constructor(private scope: CatalogAtlas, public signedIn: boolean) { super(scope.data); this.countries = scope.countries; }

  /** New scope (Winebrary loaded, signed out …): keep the same country/region when still present. */
  setScope(scope: CatalogAtlas, signedIn: boolean): void {
    const code = this.country?.code, regionId = this.region?.id, mode = this.mode;
    this.scope = scope; this.data = scope.data; this.countries = scope.countries; this.signedIn = signedIn;
    this.countryIndex = Math.max(0, this.countries.findIndex(c => c.code === code));
    const r = regionId ? this.regions.findIndex(x => x.id === regionId) : -1;
    if (mode !== 'countries' && r >= 0) this.regionIndex = r; else { this.mode = 'countries'; this.regionIndex = 0; }
    this.wineIndex = Math.min(this.wineIndex, Math.max(0, this.wines.length - 1));
  }
  get wines(): LibraryWine[] { return this.region ? this.scope.library.get(this.region.id) ?? [] : []; }
  get title(): string { return this.mode === 'countries' ? `WINE ATLAS · ${this.countries.length} COUNTRIES` : super.title; }
  get labels(): string[] {
    if (this.mode !== 'countries') return this.regions.map(r => { const n = this.scope.library.get(r.id)?.length ?? 0; return n ? `${r.name} (${n})` : r.name; });
    return this.countries.map(c => { const n = this.scope.libraryByCountry.get(c.code)?.length ?? 0; return n ? `${c.name} (${n})` : c.name; });
  }
  get hint(): string {
    if (this.mode === 'countries' && !this.regions.length) return `${this.index + 1} / ${this.labels.length}   No mapped region yet`;
    if (this.mode === 'detail') return this.wines.length ? `${this.wineIndex + 1} / ${this.wines.length}   Tap: open wine` : 'Double tap: regions';
    return super.hint;
  }
  /** Region view: your Winebrary wines from this place (scroll + tap opens one). */
  get rows(): string {
    if (this.mode !== 'detail') return super.rows;
    const r = this.region!, wines = this.wines, catalog = this.scope.regionWines.get(r.id) ?? 0;
    if (!wines.length) {
      return [r.name, '', this.signedIn ? 'No Winebrary wines here yet' : 'Sign in on your phone to see', this.signedIn ? '' : 'your Winebrary here',
        catalog ? `wineLENS catalog: ${catalog} ${catalog === 1 ? 'wine' : 'wines'}` : '', 'Dots: mapped wineries'].filter((l, i) => i < 2 || l).join('\n');
    }
    const start = Math.max(0, Math.min(this.wineIndex - 1, wines.length - 4));
    const list = wines.slice(start, start + 4).map((w, i) => `${start + i === this.wineIndex ? '>' : ' '} ${wineLabel(w)}`);
    return [r.name, `MY WINEBRARY · ${wines.length}`, ...list].join('\n');
  }
  /** Your wines first, then catalog wines, then the source's winery count. */
  get regions(): Region[] {
    const scope = this.scope;
    const list = super.regions;
    if (!scope) return list;
    const mine = (r: Region) => scope.library.get(r.id)?.length ?? 0;
    return list.sort((a, b) => mine(b) - mine(a) || (scope.regionWines.get(b.id) ?? 0) - (scope.regionWines.get(a.id) ?? 0) || b.count - a.count);
  }
  scroll(delta: number): void {
    if (this.mode === 'detail') { this.wineIndex = Math.max(0, Math.min(this.wines.length - 1, this.wineIndex + delta)); return; }
    super.scroll(delta);
  }
  select(): void {
    if (this.mode === 'detail') { this.pendingWine = this.wines[this.wineIndex] ?? null; return; }
    if (this.mode === 'regions') this.wineIndex = 0;
    super.select();
  }
  back(): void { if (this.mode === 'detail') this.wineIndex = 0; super.back(); }
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

/** Tap on a wine in the region view: the Winebrary page takes the display; double tap comes back here. */
async function openPendingWine(): Promise<void> {
  const wine = navigator?.pendingWine;
  if (!navigator || !wine) return;
  navigator.pendingWine = null;
  try { await showWineFromAtlas(wine, () => openAtlasOnGlasses()); }
  catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
}
function changed(): void {
  if (navigator?.pendingWine) void openPendingWine();
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
  if (!glasses) glasses = new AtlasGlasses(bridge, navigator, renderer, changed, fail, exitToHome);
  lastError = null;
  await glasses.open();
  active = true;
  announce();
}

/** Atlas consumes events before any other module while it owns the display. */
export function handleAtlasGlassesEvent(event: EvenHubEvent): boolean {
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
