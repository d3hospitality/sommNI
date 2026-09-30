import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import type { LibraryWine } from './winebrary';
import { pushBottlePhoto, invalidateImages, pushLogoToGlasses, pushGrayImage, currentImageEpoch } from './image-utils';
import { SCENE_X, MAP_Y, TILE_W, TILE_H, captionBox, type ScenePlan } from './wine-scene';
import { ruleCanvas, toGreenLevels } from './bottle-raster';
import { lookupWineById } from './identity';
import { claimDisplay, dropDisplay } from './display';
import { bottleCanvas } from './bottle-raster';
import { rebuildHomePage } from './pages';
import { pageList, clipLabel, clipBytes, labelBytes, wholeRowHeight, LIST_LABEL_MAX, LIST_ROW_PITCH, type ListPage } from './glasses-list';

// ═══════════════════════════════════════════════════════════════════
// Winebrary on G2 — the account library as a native glasses flow.
//   Home › My Winebrary › Red/White… › country › region › wine (› vintage) › detail
// The detail page puts the wine on its map: country dithered behind everything,
// the country semi-lit and the region's wineries glowing (wine-scene.ts).
// Click selects, double tap goes back one level, lists page at 18 entries.
// While `active`, this module owns the display and legacy catalog
// handlers never see its events.
// ═══════════════════════════════════════════════════════════════════

export interface LibrarySource { userId: string | null; loading: boolean; error: string; items: LibraryWine[] }
export interface WineGroup { title: string; wines: LibraryWine[] }
type MessageReason = 'signed-out' | 'loading' | 'empty' | 'error';
type Screen =
  | { kind: 'types'; page: number }
  | { kind: 'countries'; type: string; page: number }
  | { kind: 'regions'; type: string; country: string; page: number }
  | { kind: 'list'; type: string; country: string; region: string; page: number }
  | { kind: 'vintages'; group: WineGroup; page: number; parent: Screen }
  | { kind: 'detail'; wine: LibraryWine; from: 'library' | 'phone' | 'atlas'; parent: Screen | null }
  | { kind: 'message'; reason: MessageReason };

let bridge: EvenAppBridge | null = null;
let connected = false;
let active = false;
let sending = false;
let baseUrl = '';
let screen: Screen | null = null;
let groups: WineGroup[] = [];   // wines on the current list screen
let items: LibraryWine[] = [];   // the whole library (or its offline copy)
let offlineCopy = false;
let lastNavigation = 0;
const NAV_SETTLE_MS = 350; // swallow the ghost click that can follow a page rebuild
let readSource: () => LibrarySource = () => ({ userId: null, loading: false, error: '', items: [] });

export function connectWinebraryGlasses(value: EvenAppBridge, url: string) { bridge=value; baseUrl=url; void flushPendingCache(); }
export function setWinebraryDeviceConnected(value: boolean) { connected=value; }
export function canShowWine() { return !!bridge && connected && !sending; }
export function isLibraryActive() { return active; }
export function setLibrarySource(read: () => LibrarySource) { readSource=read; }
/** Current Winebrary snapshot (the Atlas matches these wines to places). */
export function readLibrary(): LibrarySource { return readSource(); }
let atlasReturn: (() => Promise<void>) | null = null;

// ═══ PLACES: type › country › region ═══
// Injected by atlas-app (which knows the map). Without it, the wine's own fields are used.
export interface WinePlace { type: string; country: string; region: string; mapped: boolean }
export type WinePlacer = (wines: LibraryWine[]) => Promise<Map<string, WinePlace>>;
/** The wine's map panel: where its region landed (for the moving caption) + a renderer for the tiles. */
export type WineSceneBuilder = (wine: LibraryWine) => Promise<ScenePlan | null>;
let placer: WinePlacer | null = null;
let sceneBuilder: WineSceneBuilder | null = null;
export function setWinePlacer(p: WinePlacer | null) { placer = p; }
export function setWineSceneBuilder(b: WineSceneBuilder | null) { sceneBuilder = b; }
let places = new Map<string, WinePlace>();

export const TYPE_ORDER = ['Red', 'White', 'Sparkling', 'Rosé', 'Orange', 'Dessert', 'Other'];
const UNKNOWN_COUNTRY = 'Country not set', UNKNOWN_REGION = 'Region not set';
export function wineTypeOf(wine: LibraryWine): string {
  const c = (wine.metadata?.color || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ({ red: 'Red', white: 'White', sparkling: 'Sparkling', rose: 'Rosé', orange: 'Orange', dessert: 'Dessert' } as Record<string, string>)[c] ?? 'Other';
}
/** The wine's own fields: "Place, CC" or metadata.country. */
export function fallbackPlace(wine: LibraryWine): WinePlace {
  const [place = '', suffix = ''] = (wine.region ?? '').split(',').map(p => p.trim());
  return { type: wineTypeOf(wine), country: wine.metadata?.country?.trim() || suffix || UNKNOWN_COUNTRY, region: place || UNKNOWN_REGION, mapped: false };
}
const placeOf = (wine: LibraryWine) => places.get(wine.id) ?? fallbackPlace(wine);
async function refreshPlaces(list: LibraryWine[]): Promise<void> {
  places = new Map();
  if (!placer) return;
  try { places = await placer(list); } catch (error) { console.warn('[wineLENS] Winebrary places unavailable; using the wines\' own fields.', error); }
}
interface Facet { label: string; count: number }
/** Rows with counts, in the given order (else most wines first); unknown places last. */
function facets(list: LibraryWine[], key: (p: WinePlace) => string, order?: string[]): Facet[] {
  const counts = new Map<string, number>();
  for (const w of list) { const k = key(placeOf(w)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const rank = (label: string) => order ? (order.indexOf(label) + 1 || order.length + 1) : 0;
  const unknown = (label: string) => label === UNKNOWN_COUNTRY || label === UNKNOWN_REGION ? 1 : 0;
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => unknown(a.label) - unknown(b.label) || rank(a.label) - rank(b.label) || b.count - a.count || a.label.localeCompare(b.label));
}
const inType = (type: string) => items.filter(w => placeOf(w).type === type);
const inCountry = (type: string, country: string) => inType(type).filter(w => placeOf(w).country === country);
const inRegion = (type: string, country: string, region: string) => inCountry(type, country).filter(w => placeOf(w).region === region);
const facetLabel = (f: Facet) => rowLabel(f.label, String(f.count));
function typeFacets(): Facet[] { return facets(items, p => p.type, TYPE_ORDER); }
function countryFacets(type: string): Facet[] { return facets(inType(type), p => p.country); }
function regionFacets(type: string, country: string): Facet[] { return facets(inCountry(type, country), p => p.region); }

// ═══ VINTAGES & GROUPING ═══
export function vintageShort(wine: LibraryWine): string {
  return wine.vintage ? String(wine.vintage) : wine.metadata?.vintage_state === 'non_vintage' ? 'NV' : '';
}
function vintageLong(wine: LibraryWine): string {
  return wine.vintage ? String(wine.vintage) : wine.metadata?.vintage_state === 'non_vintage' ? 'Non-vintage' : 'Vintage unknown';
}
const vintageRank = (w: LibraryWine) => w.vintage ?? (w.metadata?.vintage_state === 'non_vintage' ? -1 : -2);

/** One row per wine; releases of the same wine (name + producer) sit under it, newest year first. */
export function groupLibrary(items: LibraryWine[]): WineGroup[] {
  const byKey = new Map<string, WineGroup>();
  for (const wine of items) {
    const key = `${wine.producer || ''}|${wine.wine_name}`.toLowerCase().replace(/\s+/g, ' ').trim();
    const group = byKey.get(key);
    if (group) group.wines.push(wine); else byKey.set(key, { title: wine.wine_name, wines: [wine] });
  }
  const result = [...byKey.values()]; // API order: most recently saved first
  for (const g of result) g.wines.sort((a, b) => vintageRank(b) - vintageRank(a));
  return result;
}
/** Keep the vintage visible even when the name has to be shortened. */
function rowLabel(name: string, suffix: string): string {
  if (!suffix) return clipLabel(name);
  const tail = ` · ${suffix}`;
  return clipLabel(name, LIST_LABEL_MAX - labelBytes(tail)) + tail;
}
function groupLabel(g: WineGroup): string {
  return g.wines.length > 1 ? rowLabel(g.title, `${g.wines.length} vintages`) : rowLabel(g.title, vintageShort(g.wines[0]));
}
export function libraryListPage(list: WineGroup[], page: number): ListPage {
  return pageList(list.map(groupLabel), page);
}
function vintageListPage(g: WineGroup, page: number): ListPage {
  return pageList(g.wines.map(w => [vintageLong(w), w.region].filter(Boolean).join(' · ')), page);
}

// ═══ PAGE BUILDERS ═══
// Simulator 0.9.5 metrics: list rows are 40 px; text lines are 27 px and ~9 px per character.
// A list shorter than its container is centred vertically, so lists are sized to their rows.
const LIST_H = wholeRowHeight(240); // 6 rows under a one-line header
const LINE_H = 27;
const CHAR_W = 9.5; // slightly generous so estimates err toward "it wraps"
const charsPerLine = (width: number) => Math.max(8, Math.floor(width / CHAR_W));
function estimateLines(text: string, width: number): number {
  const per = charsPerLine(width);
  return text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil([...p].length / per)), 0);
}
/** "MENDOZA · Argentina": the region shouts, the country answers (the G2 font has one size). */
function captionText(country: string, region: string | null): string {
  const c = country === UNKNOWN_COUNTRY ? '' : country;
  return region && region !== UNKNOWN_REGION ? [region.toUpperCase(), c].filter(Boolean).join(' · ') : c.toUpperCase();
}
/** The moving caption: a text container in the strip above the map, centred over the highlight. */
function captionContainer(plan: ScenePlan, text: string): TextContainerProperty {
  const content = clipLabel(text, charsPerLine(TILE_W - 10));
  const box = captionBox(plan.anchorX, content);
  return new TextContainerProperty({ xPosition: box.x, yPosition: 3, width: box.width, height: MAP_Y - 4, containerID: 9, containerName: 'map-caption', content, isEventCapture: 0 });
}
const mapTiles = (topId: number, bottomId: number) => [
  new ImageContainerProperty({ xPosition: SCENE_X, yPosition: MAP_Y, width: TILE_W, height: TILE_H, containerID: topId, containerName: 'scene-top' }),
  new ImageContainerProperty({ xPosition: SCENE_X, yPosition: MAP_Y + TILE_H, width: TILE_W, height: TILE_H, containerID: bottomId, containerName: 'scene-bottom' }),
];
interface ListMap { plan: ScenePlan; caption: string }
/** A list page; with `map`, the list keeps the left half and the place's map panel fills the right. */
function listScreen(name: string, labels: string[], header: string, map: ListMap | null = null): RebuildPageContainer {
  const rows = Math.min(labels.length, LIST_H / LIST_ROW_PITCH);
  const w = map ? SCENE_X - 6 : 572;
  const title = new TextContainerProperty({
    xPosition: 16, yPosition: 4, width: w - 14, height: 34,
    containerID: 3, containerName: 'library-header', content: clipLabel(header, charsPerLine(w - 14)), isEventCapture: 0,
  });
  const list = new ListContainerProperty({
    xPosition: 2, yPosition: 42, width: w, height: rows * LIST_ROW_PITCH, containerID: 2, containerName: name,
    itemContainer: new ListItemContainerProperty({ itemCount: labels.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: labels }),
    isEventCapture: 1,
  });
  const imageObject = map ? mapTiles(1, 4) : [];
  const textObject = map ? [title, captionContainer(map.plan, map.caption)] : [title];
  return new RebuildPageContainer({ containerTotalNum: 1 + textObject.length + imageObject.length, listObject: [list], textObject, ...(map ? { imageObject } : {}) });
}
/** Map panel for a list page: the country (regions list) or the region (wines list). */
export type PlaceSceneBuilder = (country: string, region: string | null) => Promise<ScenePlan | null>;
let placeScene: PlaceSceneBuilder | null = null;
export function setPlaceSceneBuilder(b: PlaceSceneBuilder | null) { placeScene = b; }
const LIST_MAP_TILES: [number, string][] = [[1, 'scene-top'], [4, 'scene-bottom']];
export function buildLibraryListPage(list: WineGroup[], page: number, offline = false, heading = 'WINEBRARY', map: ListMap | null = null): RebuildPageContainer {
  const paged = libraryListPage(list, page);
  const parts = [heading, `${list.length} ${list.length === 1 ? 'wine' : 'wines'}`];
  if (paged.pageCount > 1) parts.push(`${paged.page + 1}/${paged.pageCount}`);
  if (offline) parts.push('offline copy');
  return listScreen('library-list', paged.labels, parts.join('  ·  '), map);
}
/** Types, countries and regions: one list, rows with wine counts. */
function buildFacetPage(name: string, rows: Facet[], page: number, heading: string, map: ListMap | null = null): RebuildPageContainer {
  const paged = pageList(rows.map(facetLabel), page);
  const parts = [heading];
  if (paged.pageCount > 1) parts.push(`${paged.page + 1}/${paged.pageCount}`);
  if (offlineCopy) parts.push('offline copy');
  return listScreen(name, paged.labels, parts.join('  ·  '), map);
}
function buildVintageListPage(g: WineGroup, page: number): RebuildPageContainer {
  const paged = vintageListPage(g, page);
  return listScreen('library-vintages', paged.labels, `${g.title}  ·  ${g.wines.length} vintages`);
}
const MESSAGES: Record<MessageReason, string> = {
  'signed-out': 'Your Winebrary is private.\n\nSign in with wineLENS on your phone, then open My Winebrary again.',
  loading: 'Opening your Winebrary...',
  empty: 'Your Winebrary is empty.\n\nAdd a wine with wineLENS on your phone and it will appear here.',
  error: 'Your Winebrary could not load.\n\nCheck your phone connection and try again.',
};
function buildMessagePage(reason: MessageReason): RebuildPageContainer {
  return new RebuildPageContainer({ containerTotalNum: 2, textObject: [
    new TextContainerProperty({ xPosition: 48, yPosition: 48, width: 480, height: 168, containerID: 3, containerName: 'library-message', content: MESSAGES[reason], isEventCapture: 1 }),
    new TextContainerProperty({ xPosition: 48, yPosition: 238, width: 480, height: 32, containerID: 4, containerName: 'library-hint', content: 'Double tap to go back', isEventCapture: 0 }),
  ] });
}
/**
 * Detail: bottle left (two 100×120 halves), text column right.
 * Title (1–2 lines) → vintage · producer · region (1 line) → notes (the one capture container,
 * scrollable) → hint. Heights follow the title, so a short name never leaves a gap.
 */
export function buildLibraryWinePage(wine: LibraryWine, backTo: 'Home' | 'Back' | 'Atlas' = 'Home', scene: WinePlace | null = null, plan: ScenePlan | null = null): RebuildPageContainer {
  if (scene && plan) return buildSceneWinePage(wine, backTo, scene, plan);
  const x=wine.image_url ? 132 : 24, width=560-x, per=charsPerLine(width);
  const title=clipLabel(wine.wine_name, per*2);
  const titleH=Math.min(2, estimateLines(title, width))*LINE_H+4;
  const facts=clipLabel([vintageLong(wine), wine.producer, wine.region].filter(Boolean).join(' · '), per);
  const factsY=8+titleH+2, notesY=factsY+LINE_H+10;
  const notesBottom=notesY+Math.floor((248-notesY)/LINE_H)*LINE_H+4; // whole lines, no half-cut row
  const notes=clipBytes([wine.metadata?.grape, wine.notes || 'No notes yet. Add your impressions in Winebrary on your phone.'].filter(Boolean).join('\n'));
  const overflow=estimateLines(notes, width) > Math.floor((notesBottom-notesY)/LINE_H);
  const textObject=[
    new TextContainerProperty({xPosition:x,yPosition:8,width,height:titleH,containerID:3,containerName:'library-title',content:title,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:factsY,width,height:LINE_H+4,containerID:4,containerName:'library-vintage',content:facts,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:notesY,width,height:notesBottom-notesY,containerID:5,containerName:'library-notes',content:notes,isEventCapture:1}),
    new TextContainerProperty({xPosition:x,yPosition:254,width,height:30,containerID:6,containerName:'library-footer',content:overflow ? `Scroll for more  ·  Double tap: ${backTo}` : `Double tap: ${backTo}`,isEventCapture:0}),
  ];
  const imageObject=wine.image_url ? [
    new ImageContainerProperty({xPosition:16,yPosition:24,width:100,height:120,containerID:1,containerName:'bottle-top'}),
    new ImageContainerProperty({xPosition:16,yPosition:144,width:100,height:120,containerID:2,containerName:'bottle-bot'}),
  ] : [];
  return new RebuildPageContainer({containerTotalNum:textObject.length+imageObject.length,textObject,imageObject});
}

/**
 * Detail with the map scene: text column on the left half, the 288×288 map panel on the right
 * (bottle over the country backdrop, region glowing — see wine-scene.ts). G2 draws images above
 * text, so nothing overlaps.
 */
function buildSceneWinePage(wine: LibraryWine, backTo: string, place: WinePlace, plan: ScenePlan): RebuildPageContainer {
  // Left: kicker › name › maker › vintage › rule › notes. Right: the map, with the place as a
  // caption that sits over the region (see wine-scene.ts).
  const x=10, width=SCENE_X-x-8, per=charsPerLine(width);
  const grape=wine.metadata?.grape || lookupWineById(wine.wine_id)?.wine.grape || '';
  const kicker=clipLabel([place.type !== 'Other' ? place.type : '', grape].filter(Boolean).join(' · ').toUpperCase() || 'MY WINEBRARY', per);
  const title=clipLabel(wine.wine_name, per*2);
  const titleH=Math.min(2, estimateLines(title, width))*LINE_H+1;
  const maker=clipLabel(wine.producer || 'Producer not set', per);
  const facts=clipLabel(vintageLong(wine), per);
  let y=4;
  const kickerY=y; y+=LINE_H+1;
  const titleY=y; y+=titleH;
  const makerY=y; y+=LINE_H+1;
  const factsY=y; y+=LINE_H+1;
  const ruleY=y+5; y+=RULE.h+9;
  const notesY=y, notesBottom=notesY+Math.max(1, Math.floor((252-notesY)/LINE_H))*LINE_H+4;
  const notes=clipBytes(wine.notes || 'No notes yet. Add your impressions in Winebrary on your phone.');
  const overflow=estimateLines(notes, width) > Math.floor((notesBottom-notesY)/LINE_H);
  const textObject=[
    new TextContainerProperty({xPosition:x,yPosition:kickerY,width,height:LINE_H+1,containerID:7,containerName:'library-kicker',content:kicker,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:titleY,width,height:titleH,containerID:3,containerName:'library-title',content:title,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:makerY,width,height:LINE_H+1,containerID:4,containerName:'library-vintage',content:maker,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:factsY,width,height:LINE_H+1,containerID:8,containerName:'library-facts',content:facts,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:notesY,width,height:notesBottom-notesY,containerID:5,containerName:'library-notes',content:notes,isEventCapture:1}),
    new TextContainerProperty({xPosition:x,yPosition:256,width,height:30,containerID:6,containerName:'library-footer',content:overflow ? `Scroll · Double tap: ${backTo}` : `Double tap: ${backTo}`,isEventCapture:0}),
    captionContainer(plan, captionText(place.country, place.region)),
  ];
  const imageObject=[
    ...mapTiles(1, 2),
    new ImageContainerProperty({xPosition:x+2,yPosition:ruleY,width:RULE.w,height:RULE.h,containerID:10,containerName:'library-rule'}),
  ];
  return new RebuildPageContainer({containerTotalNum:textObject.length+imageObject.length,textObject,imageObject});
}
const RULE = { w: 240, h: 8 };
/** A map panel only when the place is on the map (unknown countries keep the full-width list). */
async function mapFor(country: string, region: string | null): Promise<ListMap | null> {
  if (!placeScene || country === UNKNOWN_COUNTRY) return null;
  if (!items.some(w => { const p = placeOf(w); return p.country === country && p.mapped; })) return null;
  const r = region && region !== UNKNOWN_REGION ? region : null;
  try {
    const plan = await placeScene(country, r);
    return plan ? { plan, caption: captionText(country, r) } : null;
  } catch { return null; }
}
/** "WINEBRARY / RED / ARGENTINA": where you are, shortened from the left when it runs long. */
function crumb(parts: string[], max = 50): string {
  const all = ['WINEBRARY', ...parts.map(p => p.toUpperCase())];
  let text = all.join(' / ');
  for (let i = 1; [...text].length > max && i < all.length - 1; i++) text = ['…', ...all.slice(i + 1)].join(' / ');
  return text;
}
const SCENE_TILE_NAMES: [number, string][] = [[1, 'scene-top'], [2, 'scene-bottom']];

// ═══ RENDER & NAVIGATION ═══
async function render(next: Screen): Promise<void> {
  if (!bridge) throw new Error('Glasses are not connected.');
  invalidateImages();
  let page: RebuildPageContainer;
  let scenePlace: WinePlace | null = null;
  let listMap: ListMap | null = null;
  let plan: ScenePlan | null = null;
  if (next.kind === 'types') page = buildFacetPage('library-types', typeFacets(), next.page, `WINEBRARY  ·  ${items.length} ${items.length === 1 ? 'wine' : 'wines'}`);
  else if (next.kind === 'countries') page = buildFacetPage('library-countries', countryFacets(next.type), next.page, crumb([next.type]));
  else if (next.kind === 'regions') { listMap = await mapFor(next.country, null); page = buildFacetPage('library-regions', regionFacets(next.type, next.country), next.page, listMap ? crumb([next.type], 24) : crumb([next.type, next.country]), listMap); }
  else if (next.kind === 'list') { listMap = await mapFor(next.country, next.region); groups = groupLibrary(inRegion(next.type, next.country, next.region)); page = buildLibraryListPage(groups, next.page, offlineCopy, listMap ? next.type.toUpperCase() : crumb([next.type, next.country, next.region], 30), listMap); }
  else if (next.kind === 'vintages') page = buildVintageListPage(next.group, next.page);
  else if (next.kind === 'detail') {
    let place = places.get(next.wine.id) ?? null;
    if (!place && placer) { try { place = (await placer([next.wine])).get(next.wine.id) ?? null; } catch { place = null; } }
    scenePlace = sceneBuilder && place?.mapped ? place : null;
    if (scenePlace && sceneBuilder) { try { plan = await sceneBuilder(next.wine); } catch { plan = null; } }
    page = buildLibraryWinePage(next.wine, next.from === 'phone' ? 'Home' : next.from === 'atlas' ? 'Atlas' : 'Back', plan ? scenePlace : null, plan);
  }
  else page = buildMessagePage(next.reason);
  await claimDisplay('library', relinquish);
  if (!await bridge.rebuildPageContainer(page)) throw new Error('The glasses did not accept this page. Try again.');
  active = true; screen = next; lastNavigation = Date.now();
  const epoch = currentImageEpoch();
  if (listMap) {
    try {
      const tiles = await listMap.plan.render();
      for (let i = 0; i < LIST_MAP_TILES.length; i++) await pushGrayImage(bridge, LIST_MAP_TILES[i][0], LIST_MAP_TILES[i][1], TILE_W, TILE_H, tiles[i], epoch);
    } catch (error) { console.warn('[wineLENS] place map unavailable', error); }
  }
  if (next.kind !== 'detail') return;
  if (plan) {
    // Text is already up; the hairline rule, then the map scene (app image queue).
    try {
      const rule = ruleCanvas(RULE.w, RULE.h);
      await pushGrayImage(bridge, 10, 'library-rule', RULE.w, RULE.h, toGreenLevels(rule.getContext('2d')!.getImageData(0, 0, RULE.w, RULE.h).data, RULE.w), epoch);
    } catch (error) { console.warn('[wineLENS] rule unavailable', error); }
    try {
      const tiles = await plan.render();
      for (let i = 0; i < SCENE_TILE_NAMES.length; i++) await pushGrayImage(bridge, SCENE_TILE_NAMES[i][0], SCENE_TILE_NAMES[i][1], TILE_W, TILE_H, tiles[i], epoch);
    } catch (error) { console.warn('[wineLENS] Wine map unavailable; text stays readable.', error); }
  } else if (next.wine.image_url) {
    try { await pushBottlePhoto(bridge, next.wine.image_url, 100, 120); }
    catch (error) { console.warn('[wineLENS] Bottle image unavailable; text stays readable.', error); }
  }
}
async function goHome(): Promise<void> {
  if (!bridge) return;
  invalidateImages();
  if (!await bridge.rebuildPageContainer(rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  active=false; screen=null; lastNavigation=Date.now();
  dropDisplay('library');
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}
/** Another module took the display (e.g. the Wine Atlas from the phone): stop consuming events. */
function relinquish(): void { active=false; screen=null; }
/** One navigation at a time; a rejected page leaves the previous screen and state untouched. */
async function settle(task: () => Promise<void>): Promise<void> {
  if (sending) return;
  sending = true;
  try { await task(); } catch (error) { console.error('[wineLENS] Winebrary glasses: ' + (error instanceof Error ? error.message : String(error))); }
  finally { sending = false; }
}

/** Entry from the glasses home menu. */
export async function openLibraryOnGlasses(): Promise<void> {
  await settle(async () => {
    const source = readSource();
    offlineCopy = false;
    items = source.items;
    if (!source.userId) { items = []; return render({ kind: 'message', reason: 'signed-out' }); }
    if (!items.length && source.error) {
      const cached = await loadLibraryCache(source.userId);
      if (cached?.items.length) { items = cached.items; offlineCopy = true; }
    }
    if (!items.length) return render({ kind: 'message', reason: source.loading ? 'loading' : source.error ? 'error' : 'empty' });
    await refreshPlaces(items);
    return render({ kind: 'types', page: 0 });
  });
}
/** Called by the phone companion when the collection finishes loading or changes. */
export function libraryChanged(): void {
  window.dispatchEvent(new Event('winelens-library-changed'));
  if (!active || screen?.kind !== 'message' || screen.reason === 'signed-out') return;
  void openLibraryOnGlasses();
}

async function back(): Promise<void> {
  const s = screen;
  if (!s || s.kind === 'message') return goHome();
  if (s.kind === 'detail') {
    if (s.from === 'phone') return goHome();
    if (s.from === 'atlas') {
      const back = atlasReturn; atlasReturn = null;
      active = false; screen = null; dropDisplay('library');
      if (back) return back();
      return goHome();
    }
    return s.parent ? render(s.parent) : goHome();
  }
  if (s.kind === 'vintages') return s.page > 0 ? render({ ...s, page: s.page - 1 }) : render(s.parent);
  if (s.page > 0) return render({ ...s, page: s.page - 1 });
  if (s.kind === 'list') return render({ kind: 'regions', type: s.type, country: s.country, page: 0 });
  if (s.kind === 'regions') return render({ kind: 'countries', type: s.type, page: 0 });
  if (s.kind === 'countries') return render({ kind: 'types', page: 0 });
  return goHome();
}
async function select(index: number): Promise<void> {
  const s = screen;
  if (!s || s.kind === 'detail') return;
  if (s.kind === 'message') return goHome();
  if (s.kind === 'types' || s.kind === 'countries' || s.kind === 'regions') {
    const rows = s.kind === 'types' ? typeFacets() : s.kind === 'countries' ? countryFacets(s.type) : regionFacets(s.type, s.country);
    const row = pageList(rows.map(facetLabel), s.page).rows[index];
    if (!row) return;
    if (row.kind === 'back') return back();
    if (row.kind === 'more') return render({ ...s, page: s.page + 1 });
    const label = rows[row.index].label;
    if (s.kind === 'types') return render({ kind: 'countries', type: label, page: 0 });
    if (s.kind === 'countries') return render({ kind: 'regions', type: s.type, country: label, page: 0 });
    return render({ kind: 'list', type: s.type, country: s.country, region: label, page: 0 });
  }
  if (s.kind === 'list') {
    const row = libraryListPage(groups, s.page).rows[index];
    if (!row) return;
    if (row.kind === 'back') return back();
    if (row.kind === 'more') return render({ ...s, page: s.page + 1 });
    const group = groups[row.index];
    if (group.wines.length === 1) return render({ kind: 'detail', wine: group.wines[0], from: 'library', parent: s });
    return render({ kind: 'vintages', group, page: 0, parent: s });
  }
  const row = vintageListPage(s.group, s.page).rows[index];
  if (!row) return;
  if (row.kind === 'back') return back();
  if (row.kind === 'more') return render({ ...s, page: s.page + 1 });
  return render({ kind: 'detail', wine: s.group.wines[row.index], from: 'library', parent: s });
}

/** Wine Atlas › region › wine: show one account wine; double tap goes back to the Atlas. */
export async function showWineFromAtlas(wine: LibraryWine, back: () => Promise<void>) {
  if (!bridge) throw new Error('Glasses are not connected.');
  atlasReturn = back;
  await settle(() => render({ kind: 'detail', wine, from: 'atlas', parent: null }));
}

/** Sent from the phone: show one account wine; double tap returns home. */
export async function showWineOnGlasses(wine: LibraryWine) {
  if (!canShowWine()) throw new Error('Connect your Even G2 glasses first.');
  sending=true;
  try { await render({ kind: 'detail', wine, from: 'phone', parent: null }); }
  finally { sending=false; }
}

// While this module owns the display, legacy catalog handlers must not receive its taps.
export function handleLibraryGlassesEvent(event: EvenHubEvent): boolean {
  if (!active) return false;
  const type=event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return true;
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) { void settle(back); return true; }
  const isClick = type === undefined || type === OsEventTypeList.CLICK_EVENT;
  if (!isClick || Date.now() - lastNavigation < NAV_SETTLE_MS) return true;
  if (event.listEvent) { const index = event.listEvent.currentSelectItemIndex ?? 0; void settle(() => select(index)); }
  else if (event.textEvent && screen?.kind === 'message') void settle(goHome);
  return true;
}

export async function clearPrivateGlasses() {
  window.dispatchEvent(new Event('winelens-library-changed'));   // the Atlas drops account wines too
  if (!active || !bridge) return;
  invalidateImages();
  const accepted=await bridge.rebuildPageContainer(rebuildHomePage());
  if (accepted) { active=false; screen=null; groups=[]; items=[]; places=new Map(); dropDisplay('library'); window.dispatchEvent(new Event('winelens-glasses-home')); }
}

// ═══ OFFLINE COPY ═══
// Text-only snapshot of the signed-in account, kept in Even Hub storage so the glasses can
// still browse when the phone has no connection. Signed image links expire, so they are
// dropped. The copy is tied to the account id and cleared on sign-out or account switch.
const CACHE_KEY = 'winelens_library_cache_v1';
let pendingCache: string | null = null;
async function writeCache(value: string) {
  if (!bridge) { pendingCache = value; return; }
  try { await bridge.setLocalStorage(CACHE_KEY, value); } catch (error) { console.warn('[wineLENS] Offline copy not saved', error); }
}
async function flushPendingCache() { if (pendingCache !== null) { const value = pendingCache; pendingCache = null; await writeCache(value); } }
export async function saveLibraryCache(userId: string, items: LibraryWine[]) {
  const slim = items.map(({ image_url: _expiringUrl, ...wine }) => wine);
  await writeCache(JSON.stringify({ userId, savedAt: new Date().toISOString(), items: slim }));
}
export async function loadLibraryCache(userId: string): Promise<{ savedAt: string; items: LibraryWine[] } | null> {
  if (!bridge) return null;
  try {
    const raw = await bridge.getLocalStorage(CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data?.userId === userId && Array.isArray(data.items) ? data : null;
  } catch { return null; }
}
export async function clearLibraryCache() { await writeCache(''); }

// Same coordinates as the SDK payload, with a browser font approximation.
export async function drawGlassesPreview(wine: LibraryWine, canvas: HTMLCanvasElement) {
  canvas.width=576;canvas.height=288;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#000';ctx.fillRect(0,0,576,288);
  const page=buildLibraryWinePage(wine);
  ctx.fillStyle='#91DA8B';ctx.font='18px Arial';ctx.textBaseline='top';
  for(const box of page.textObject || []) {
    const x=box.xPosition ?? 0, top=box.yPosition ?? 0, width=box.width ?? 0, height=box.height ?? 0;
    ctx.save();ctx.beginPath();ctx.rect(x,top,width,height);ctx.clip();
    let y=top;
    for (const paragraph of (box.content || '').split('\n')) {
      let line='';
      for(const word of paragraph.split(' ')) {
        if(line && ctx.measureText(line+' '+word).width>width) {ctx.fillText(line,x,y);y+=23;line=word;}
        else line+=(line?' ':'')+word;
      }
      ctx.fillText(line,x,y);y+=23;
    }
    ctx.restore();
  }
  if(wine.image_url) {
    const image=(page.imageObject || [])[0];
    try {
      const photo=await bottleCanvas(wine.image_url,100,240);
      const pixels=photo.getContext('2d')!.getImageData(0,0,100,240);
      for(let i=0;i<pixels.data.length;i+=4){const v=Math.round((.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2])/17)*17;pixels.data[i]=v*.57;pixels.data[i+1]=v*.85;pixels.data[i+2]=v*.55;}
      ctx.putImageData(pixels,image?.xPosition ?? 16,image?.yPosition ?? 24);
    } catch { /* Text remains readable when the image cannot load. */ }
  }
}
