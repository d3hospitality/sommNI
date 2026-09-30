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
import { allCatalogWines } from './identity';
import regionLinks from './data/atlas-region-links.json';

let bridge: EvenAppBridge | null = null;
let baseUrl = '';
let rendererPromise: Promise<GlobeRenderer> | null = null;
let glasses: AtlasGlasses | null = null;
let navigator: AtlasNavigator | null = null;
let active = false;

export interface AtlasStatus { active: boolean; mode: string; country: string; region: string | null; error: string | null }
let lastError: string | null = null;

export function connectAtlasGlasses(b: EvenAppBridge, url: string): void { bridge = b; baseUrl = url; }

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

// ═══ Catalog scope: the Atlas shows only where wineLENS has wines ═══
// Countries come from the catalog; regions are the winerymap clusters explicitly linked to a
// catalog region in src/data/atlas-region-links.json. Adding wines (and their links) widens the
// Atlas automatically. Unlinked regions stay reachable through catalog browsing.
interface RegionLink { region: string; clusters: string[]; link: string; review: string; note: string }
export interface CatalogAtlas { data: AtlasData; countries: Country[]; countryWines: Map<string, number>; regionWines: Map<string, number>; unlinked: string[] }

export function catalogAtlas(renderer: GlobeRenderer): CatalogAtlas {
  const links = new Map((regionLinks as { links: RegionLink[] }).links.map(l => [l.region, l]));
  const countryWines = new Map<string, number>(), regionWines = new Map<string, number>();
  const linked = new Map<string, Region>(), unlinked = new Set<string>();
  for (const { wine, country: countryName } of allCatalogWines()) {
    const country = atlasCountryFor(renderer, countryName);
    if (!country) continue;
    countryWines.set(country.code, (countryWines.get(country.code) ?? 0) + 1);
    const link = links.get(wine.region);
    const regions = (link?.clusters ?? [])
      .map(name => renderer.data.regions.find(r => r.name === name && r.country === country.code))
      .filter((r): r is Region => !!r);
    if (!regions.length) unlinked.add(wine.region);
    for (const r of regions) { linked.set(r.id, r); regionWines.set(r.id, (regionWines.get(r.id) ?? 0) + 1); }
  }
  const countries = renderer.data.countries
    .filter(c => countryWines.has(c.code))
    .sort((a, b) => (countryWines.get(b.code)! - countryWines.get(a.code)!) || a.name.localeCompare(b.name));
  return { data: { ...renderer.data, regions: [...linked.values()] }, countries, countryWines, regionWines, unlinked: [...unlinked].sort() };
}

class CatalogAtlasNavigator extends AtlasNavigator {
  constructor(private scope: CatalogAtlas) { super(scope.data); this.countries = scope.countries; }
  get title(): string { return this.mode === 'countries' ? `WINE ATLAS · ${this.countries.length} COUNTRIES` : super.title; }
  get hint(): string {
    if (this.mode === 'countries' && !this.regions.length) return `${this.index + 1} / ${this.labels.length}   No mapped region yet`;
    return super.hint;
  }
  /** Linked clusters, most catalog wines first (then the source's winery count). */
  get regions(): Region[] {
    const wines = this.scope?.regionWines;
    const list = super.regions;
    return wines ? list.sort((a, b) => (wines.get(b.id) ?? 0) - (wines.get(a.id) ?? 0) || b.count - a.count) : list;
  }
}

/** Home › Wine Atlas (also used by the phone "Open on glasses" button). */
export async function openAtlasOnGlasses(countryCode?: string): Promise<void> {
  if (!bridge) throw new Error('Connect your Even G2 glasses first.');
  const renderer = await loadAtlasRenderer();
  // Catalog/bottle/study images must be finished (or cancelled) before Atlas sends anything.
  invalidateImages();
  await imageIdle();
  await claimDisplay('atlas', release);
  if (!navigator) navigator = new CatalogAtlasNavigator(catalogAtlas(renderer));
  if (countryCode) navigator.chooseCountry(countryCode);
  if (!glasses) glasses = new AtlasGlasses(bridge, navigator, renderer, announce, fail, exitToHome);
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
