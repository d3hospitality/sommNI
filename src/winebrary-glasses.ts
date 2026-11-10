import {savedLocations,atLocation} from './saved-locations';
import {searchLibrary} from './library-search';
import {AtlasVoiceCapture} from './atlas/voice-capture';
import {betaProvider} from './beta/client';
import {getLocale} from './intelligence/client';
import {wineOrigin} from './wine-origin';
import { foodPairingsText } from './food-pairings';
import { cursorRows, moveCursor } from './glasses-cursor';
import { openLabelGlasses } from './research/label-glasses';
import { announceWineContext, libraryContext, libraryPhoto } from './wine-context';
import { openAddWineGlasses } from './research/glasses-add';
import { localWineArtwork } from './artwork-store';
import { getCatalogAnecdote, anecdotePublishers } from './catalog-anecdotes';
import { referenceNotes } from './reference-notes';
import { readableText, READING_MAX_BYTES } from './reading/document';
import { textParagraphs } from './history/content';
import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerUpgrade, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import type { LibraryWine } from './winebrary';
import { rebuildGlassesPage, pushBottlePhoto, invalidateImages, pushLogoToGlasses, pushGrayImage, currentImageEpoch, queueBridgeControl } from './image-utils';
import { SCENE_X, MAP_Y, TILE_W, TILE_H, CAPTION_MIN_X, captionBox, type ScenePlan } from './wine-scene';
import { ruleCanvas, toGreenLevels } from './bottle-raster';
import { lookupWineById, allCatalogWines, catalogPhoto } from './identity';
import { claimDisplay, dropDisplay } from './display';
import { stageCanvas } from './bottle-raster';
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
type Screen = (
  | { kind: 'types'; page: number }
  | { kind: 'all'; page: number; location?:string; query?:string; parent?:Screen }
  | { kind:'locations'; page:number }
  | { kind:'voice'; page:number; parent:Screen|null; message:string }
  | { kind: 'countries'; type: string; page: number }
  | { kind: 'regions'; type: string; country: string; page: number }
  | { kind: 'list'; type: string; country: string; region: string; page: number }
  | { kind: 'vintages'; group: WineGroup; page: number; parent: Screen }
  | { kind: 'detail'; wine: LibraryWine; from: 'library' | 'phone' | 'atlas'; parent: Screen | null }
  | { kind: 'message'; reason: MessageReason }) & { cursor?: number };

let bridge: EvenAppBridge | null = null;
let connected = false;
let active = false;
let sending = false;
let baseUrl = '';
let screen: Screen | null = null;
let allWines: LibraryWine[] = [];
let groups: WineGroup[] = [];   // wines on the current list screen
let items: LibraryWine[] = [];   // the whole library (or its offline copy)
let offlineCopy = false;
let lastNavigation = 0;
const NAV_SETTLE_MS = 350; // swallow the ghost click that can follow a page rebuild
let readSource: () => LibrarySource = () => ({ userId: null, loading: false, error: '', items: [] });

export function connectWinebraryGlasses(value: EvenAppBridge, url: string) { bridge=value; baseUrl=url; void flushPendingCache(); }
export function setWinebraryDeviceConnected(value: boolean) { connected=value;window.dispatchEvent(new Event('sommni-glasses-connection'));if(!value){void pauseLibraryVoice();cancelListPreview();announceWineContext(null);}else void resumeLibraryVoice(); }
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

export const TYPE_ORDER = ['Red', 'White', 'Sparkling', 'Rosé', 'Orange', 'Dessert', 'Sake', 'Other'];
const UNKNOWN_COUNTRY = 'Country not set', UNKNOWN_REGION = 'Region not set';
export function wineTypeOf(wine: LibraryWine): string {
  const c = (wine.metadata?.color || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ({ red: 'Red', white: 'White', sparkling: 'Sparkling', rose: 'Rosé', orange: 'Orange', dessert: 'Dessert', sake: 'Sake' } as Record<string, string>)[c] ?? 'Other';
}
/** The wine's own fields: "Place, CC" or metadata.country. */
export function fallbackPlace(wine: LibraryWine): WinePlace {
  const origin=wineOrigin(wine.metadata?.country,wine.region,wine.metadata?.state);
  return {type:wineTypeOf(wine),country:origin.country||UNKNOWN_COUNTRY,region:origin.region||origin.subdivision||UNKNOWN_REGION,mapped:false};
}
const placeOf = (wine: LibraryWine) => places.get(wine.id) ?? fallbackPlace(wine);
async function refreshPlaces(list: LibraryWine[]): Promise<void> {
  places = new Map();
  if (!placer) return;
  try { places = await placer(list); } catch (error) { console.warn('[sommNI] Winebrary places unavailable; using the wines\' own fields.', error); }
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

/** Country and region lines are visual context only, never cursor targets. */
export function allWineRows(wines: LibraryWine[], index: number, width: number, searchAgain=false): string {
  const budget = Math.max(8, Math.floor(width / CHAR_W) - 5);
  const lines: string[] = [];
  let country = '', region = '';
  for (let i = Math.max(0, index - 1); i <= wines.length+(searchAgain?1:0); i++) {
    const row: string[] = [];
    if (i >= wines.length) row.push(`${i === index ? '>' : ' '} ${searchAgain&&i===wines.length?'Search by Voice':'Back'}`);
    else {
      const place = placeOf(wines[i]);
      if (place.country !== country) {
        if (lines.length) row.push('');
        row.push(`   ${clipLabel(place.country, budget)}`);
      }
      if (place.country !== country || place.region !== region) row.push(`     ${clipLabel(place.region, budget - 2)}`);
      row.push(`${i === index ? '>' : ' '} ${clipLabel(rowLabel(wines[i].wine_name, vintageShort(wines[i])), budget + 2)}`);
      country = place.country; region = place.region;
    }
    if (lines.length + row.length > 7) break;
    lines.push(...row);
  }
  return lines.join('\n');
}
function allWineMap(): ListMap {
  // Keep image containers present across countries, including wines without a mapped origin.
  return {caption: '', plan: {anchorX:100, anchorY:100, render:async()=>[new Uint8Array(TILE_W*TILE_H),new Uint8Array(TILE_W*TILE_H)]}};
}
function libraryMenuLabels(): string[] {
  return ['View All', 'Add Wine by Voice', ...typeFacets().map(facetLabel), ...(items.length?['Polish Labels']:[]), 'Search by Voice', 'Saved Locations', 'Back'];
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
  const content = clipLabel(text, charsPerLine(576 - CAPTION_MIN_X - 18));
  const box = captionBox(plan.anchorX, content);
  return new TextContainerProperty({ xPosition: box.x, yPosition: 3, width: box.width, height: MAP_Y - 4, containerID: 9, containerName: 'map-caption', content, isEventCapture: 0 });
}
const mapTiles = (topId: number, bottomId: number) => [
  new ImageContainerProperty({ xPosition: SCENE_X, yPosition: MAP_Y, width: TILE_W, height: TILE_H, containerID: topId, containerName: 'scene-top' }),
  new ImageContainerProperty({ xPosition: SCENE_X, yPosition: MAP_Y + TILE_H, width: TILE_W, height: TILE_H, containerID: bottomId, containerName: 'scene-bottom' }),
];
interface ListMap { plan: ScenePlan; caption: string }
/** A list page; with `map`, the list keeps the left half and the place's map panel fills the right. */
function listScreen(name: string, labels: string[], header: string, map: ListMap | null = null, cursor = 0): RebuildPageContainer {
  const rows = Math.min(labels.length, LIST_H / LIST_ROW_PITCH);
  const w = map ? SCENE_X - 6 : 572;
  const caption = map ? captionContainer(map.plan, map.caption) : null;
  if(caption&&['library-list','library-vintages','library-all'].includes(name)){caption.xPosition=CAPTION_MIN_X;caption.width=576-CAPTION_MIN_X-2;}
  const headerW = caption ? (caption.xPosition ?? SCENE_X) - 24 : w - 14;
  const title = new TextContainerProperty({
    xPosition: 16, yPosition: 4, width: headerW, height: 34,
    containerID: 3, containerName: 'library-header', content: clipLabel(header, charsPerLine(headerW)), isEventCapture: 0,
  });
  if (name === 'library-list' || name === 'library-vintages' || name === 'library-all' || name === 'library-types') {
    const capture = new TextContainerProperty({xPosition:12,yPosition:42,width:w-12,height:210,containerID:2,containerName:name,content:name==='library-all'?allWineRows(allWines,cursor,w-12,screen?.kind==='all'&&screen.query!==undefined):cursorRows(labels,cursor,w-12),isEventCapture:1});
    const imageObject = map ? mapTiles(1,4) : [];
    const textObject = [title, capture, ...(caption ? [caption] : [])];
    return new RebuildPageContainer({containerTotalNum:textObject.length+imageObject.length,textObject,imageObject});
  }
  const list = new ListContainerProperty({
    xPosition: 2, yPosition: 42, width: w, height: rows * LIST_ROW_PITCH, containerID: 2, containerName: name,
    itemContainer: new ListItemContainerProperty({ itemCount: labels.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: labels }),
    isEventCapture: 1,
  });
  const imageObject = map ? mapTiles(1, 4) : [];
  const textObject = caption ? [title, caption] : [title];
  return new RebuildPageContainer({ containerTotalNum: 1 + textObject.length + imageObject.length, listObject: [list], textObject, ...(map ? { imageObject } : {}) });
}
/** Map panel for a list page: the country (regions list) or the region (wines list). */
export type PlaceSceneBuilder = (country: string, region: string | null) => Promise<ScenePlan | null>;
let placeScene: PlaceSceneBuilder | null = null;
export function setPlaceSceneBuilder(b: PlaceSceneBuilder | null) { placeScene = b; }
const LIST_MAP_TILES: [number, string][] = [[1, 'scene-top'], [4, 'scene-bottom']];
export function buildLibraryListPage(list: WineGroup[], page: number, offline = false, heading = 'WINEBRARY', map: ListMap | null = null, cursor = 0): RebuildPageContainer {
  const paged = libraryListPage(list, page);
  const parts = [heading, `${list.length} ${list.length === 1 ? 'wine' : 'wines'}`];
  if (paged.pageCount > 1) parts.push(`${paged.page + 1}/${paged.pageCount}`);
  if (offline) parts.push('offline copy');
  return listScreen('library-list', paged.labels, parts.join('  ·  '), map, cursor);
}
/** Types, countries and regions: one list, rows with wine counts. */
function buildFacetPage(name: string, rows: Facet[], page: number, heading: string, map: ListMap | null = null): RebuildPageContainer {
  const paged = pageList(rows.map(facetLabel), page);
  const parts = [heading];
  if (paged.pageCount > 1) parts.push(`${paged.page + 1}/${paged.pageCount}`);
  if (offlineCopy) parts.push('offline copy');
  return listScreen(name, paged.labels, parts.join('  ·  '), map);
}
function buildVintageListPage(g: WineGroup, page: number, map: ListMap | null = null, cursor = 0): RebuildPageContainer {
  const paged = vintageListPage(g, page);
  return listScreen('library-vintages', paged.labels, `${g.title}  ·  ${g.wines.length} vintages`, map, cursor);
}
const MESSAGES: Record<MessageReason, string> = {
  'signed-out': 'Your Winebrary is private.\n\nSign in with sommNI on your phone, then open My Winebrary again.',
  loading: 'Opening your Winebrary...',
  empty: 'Your Winebrary is empty.\n\nChoose Add Wine by Voice to say a bottle name, or add a label photo on your phone.',
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
export function libraryReading(wine: LibraryWine): string {
  const catalog=lookupWineById(wine.wine_id)?.wine;
  const anecdote=wine.wine_id?getCatalogAnecdote(wine.wine_id):undefined;
  const reference=wine.metadata?.tasting_notes || (catalog ? [catalog.appearance,catalog.nose,catalog.palate,catalog.finish].filter(Boolean).join('\n\n') : '');
  const sections=[(wine.metadata?.rice_variety || wine.metadata?.grape) || catalog?.grape,
    reference ? 'TASTING PROFILE\n'+referenceNotes(reference) : !wine.notes ? 'No notes yet. Add your impressions on your phone.' : '',
    foodPairingsText({grape:wine.metadata?.grape||catalog?.grape,color:wine.metadata?.color,style:catalog?.style}),
    wine.notes ? 'YOUR NOTES\n'+wine.notes : '',
    catalog?.anecdote ? 'BEHIND THE WINE\n'+(anecdote?anecdote.title+'\n\n':'')+textParagraphs(catalog.anecdote).join('\n\n') : '',
    anecdote?(anecdote.scope==='producer'?'Producer history':'Wine history')+' · AI-researched\n'+anecdotePublishers(anecdote.wine_id).join(' · '):'',
  ].filter(Boolean).join('\n\n');
  if(labelBytes(sections)<=READING_MAX_BYTES)return sections;
  const tail='\n\nContinued in Winebrary on your phone.';
  return clipBytes(sections,READING_MAX_BYTES-labelBytes(tail))+tail;
}
export function buildLibraryWinePage(wine: LibraryWine, backTo: 'Home' | 'Back' | 'Atlas' = 'Home', scene: WinePlace | null = null, plan: ScenePlan | null = null): RebuildPageContainer {
  if (scene && plan) return buildSceneWinePage(wine, backTo, scene, plan);
  const x=wine.image_url ? 132 : 24, width=560-x, per=charsPerLine(width);
  const title=clipLabel(wine.wine_name, per*2);
  const titleH=Math.min(2, estimateLines(title, width))*LINE_H+4;
  const facts=clipLabel([vintageLong(wine), wine.producer, wine.region].filter(Boolean).join(' · '), per);
  const factsY=8+titleH+2, notesY=factsY+LINE_H+10;
  const notesBottom=notesY+Math.floor((248-notesY)/LINE_H)*LINE_H+4; // whole lines, no half-cut row
  const notes=libraryReading(wine);
  const overflow=estimateLines(notes, width) > Math.floor((notesBottom-notesY)/LINE_H);
  const textObject=[
    new TextContainerProperty({xPosition:x,yPosition:8,width,height:titleH,containerID:3,containerName:'library-title',content:title,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:factsY,width,height:LINE_H+4,containerID:4,containerName:'library-vintage',content:facts,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:notesY,width,height:notesBottom-notesY,containerID:5,containerName:'library-notes',content:notes,isEventCapture:1}),
    new TextContainerProperty({xPosition:x,yPosition:254,width,height:30,containerID:6,containerName:'library-footer',content:`Tap: labels · 2x: ${backTo}`,isEventCapture:0}),
  ];
  const imageObject=wine.image_url ? [
    new ImageContainerProperty({xPosition:16,yPosition:24,width:100,height:120,containerID:1,containerName:'bottle-top'}),
    new ImageContainerProperty({xPosition:16,yPosition:144,width:100,height:120,containerID:2,containerName:'bottle-bot'}),
  ] : [];
  return readableText(new RebuildPageContainer({containerTotalNum:textObject.length+imageObject.length,textObject,imageObject}),5,notes);
}

/**
 * Detail with the map scene: text column on the left half, the 288×288 map panel on the right
 * (bottle over the country backdrop, region glowing — see wine-scene.ts). G2 draws images above
 * text, so nothing overlaps.
 */
function buildSceneWinePage(wine: LibraryWine, backTo: string, place: WinePlace, plan: ScenePlan): RebuildPageContainer {
  // Left (most of the screen): kicker › name › maker · vintage › rule › notes.
  // Right (narrow panel): the bottle standing on its region, the place caption above it.
  const caption=captionContainer(plan, captionText(place.country, place.region));
  const x=10, width=SCENE_X-x-8, per=charsPerLine(width);
  const kickerW=(caption.xPosition ?? SCENE_X)-x-12;
  const grape=(wine.metadata?.rice_variety || wine.metadata?.grape) || lookupWineById(wine.wine_id)?.wine.grape || '';
  const kicker=clipLabel([place.type !== 'Other' ? place.type : '', grape].filter(Boolean).join(' · ').toUpperCase() || 'MY WINEBRARY', charsPerLine(kickerW));
  const title=clipLabel(wine.wine_name, per*2);
  const titleH=Math.min(2, estimateLines(title, width))*LINE_H+1;
  const maker=clipLabel([wine.producer, vintageLong(wine)].filter(Boolean).join(' · '), per);
  let y=4;
  const kickerY=y; y+=LINE_H+3;
  const titleY=y; y+=titleH;
  const makerY=y; y+=LINE_H+1;
  const ruleY=y+4; y+=RULE.h+8;
  const notesY=y, notesBottom=notesY+Math.max(1, Math.floor((254-notesY)/LINE_H))*LINE_H+4;
  const notes=libraryReading(wine);
  const overflow=estimateLines(notes, width) > Math.floor((notesBottom-notesY)/LINE_H);
  const textObject=[
    new TextContainerProperty({xPosition:x,yPosition:kickerY,width:kickerW,height:LINE_H+1,containerID:7,containerName:'library-kicker',content:kicker,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:titleY,width,height:titleH,containerID:3,containerName:'library-title',content:title,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:makerY,width,height:LINE_H+1,containerID:4,containerName:'library-vintage',content:maker,isEventCapture:0}),
    new TextContainerProperty({xPosition:x,yPosition:notesY,width,height:notesBottom-notesY,containerID:5,containerName:'library-notes',content:notes,isEventCapture:1}),
    new TextContainerProperty({xPosition:x,yPosition:258,width,height:28,containerID:6,containerName:'library-footer',content:`Tap: labels · 2x: ${backTo}`,isEventCapture:0}),
    caption,
  ];
  const imageObject=[
    ...mapTiles(1, 2),
    new ImageContainerProperty({xPosition:x+2,yPosition:ruleY,width:RULE.w,height:RULE.h,containerID:10,containerName:'library-rule'}),
  ];
  return readableText(new RebuildPageContainer({containerTotalNum:textObject.length+imageObject.length,textObject,imageObject}),5,notes);
}
const RULE = { w: 288, h: 20 }; // G2 image minimum; the drawn rule is still one pixel.
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
  if(next.kind==='detail')next={...next,wine:{...next.wine,image_url:libraryPhoto(next.wine)||undefined}};
  cancelListPreview(false);
  invalidateImages();
  let page: RebuildPageContainer;
  let scenePlace: WinePlace | null = null;
  let listMap: ListMap | null = null;
  let plan: ScenePlan | null = null;
  if (next.kind === 'types') page = listScreen('library-types', libraryMenuLabels(), `Winebrary · ${items.length} wines`, null, next.cursor ?? 0);
  else if (next.kind === 'all') {
    const scoped=items.filter(w=>atLocation(w,next.location||''));allWines = (next.query!==undefined?searchLibrary(scoped,next.query):[...scoped]).sort((a,b)=>placeOf(a).country.localeCompare(placeOf(b).country)||placeOf(a).region.localeCompare(placeOf(b).region)||a.wine_name.localeCompare(b.wine_name)||vintageRank(b)-vintageRank(a));
    next.cursor = Math.min(next.cursor ?? 0, allWines.length+(next.query!==undefined?1:0));
    const wine = allWines[next.cursor];
    const place = wine ? placeOf(wine) : null;
    listMap = place ? await mapFor(place.country,place.region) : null;
    listMap = await bottleMap(listMap || allWineMap(),wine);
    // Origin dividers live in the list; reserve the caption strip for stable layout.
    listMap!.caption = '';
    page = listScreen('library-all', [], `${next.query!==undefined?'Results':next.location||'View All'} · ${allWines.length} wines`, listMap, next.cursor);
    page.textObject!.find(t=>t.containerName==='library-all')!.content=allWineRows(allWines,next.cursor,SCENE_X-18,next.query!==undefined);
  }
  else if(next.kind==='voice')page=new RebuildPageContainer({containerTotalNum:1,textObject:[new TextContainerProperty({containerID:2,containerName:'library-voice',xPosition:16,yPosition:8,width:544,height:272,isEventCapture:1,content:'Search by Voice\n\n'+next.message.slice(0,240)+'\n\nDouble tap: cancel'})]});
  else if(next.kind==='locations'){const locations=savedLocations(items);page=listScreen('library-places',pageList(locations.map(l=>l.name+' · '+l.count+'w'),next.page).labels,'Saved Locations');if(!locations.length){page.textObject!.push(new TextContainerProperty({containerID:6,containerName:'places-help',xPosition:16,yPosition:100,width:544,height:162,isEventCapture:0,content:'Name a restaurant when importing its menu on the phone. Saved lists appear here.'}));page.containerTotalNum!++;}}
  else if (next.kind === 'countries') page = buildFacetPage('library-country', countryFacets(next.type), next.page, crumb([next.type]));
  else if (next.kind === 'regions') { listMap = await mapFor(next.country, null); page = buildFacetPage('library-regions', regionFacets(next.type, next.country), next.page, listMap ? crumb([next.type], 24) : crumb([next.type, next.country]), listMap); }
  else if (next.kind === 'list') { listMap = await mapFor(next.country, next.region); groups = groupLibrary(inRegion(next.type, next.country, next.region)); const row=libraryListPage(groups,next.page).rows[next.cursor ?? 0]; listMap=await bottleMap(listMap,row?.kind==='item'?groups[row.index]?.wines[0]:null); page = buildLibraryListPage(groups, next.page, offlineCopy, listMap ? next.type.toUpperCase() : crumb([next.type, next.country, next.region], 30), listMap, next.cursor ?? 0); }
  else if (next.kind === 'vintages') { const wine=next.group.wines[0]; const place=placeOf(wine); listMap=await mapFor(place.country,place.region); const row=vintageListPage(next.group,next.page).rows[next.cursor ?? 0]; listMap=await bottleMap(listMap,row?.kind==='item'?next.group.wines[row.index]:null); page = buildVintageListPage(next.group, next.page, listMap, next.cursor ?? 0); }
  else if (next.kind === 'detail') {
    let place = places.get(next.wine.id) ?? null;
    if (!place && placer) { try { place = (await placer([next.wine])).get(next.wine.id) ?? null; } catch { place = null; } }
    scenePlace = sceneBuilder && place?.mapped ? place : null;
    if (scenePlace && sceneBuilder) { try { plan = await sceneBuilder(next.wine); } catch { plan = null; } }
    page = buildLibraryWinePage(next.wine, next.from === 'phone' ? 'Home' : next.from === 'atlas' ? 'Atlas' : 'Back', plan ? scenePlace : null, plan);
  }
  else page = buildMessagePage(next.reason);
  await claimDisplay('library', relinquish);
  if (!await rebuildGlassesPage(bridge, page)) throw new Error('The glasses did not accept this page. Try again.');
  active = true; screen = next; selectedListMap = listMap; lastNavigation = Date.now();
  if(next.kind==='detail')announceWineContext(libraryContext(next.wine));
  else if(next.kind==='all'||next.kind==='regions'||next.kind==='list'||next.kind==='countries'||next.kind==='vintages')previewLibrarySelection(next.cursor ?? 0);
  else announceWineContext(null);
  const epoch = currentImageEpoch();
  if (listMap) {
    try {
      const tiles = await listMap.plan.render();
      for (let i = 0; i < LIST_MAP_TILES.length; i++) await pushGrayImage(bridge, LIST_MAP_TILES[i][0], LIST_MAP_TILES[i][1], TILE_W, TILE_H, tiles[i], epoch);
    } catch (error) { console.warn('[sommNI] place map unavailable', error); }
  }
  if (next.kind !== 'detail') return;
  if (plan) {
    // Text is already up; the hairline rule, then the map scene (app image queue).
    try {
      const rule = ruleCanvas(RULE.w, RULE.h);
      await pushGrayImage(bridge, 10, 'library-rule', RULE.w, RULE.h, toGreenLevels(rule.getContext('2d')!.getImageData(0, 0, RULE.w, RULE.h).data, RULE.w), epoch);
    } catch (error) { console.warn('[sommNI] rule unavailable', error); }
    try {
      const tiles = await plan.render();
      for (let i = 0; i < SCENE_TILE_NAMES.length; i++) await pushGrayImage(bridge, SCENE_TILE_NAMES[i][0], SCENE_TILE_NAMES[i][1], TILE_W, TILE_H, tiles[i], epoch);
    } catch (error) { console.warn('[sommNI] Wine map unavailable; text stays readable.', error); }
  } else if (next.wine.image_url) {
    try { await pushBottlePhoto(bridge, next.wine.image_url, 100, 120); }
    catch (error) { console.warn('[sommNI] Bottle image unavailable; text stays readable.', error); }
  }
}
async function goHome(): Promise<void> {
  await cancelLibraryVoice();scopedReturn=null;pausedVoiceParent=undefined;cancelListPreview();
  if (!bridge) return;
  invalidateImages();
  if (!await rebuildGlassesPage(bridge, rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  active=false; screen=null; lastNavigation=Date.now();
  dropDisplay('library');
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}
/** Another module took the display (e.g. the Wine Atlas from the phone): stop consuming events. */
async function relinquish(): Promise<void> { await cancelLibraryVoice();pausedVoiceParent=undefined;scopedReturn=null;cancelListPreview(); active=false; screen=null; }
/** One navigation at a time; a rejected page leaves the previous screen and state untouched. */
async function settle(task: () => Promise<void>): Promise<void> {
  if (sending) return;
  sending = true;
  try { await task(); } catch (error) { console.error('[sommNI] Winebrary glasses: ' + (error instanceof Error ? error.message : String(error))); }
  finally { sending = false; }
}

/** Entry from the glasses home menu. */
export async function openLibraryOnGlasses(): Promise<void> {
  await settle(async () => {
    scopedReturn=null;const source = readSource();
    offlineCopy = false;
    items = source.items;
    if (!source.userId) { items = []; return render({ kind: 'message', reason: 'signed-out' }); }
    if (!items.length && source.error) {
      const cached = await loadLibraryCache(source.userId);
      if (cached?.items.length) { items = cached.items; offlineCopy = true; }
    }
    if (!items.length && (source.loading || source.error)) return render({ kind: 'message', reason: source.loading ? 'loading' : 'error' });
    await refreshPlaces(items);
    return render({ kind: 'types', page: 0 });
  });
  window.dispatchEvent(new Event('sommni-library-refresh-request'));
}
/** Called by the phone companion when the collection finishes loading or changes. */
export function libraryChanged(): void {
  window.dispatchEvent(new Event('winelens-library-changed'));
  if (!active || !screen || (screen.kind !== 'types' && screen.kind !== 'message') || (screen.kind === 'message' && screen.reason === 'signed-out')) return;
  const previousScreen=screen;
  void settle(async()=>{const source=readSource();if(!source.userId||source.loading||source.error)return;items=source.items;await refreshPlaces(items);if(!active||screen!==previousScreen||readSource().userId!==source.userId)return;await render({kind:'types',page:0});});
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
  if(s.kind==='voice'){await cancelLibraryVoice();return s.parent?render(s.parent):scopedReturn?leaveScoped():render({kind:'types',page:0});}
  if (s.kind === 'all') return s.parent?render(s.parent):scopedReturn?leaveScoped():render({kind:'types',page:0});
  if(s.kind==='locations'&&s.page===0)return scopedReturn?leaveScoped():render({kind:'types',page:0});
  if (s.kind === 'vintages') return s.page > 0 ? render({ ...s, page: s.page - 1, cursor: 0 }) : render(s.parent);
  if (s.page > 0) return render({ ...s, page: s.page - 1, cursor: 0 });
  if (s.kind === 'list') return render({ kind: 'regions', type: s.type, country: s.country, page: 0 });
  if (s.kind === 'regions') return render({ kind: 'countries', type: s.type, page: 0 });
  if (s.kind === 'countries') return render({ kind: 'types', page: 0 });
  return goHome();
}
async function select(index: number): Promise<void> {
  const s = screen;
  if (!s || s.kind === 'detail') return;
  if(s.kind==='voice')return startLibraryVoice(s.parent);
  if(s.kind==='locations'){const rows=pageList(savedLocations(items).map(l=>l.name),s.page).rows;const row=rows[index];if(row?.kind==='more')return render({...s,page:s.page+1});if(row?.kind==='item')return render({kind:'all',page:0,location:savedLocations(items)[row.index].name,parent:s});return back();}
  if (s.kind === 'message') return goHome();
  if (s.kind === 'types') {
    const label=libraryMenuLabels()[index];if(label==='Search by Voice')return startLibraryVoice(s);if(label==='Saved Locations')return render({kind:'locations',page:0});
    if (index === 0) return render({kind:'all',page:0,cursor:0});
    if (index === 1) return openAddWineGlasses();
    if (items.length && index === typeFacets().length + 2) return openLabelGlasses(items.slice(0,20));
    const row = typeFacets()[index - 2];
    return row ? render({ kind: 'countries', type: row.label, page: 0 }) : back();
  }
  if (s.kind === 'all') {
    if(s.query!==undefined&&index===allWines.length)return startLibraryVoice(s.parent||null);
    const wine=allWines[index];
    return wine ? render({kind:'detail',wine,from:'library',parent:s}) : back();
  }
  if (s.kind === 'countries' || s.kind === 'regions') {
    const rows = s.kind === 'countries' ? countryFacets(s.type) : regionFacets(s.type, s.country);
    const row = pageList(rows.map(facetLabel), s.page).rows[index];
    if (!row) return;
    if (row.kind === 'back') return back();
    if (row.kind === 'more') return render({ ...s, page: s.page + 1, cursor: 0 });
    const label = rows[row.index].label;
    if (s.kind === 'countries') return render({ kind: 'regions', type: s.type, country: label, page: 0 });
    return render({ kind: 'list', type: s.type, country: s.country, region: label, page: 0 });
  }
  if (s.kind === 'list') {
    const row = libraryListPage(groups, s.page).rows[index];
    if (!row) return;
    if (row.kind === 'back') return back();
    if (row.kind === 'more') return render({ ...s, page: s.page + 1, cursor: 0 });
    const group = groups[row.index];
    if (group.wines.length === 1) return render({ kind: 'detail', wine: group.wines[0], from: 'library', parent: s });
    return render({ kind: 'vintages', group, page: 0, parent: s });
  }
  const row = vintageListPage(s.group, s.page).rows[index];
  if (!row) return;
  if (row.kind === 'back') return back();
  if (row.kind === 'more') return render({ ...s, page: s.page + 1, cursor: 0 });
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

// Reuse the existing two map tiles. The text cursor moves on every swipe; only the
// settled selection sends artwork, and a newer selection cancels stale queued frames.
let selectedListMap: ListMap | null = null;
let listPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let listPreviewRevision = 0;
function cancelListPreview(clearMap = true) {
  listPreviewRevision++;
  if (listPreviewTimer) clearTimeout(listPreviewTimer);
  listPreviewTimer = null; if(clearMap)selectedListMap = null;
}
async function bottleMap(map: ListMap | null, wine: LibraryWine | null | undefined): Promise<ListMap | null> {
  if (!map || !wine || !sceneBuilder) return map;
  try { const plan=await sceneBuilder({...wine,image_url:libraryPhoto(wine)||undefined});const place=placeOf(wine),origin=wineOrigin(place.country,wine.region,wine.metadata?.state);return plan?{...map,plan,caption:captionText(origin.subdivision||place.country,place.region)}:map; }
  catch { return map; }
}
function updateListBottle(index: number) {
  const current=screen, map=selectedListMap;
  if (!current || !map || !bridge || (current.kind!=='list'&&current.kind!=='vintages'&&current.kind!=='all')) return;
  const row=current.kind==='all'?null:current.kind==='list'?libraryListPage(groups,current.page).rows[index]:vintageListPage(current.group,current.page).rows[index];
  const wine=current.kind==='all'?allWines[index]:row?.kind==='item'?(current.kind==='list'?groups[row.index]?.wines[0]:current.kind==='vintages'?current.group.wines[row.index]:null):null;
  if (listPreviewTimer) clearTimeout(listPreviewTimer);
  const revision=++listPreviewRevision;
  invalidateImages(); const epoch=currentImageEpoch();
  listPreviewTimer=setTimeout(()=>{listPreviewTimer=null;void (async()=>{
    const fresh=()=>active&&connected&&screen===current&&revision===listPreviewRevision&&epoch===currentImageEpoch();
    if(!fresh())return;
    // Back/More rows show just the place rather than retaining an unrelated bottle.
    const place=current.kind==='list'?{country:current.country,region:current.region}:wine?placeOf(wine):null;
    const base=(place?await mapFor(place.country,place.region):null)||(current.kind==='all'?allWineMap():null);
    const preview=await bottleMap(base,wine);
    if(!preview||!fresh())return;
    await queueBridgeControl(async()=>{if(fresh())await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:9,containerName:'map-caption',content:clipLabel(preview.caption,charsPerLine(576-CAPTION_MIN_X-18)),contentOffset:0,contentLength:0}));});
    if(!fresh())return;const tiles=await preview.plan.render();
    for(let i=0;i<LIST_MAP_TILES.length;i++){
      if(!fresh())return;
      await pushGrayImage(bridge!,LIST_MAP_TILES[i][0],LIST_MAP_TILES[i][1],TILE_W,TILE_H,tiles[i],epoch);
    }
  })().catch(error=>console.warn('[sommNI] Winebrary preview unavailable',error));},80);
}

function previewLibrarySelection(index:number){
 const s=screen;if(!s)return;
 if(s.kind==='all'){
  const wine=allWines[index];announceWineContext(wine?libraryContext(wine):null);
 }else if(s.kind==='list'){
  const row=libraryListPage(groups,s.page).rows[index];const wine=row?.kind==='item'?groups[row.index]?.wines[0]:null;
  announceWineContext(wine?libraryContext(wine):{title:s.region,country:s.country,region:s.region});
 }else if(s.kind==='vintages'){
  const row=vintageListPage(s.group,s.page).rows[index];const wine=row?.kind==='item'?s.group.wines[row.index]:null;
  if(wine)announceWineContext(libraryContext(wine));
 }else if(s.kind==='regions'||s.kind==='countries'){
  const facets=s.kind==='countries'?countryFacets(s.type):regionFacets(s.type,s.country);
  const row=pageList(facets.map(facetLabel),s.page).rows[index];const label=row?.kind==='item'?facets[row.index]?.label:null;
  if(s.kind==='regions')announceWineContext({title:label||s.country,country:s.country,region:label});
  else if(label)announceWineContext({title:label,country:label});else announceWineContext(null);
 }
}

// While this module owns the display, legacy catalog handlers must not receive its taps.
export function handleLibraryGlassesEvent(event: EvenHubEvent): boolean {
  if (!active) return false;
  const type=event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if(screen?.kind==='voice'){if(event.audioEvent){libraryVoice?.feed(event.audioEvent.audioPcm);return true;}if(type===3){void back().catch(console.error);return true;}if((type===undefined||type===0)&&(event.sysEvent||event.textEvent||event.listEvent)&&Date.now()-lastNavigation>=NAV_SETTLE_MS){if(libraryVoice?.state==='listening')void libraryVoice.finish();else if(!libraryVoice)void settle(()=>startLibraryVoice(screen?.kind==='voice'?screen.parent:null));}return true;}
  if (screen?.kind === 'list' || screen?.kind === 'vintages' || screen?.kind === 'all' || screen?.kind === 'types') {
    const current = screen;
    if (sending) return true;
    if (type === 1 || type === 2) {
      const labels = current.kind === 'types' ? libraryMenuLabels() : current.kind === 'all' ? [...allWines.map(w=>w.wine_name),...(current.query!==undefined?['Search by Voice']:[]),'Back'] : current.kind === 'list' ? libraryListPage(groups,current.page).labels : vintageListPage(current.group,current.page).labels;
      const index = moveCursor(current.cursor ?? 0, labels.length, type, event.listEvent ? event.listEvent.currentSelectItemIndex ?? 0 : undefined);
      if (index === (current.cursor ?? 0)) return true;
      current.cursor = index;
      previewLibrarySelection(index); updateListBottle(index);
      const revision = listPreviewRevision;
      void queueBridgeControl(async () => {
        if (!active || screen !== current || revision !== listPreviewRevision || !bridge) return;
        await bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:2,containerName:current.kind==='types'?'library-types':current.kind==='all'?'library-all':current.kind==='list'?'library-list':'library-vintages',content:current.kind==='all'?allWineRows(allWines,index,SCENE_X-18,current.query!==undefined):cursorRows(labels,index,(selectedListMap?SCENE_X-6:572)-12),contentOffset:0,contentLength:0}));
      }).catch(error=>console.warn('[sommNI] Winebrary cursor unavailable',error));
      return true;
    }
    if (type === 3) { void settle(back); return true; }
    if ((type === undefined || type === 0) && (event.sysEvent || event.textEvent || event.listEvent) && Date.now()-lastNavigation >= NAV_SETTLE_MS) {
      const index = event.listEvent ? event.listEvent.currentSelectItemIndex ?? 0 : current.cursor ?? 0;
      current.cursor = index;
      void settle(()=>select(index));
    }
    return true;
  }
  if (type === 1 || type === 2) { if(event.listEvent)previewLibrarySelection(event.listEvent.currentSelectItemIndex ?? 0);return true; }
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) { void settle(back); return true; }
  const isClick = type === undefined || type === OsEventTypeList.CLICK_EVENT;
  if (!isClick || Date.now() - lastNavigation < NAV_SETTLE_MS) return true;
  if(screen?.kind==='detail'&&!event.listEvent){const wine=screen.wine;void settle(()=>openLabelGlasses([wine]));return true;}
  if (event.listEvent) { const index = event.listEvent.currentSelectItemIndex ?? 0; void settle(() => select(index)); }
  else if (event.textEvent && screen?.kind === 'message') void settle(goHome);
  return true;
}

export async function clearPrivateGlasses() {
  await cancelLibraryVoice();scopedReturn=null;pausedVoiceParent=undefined;
  cancelListPreview();
  announceWineContext(null);
  window.dispatchEvent(new Event('winelens-library-changed'));   // the Atlas drops account wines too
  if (!active || !bridge) return;
  invalidateImages();
  const accepted=await rebuildGlassesPage(bridge, rebuildHomePage());
  if (accepted) { active=false; screen=null; groups=[]; items=[]; places=new Map(); dropDisplay('library'); window.dispatchEvent(new Event('winelens-glasses-home')); }
}

let libraryVoice:AtlasVoiceCapture|null=null;
let scopedReturn:(()=>Promise<void>)|null=null;
let pausedVoiceParent:Screen|null|undefined;
async function cancelLibraryVoice(){const capture=libraryVoice;libraryVoice=null;if(capture)await capture.cancel();}
export async function pauseLibraryVoice(){if(libraryVoice){pausedVoiceParent=screen?.kind==='voice'?screen.parent:null;await cancelLibraryVoice();}}
export async function resumeLibraryVoice(){if(pausedVoiceParent!==undefined&&active){const parent=pausedVoiceParent;pausedVoiceParent=undefined;await render({kind:'voice',page:0,parent,message:'Search paused. Tap to try again.'});}}
async function leaveScoped(){const restore=scopedReturn;scopedReturn=null;await cancelLibraryVoice();cancelListPreview();active=false;screen=null;dropDisplay('library');if(restore)await restore();else await goHome();}
async function startLibraryVoice(parent:Screen|null){
 if(!bridge||libraryVoice)return;
 cancelListPreview();invalidateImages();
 const b=bridge,owner=readSource().userId;
 const capture=new AtlasVoiceCapture({
  control:open=>queueBridgeControl(()=>b.audioControl(open)),
  state:async state=>{if(libraryVoice!==capture)return;await render({kind:'voice',page:0,parent,message:state==='opening'?'Opening microphone…':state==='listening'?'Listening · say a bottle, producer, grape or place.\nTap when finished · up to 6 seconds':'Searching your wines…'});},
  transcribe:async(pcm,signal)=>{let binary='';for(const byte of pcm)binary+=String.fromCharCode(byte);const result=await betaProvider({action:'transcribe',pcm:btoa(binary),sample_rate:16000,locale:getLocale()},signal);return typeof result.text==='string'?result.text:'';},
  result:async query=>{if(libraryVoice!==capture||owner!==readSource().userId)return;libraryVoice=null;if(!query.trim())return render({kind:'voice',page:0,parent,message:'No words heard. Tap to try again.'});await render({kind:'all',page:0,query,parent:parent||undefined,location:parent?.kind==='all'?parent.location:undefined});},
  error:async error=>{if(libraryVoice!==capture)return;libraryVoice=null;await render({kind:'voice',page:0,parent,message:(error.name==='AbortError'?'Search timed out.':error.message)+'\nTap to try again.'});},
 });libraryVoice=capture;await capture.start();
}
/** Wine by Grape searches saved vintages plus the actual collective catalog, without adding anything. */
export async function openWineSearchOnGlasses(restore:()=>Promise<void>){
 await settle(async()=>{
  await claimDisplay('library',relinquish);scopedReturn=restore;items=[...readSource().items];
  const savedIds=new Set(items.map(w=>lookupWineById(w.wine_id)?.id||w.wine_id));
  for(const entry of allCatalogWines())if(!savedIds.has(entry.id)){
   const [name,...producer]=entry.wine.name.split(' – ');
   items.push({id:entry.id,wine_id:entry.id,wine_name:name,producer:producer.join(' – ')||null,vintage:null,region:entry.wine.region,notes:'',image_url:catalogPhoto(entry.id,baseUrl)||undefined,metadata:{country:entry.country,grape:entry.wine.grape,color:entry.type,tasting_notes:[entry.wine.nose,entry.wine.palate,entry.wine.finish].filter(Boolean).join('\n')}});
  }
  await refreshPlaces(items);active=true;await startLibraryVoice(null);
 });
}
export async function openSavedLocationsOnGlasses(restore?:()=>Promise<void>){
 await settle(async()=>{await claimDisplay('library',relinquish);scopedReturn=restore||null;items=readSource().items;await refreshPlaces(items);await render({kind:'locations',page:0});});
}

// ═══ OFFLINE COPY ═══
// Account text snapshot in Even Hub storage; artwork resolves from the separate scoped cache so glasses can
// still browse when the phone has no connection. Signed image links expire, so they are
// dropped. The copy is tied to the account id and cleared on sign-out or account switch.
const CACHE_KEY = 'winelens_library_cache_v1';
let pendingCache: string | null = null;
async function writeCache(value: string) {
  if (!bridge) { pendingCache = value; return; }
  const target=bridge;
  try { await queueBridgeControl(() => target.setLocalStorage(CACHE_KEY, value)); } catch (error) { console.warn('[sommNI] Offline copy not saved', error); }
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
    if(data?.userId!==userId||!Array.isArray(data.items))return null;
    data.items=await Promise.all(data.items.map((wine:LibraryWine)=>localWineArtwork(wine,userId,true).catch(()=>wine)));return data;
  } catch { return null; }
}
export async function clearLibraryCache() { await writeCache(''); }

// Same coordinates as the SDK payload, with a browser font approximation.
export async function drawGlassesPreview(wine: LibraryWine, canvas: HTMLCanvasElement) {
  wine={...wine,image_url:libraryPhoto(wine)||undefined};
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
      const photo=await stageCanvas(wine.image_url,100,240);
      const pixels=photo.getContext('2d')!.getImageData(0,0,100,240);
      const gray=toGreenLevels(pixels.data,100);
      for(let i=0;i<gray.length;i++){const o=i*4,v=gray[i];pixels.data[o]=v*.57;pixels.data[o+1]=v*.85;pixels.data[o+2]=v*.55;pixels.data[o+3]=255;}
      ctx.putImageData(pixels,image?.xPosition ?? 16,image?.yPosition ?? 24);
    } catch { /* Text remains readable when the image cannot load. */ }
  }
}
