import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import type { LibraryWine } from './winebrary';
import { pushBottlePhoto, invalidateImages, pushLogoToGlasses } from './image-utils';
import { bottleCanvas } from './bottle-raster';
import { rebuildHomePage } from './pages';
import { pageList, clipLabel, clipBytes, labelBytes, wholeRowHeight, LIST_LABEL_MAX, LIST_ROW_PITCH, type ListPage } from './glasses-list';

// ═══════════════════════════════════════════════════════════════════
// Winebrary on G2 — the account library as a native glasses flow.
//   Home › My Winebrary › (wine with several vintages › vintage) › detail
// Click selects, double tap goes back one level, lists page at 18 entries.
// While `active`, this module owns the display and legacy catalog
// handlers never see its events.
// ═══════════════════════════════════════════════════════════════════

export interface LibrarySource { userId: string | null; loading: boolean; error: string; items: LibraryWine[] }
export interface WineGroup { title: string; wines: LibraryWine[] }
type MessageReason = 'signed-out' | 'loading' | 'empty' | 'error';
type Screen =
  | { kind: 'list'; page: number }
  | { kind: 'vintages'; group: number; page: number; listPage: number }
  | { kind: 'detail'; wine: LibraryWine; from: 'list' | 'vintages' | 'phone'; group: number; listPage: number; vintagePage: number }
  | { kind: 'message'; reason: MessageReason };

let bridge: EvenAppBridge | null = null;
let connected = false;
let active = false;
let sending = false;
let baseUrl = '';
let screen: Screen | null = null;
let groups: WineGroup[] = [];
let offlineCopy = false;
let lastNavigation = 0;
const NAV_SETTLE_MS = 350; // swallow the ghost click that can follow a page rebuild
let readSource: () => LibrarySource = () => ({ userId: null, loading: false, error: '', items: [] });

export function connectWinebraryGlasses(value: EvenAppBridge, url: string) { bridge=value; baseUrl=url; void flushPendingCache(); }
export function setWinebraryDeviceConnected(value: boolean) { connected=value; }
export function canShowWine() { return !!bridge && connected && !sending; }
export function isLibraryActive() { return active; }
export function setLibrarySource(read: () => LibrarySource) { readSource=read; }

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
function listScreen(name: string, labels: string[], header: string): RebuildPageContainer {
  const rows = Math.min(labels.length, LIST_H / LIST_ROW_PITCH);
  const title = new TextContainerProperty({
    xPosition: 16, yPosition: 4, width: 544, height: 34,
    containerID: 3, containerName: 'library-header', content: clipLabel(header, charsPerLine(544)), isEventCapture: 0,
  });
  const list = new ListContainerProperty({
    xPosition: 2, yPosition: 42, width: 572, height: rows * LIST_ROW_PITCH, containerID: 2, containerName: name,
    itemContainer: new ListItemContainerProperty({ itemCount: labels.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: labels }),
    isEventCapture: 1,
  });
  return new RebuildPageContainer({ containerTotalNum: 2, listObject: [list], textObject: [title] });
}
export function buildLibraryListPage(list: WineGroup[], page: number, offline = false): RebuildPageContainer {
  const paged = libraryListPage(list, page);
  const parts = ['WINEBRARY', `${list.length} ${list.length === 1 ? 'wine' : 'wines'}`];
  if (paged.pageCount > 1) parts.push(`${paged.page + 1}/${paged.pageCount}`);
  if (offline) parts.push('offline copy');
  return listScreen('library-list', paged.labels, parts.join('  ·  '));
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
export function buildLibraryWinePage(wine: LibraryWine, backTo: 'Home' | 'Back' = 'Home'): RebuildPageContainer {
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

// ═══ RENDER & NAVIGATION ═══
async function render(next: Screen): Promise<void> {
  if (!bridge) throw new Error('Glasses are not connected.');
  invalidateImages();
  let page: RebuildPageContainer;
  if (next.kind === 'list') page = buildLibraryListPage(groups, next.page, offlineCopy);
  else if (next.kind === 'vintages') page = buildVintageListPage(groups[next.group], next.page);
  else if (next.kind === 'detail') page = buildLibraryWinePage(next.wine, next.from === 'phone' ? 'Home' : 'Back');
  else page = buildMessagePage(next.reason);
  if (!await bridge.rebuildPageContainer(page)) throw new Error('The glasses did not accept this page. Try again.');
  active = true; screen = next; lastNavigation = Date.now();
  if (next.kind === 'detail' && next.wine.image_url) {
    try { await pushBottlePhoto(bridge, next.wine.image_url, 100, 120); }
    catch (error) { console.warn('[wineLENS] Bottle image unavailable; text stays readable.', error); }
  }
}
async function goHome(): Promise<void> {
  if (!bridge) return;
  invalidateImages();
  if (!await bridge.rebuildPageContainer(rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  active=false; screen=null; lastNavigation=Date.now();
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}
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
    groups = groupLibrary(source.items);
    if (!source.userId) return render({ kind: 'message', reason: 'signed-out' });
    if (!groups.length && source.error) {
      const cached = await loadLibraryCache(source.userId);
      if (cached?.items.length) { groups = groupLibrary(cached.items); offlineCopy = true; }
    }
    if (!groups.length) return render({ kind: 'message', reason: source.loading ? 'loading' : source.error ? 'error' : 'empty' });
    return render({ kind: 'list', page: 0 });
  });
}
/** Called by the phone companion when the collection finishes loading or changes. */
export function libraryChanged(): void {
  if (!active || screen?.kind !== 'message' || screen.reason === 'signed-out') return;
  void openLibraryOnGlasses();
}

async function back(): Promise<void> {
  const s = screen;
  if (!s || s.kind === 'message') return goHome();
  if (s.kind === 'detail') {
    if (s.from === 'phone') return goHome();
    if (s.from === 'vintages') return render({ kind: 'vintages', group: s.group, page: s.vintagePage, listPage: s.listPage });
    return render({ kind: 'list', page: s.listPage });
  }
  if (s.kind === 'vintages') return s.page > 0 ? render({ ...s, page: s.page - 1 }) : render({ kind: 'list', page: s.listPage });
  return s.page > 0 ? render({ kind: 'list', page: s.page - 1 }) : goHome();
}
async function select(index: number): Promise<void> {
  const s = screen;
  if (!s || s.kind === 'detail') return;
  if (s.kind === 'message') return goHome();
  if (s.kind === 'list') {
    const row = libraryListPage(groups, s.page).rows[index];
    if (!row) return;
    if (row.kind === 'back') return back();
    if (row.kind === 'more') return render({ kind: 'list', page: s.page + 1 });
    const group = groups[row.index];
    if (group.wines.length === 1) return render({ kind: 'detail', wine: group.wines[0], from: 'list', group: row.index, listPage: s.page, vintagePage: 0 });
    return render({ kind: 'vintages', group: row.index, page: 0, listPage: s.page });
  }
  const group = groups[s.group];
  const row = vintageListPage(group, s.page).rows[index];
  if (!row) return;
  if (row.kind === 'back') return back();
  if (row.kind === 'more') return render({ ...s, page: s.page + 1 });
  return render({ kind: 'detail', wine: group.wines[row.index], from: 'vintages', group: s.group, listPage: s.listPage, vintagePage: s.page });
}

/** Sent from the phone: show one account wine; double tap returns home. */
export async function showWineOnGlasses(wine: LibraryWine) {
  if (!canShowWine()) throw new Error('Connect your Even G2 glasses first.');
  sending=true;
  try { await render({ kind: 'detail', wine, from: 'phone', group: -1, listPage: 0, vintagePage: 0 }); }
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
  if (!active || !bridge) return;
  invalidateImages();
  const accepted=await bridge.rebuildPageContainer(rebuildHomePage());
  if (accepted) { active=false; screen=null; groups=[]; window.dispatchEvent(new Event('winelens-glasses-home')); }
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
