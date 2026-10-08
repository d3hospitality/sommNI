// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Event Handlers v3
// Nav: Home → Countries → Grapes → Wines → Tasting Notes
// + Find My Wine (5-step questionnaire → results → tasting notes)
// + Course Builder (multi-course wine planner)
// + Study (seasons and the daily review, study/glasses.ts)
// + Pairings (read saved pairing collections)
// + 86 List (out-of-stock wines from inventory)
// Double-tap = BACK on ALL pages
// Reactive bottle sprites on list scroll
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerUpgrade } from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, COUNTRIES, WineType, TYPE_DISPLAY, getWinesForCountry,
  getGrapesForCountry, getWinesForGrape,
  getFlavorOptionsForType, getRankedWines, Wine,
} from './constants';
import { getWineId, lookupWineById } from './identity';
import {
  rebuildHomePage, buildCountryListPage, buildGrapeListPage,
  buildWineListPage, buildTastingNotesPage,
  buildFinderTypePage, buildFinderVibePage, buildFinderFlavorPage,
  buildFinderBodyPage, buildFinderWorldPage, buildFinderResultsPage,
  buildPairingsListPage, buildPairingDetailPage,
  wineListPage, pairingsListPage,
  HOME_LIST_ITEMS, LIBRARY_INDEX, FINDER_INDEX, STUDY_INDEX, PAIRINGS_INDEX,
  ATLAS_INDEX, TYPE_START_INDEX, countryInfoText,
} from './pages';
import {
  pushLogoToGlasses, pushGlobeToGlasses, pushGrapeSpriteToGlasses,
  pushBottleSprite, pushTastingNotesImages,
} from './image-utils';
import { getPairings, flushCompanionWrites, type Pairing } from './sync';
import { flushStudyWrites } from './study/store';
import { releaseDisplay, suspendDisplay } from './display';
import { handleLibraryGlassesEvent, openLibraryOnGlasses } from './winebrary-glasses';
import { handleStudyGlassesEvent, openStudyOnGlasses } from './study/glasses';
import { handleAtlasGlassesEvent, openAtlasOnGlasses, pushCatalogGlobe, pauseAtlasGlasses, resumeAtlasGlasses } from './atlas-app';
import { rebuildGlassesPage, invalidateImages, sendSerial, imageIdle, suspendImages } from './image-utils';
import { log } from './ui';
import { saveFromGlasses } from './quick-save';

// ═══ STATE ═══
type Page =
  | "home" | "countries" | "grapes" | "wines" | "notes"
  | "finder-type" | "finder-vibe" | "finder-flavor" | "finder-body" | "finder-world" | "finder-results"
  | "pairings-list" | "pairing-detail";

let currentPage: Page = "home";
let currentType: WineType | null = null;
let currentCountry: string | null = null;
let currentGrape: string | null = null;
let currentWineId: string | null = null;

// Find My Wine state
let finderAnswers: Record<string, string> = {};
let finderResults: { wine: Wine; type: WineType; country: string; score: number }[] = [];

// Pairings state
let pairingsCache: Pairing[] = [];
let activePairing: Pairing | null = null;

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAV_DEBOUNCE_MS = 500;

// Paged lists (G2 lists hold at most 20 rows) and where "Back" from notes should land.
let wineListPageIndex = 0;
let pairingsPage = 0;
let notesReturn: (() => Promise<void>) | null = null;

/** Rebuild the glasses page; throws when the glasses reject it so callers never advance state. */
async function rebuild(bridge: EvenAppBridge, page: RebuildPageContainer): Promise<void> {
  if (!(await rebuildGlassesPage(bridge, page))) throw new Error('Glasses rejected the page');
}

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredIndex: number = -1;

// ═══ REGISTER ═══
/** True while a legacy page change is in flight (taps are dropped meanwhile). Used by tests. */
export function isNavigating(): boolean { return navigating; }

export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string, onExit: () => void = () => {}): () => void {
  const home = () => { currentPage="home"; lastHoveredIndex=-1; lastNavigationTime=Date.now(); };
  window.addEventListener('winelens-glasses-home', home);
  bridgeRef = bridge;
  baseUrlRef = baseUrl;
  let ended = false, background = false;
  let lifecycle = Promise.resolve();
  const report = (error: unknown) => log(`Glasses: ${error instanceof Error ? error.message : String(error)}`, 'error');
  const flush = async () => { await flushCompanionWrites(); await flushStudyWrites(); };
  const enqueue = (task: () => Promise<void>) => { lifecycle=lifecycle.then(task).catch(report); };
  const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
    if (ended) return;
    const type = event.sysEvent?.eventType;
    // Lifecycle messages must never fall through to the current page's click/back handler.
    if (type === 6 || type === 7) {
      ended = true;
      suspendDisplay(true); suspendImages(true);
      unsubscribe(); window.removeEventListener('winelens-glasses-home', home); onExit();
      enqueue(async () => { await releaseDisplay(); await imageIdle(); await flush(); });
      return;
    }
    if (type === 5) {
      background = true;
      suspendDisplay(true); suspendImages(true);
      enqueue(async () => { await pauseAtlasGlasses(); await imageIdle(); await flush(); });
      return;
    }
    if (type === 4) {
      enqueue(async () => {
        if (ended) return;
        suspendDisplay(false); suspendImages(false);
        try { await resumeAtlasGlasses(); } finally { background = false; }
      });
      return;
    }
    if (!background) void handleEvent(bridge, event, baseUrl).catch(report);
  });
  return () => {
    if (ended) return;
    ended=true; unsubscribe(); window.removeEventListener('winelens-glasses-home', home);
  };
}

// ═══ REACTIVE SPRITES ═══
async function updateFinderResultPreview(
  bridge: EvenAppBridge, baseUrl: string, index: number
): Promise<void> {
  if (index < 0 || index >= finderResults.length) return;
  if (index === lastHoveredIndex) return;
  lastHoveredIndex = index;
  invalidateImages();
  const r = finderResults[index];
  const wineId = getWineId(r.type, r.country, r.wine.name);
  if (wineId) await pushBottleSprite(bridge, baseUrl, wineId, 3, "bottle");
}

/**
 * Catalog country list: the globe shows where this type's wines come from (every catalog
 * country lit, turned to the one with the most wines). G2 lists scroll natively and the
 * simulator sends no scroll events, so the footprint is the reliable default; if the
 * firmware does report a hovered row, the globe turns to that country.
 */
function countriesByWines(type: WineType): string[] {
  return [...COUNTRIES[type]].sort((a, b) => getWinesForCountry(type, b).length - getWinesForCountry(type, a).length);
}
async function showCountryFootprint(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentType) return;
  lastHoveredIndex = -1;
  if (!await pushCatalogGlobe(bridge, countriesByWines(currentType))) await pushGlobeToGlasses(bridge, baseUrl);
}
/** Grape list: the chosen country on the globe (the grape sprites were decorative). */
async function showGrapeCountry(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentCountry || !await pushCatalogGlobe(bridge, currentCountry, { names: ['grape-top', 'grape-bottom'] })) await pushGrapeSpriteToGlasses(bridge, baseUrl);
}
async function hoverCountry(bridge: EvenAppBridge, index: number): Promise<void> {
  if (!currentType || index === lastHoveredIndex) return;
  lastHoveredIndex = index;
  const type = currentType;
  const content = countryInfoText(type, index);
  const text = async () => {
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 5, containerName: 'info', content, contentOffset: 0, contentLength: 0 }));
  };
  const country = COUNTRIES[type][index];
  if (country) await pushCatalogGlobe(bridge, country, { settle: true, lead: text });
  else await pushCatalogGlobe(bridge, countriesByWines(type), { settle: true, lead: text }); // Back row: footprint again
}

function lookupName(wineId: string): string {
  return lookupWineById(wineId)?.wine.name ?? 'Unavailable wine';
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  invalidateImages();

  try {
    log(`[BACK] from ${currentPage}`);

    // ── Browse navigation ──
    if (currentPage === "notes" && notesReturn) {
      await notesReturn();
      currentWineId = null;
      log("< Back from notes", "success");
    }
    else if (currentPage === "wines" && wineListPageIndex > 0 && currentType && currentCountry && currentGrape) {
      wineListPageIndex--;
      await rebuild(bridge, buildWineListPage(currentType, currentCountry, currentGrape, wineListPageIndex));
      lastNavigationTime = Date.now();
    }
    else if (currentPage === "pairings-list" && pairingsPage > 0) {
      pairingsPage--;
      await rebuild(bridge, buildPairingsListPage(pairingsCache, pairingsPage));
      lastNavigationTime = Date.now();
    }
    else if (currentPage === "notes" && currentType && currentCountry && currentGrape) {
      await rebuild(bridge, buildWineListPage(currentType, currentCountry, currentGrape));
      currentPage = "wines"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to wines", "success");
    }
    else if (currentPage === "notes" && currentType && currentCountry) {
      await rebuild(bridge, buildGrapeListPage(currentType, currentCountry));
      await showGrapeCountry(bridge, baseUrl);
      currentPage = "grapes"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "wines" && currentType && currentCountry) {
      await rebuild(bridge, buildGrapeListPage(currentType, currentCountry));
      await showGrapeCountry(bridge, baseUrl);
      currentPage = "grapes"; currentGrape = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "grapes" && currentType) {
      await rebuild(bridge, buildCountryListPage(currentType));
      await showCountryFootprint(bridge, baseUrl);
      currentPage = "countries"; currentCountry = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to countries", "success");
    }
    else if (currentPage === "countries") {
      await goHome(bridge, baseUrl);
    }

    // ── Finder back navigation ──
    else if (currentPage === "finder-results") {
      await rebuild(bridge, buildFinderWorldPage());
      currentPage = "finder-world"; lastNavigationTime = Date.now();

      log("< Back to world", "success");
    }
    else if (currentPage === "finder-world") {
      await rebuild(bridge, buildFinderBodyPage());
      currentPage = "finder-body"; lastNavigationTime = Date.now();

      delete finderAnswers.world;
      log("< Back to body", "success");
    }
    else if (currentPage === "finder-body") {
      const type = finderAnswers.type as WineType | "skip" | undefined;
      await rebuild(bridge, buildFinderFlavorPage(type && type !== "skip" ? type : null));
      currentPage = "finder-flavor"; lastNavigationTime = Date.now();

      delete finderAnswers.body;
      log("< Back to flavor", "success");
    }
    else if (currentPage === "finder-flavor") {
      await rebuild(bridge, buildFinderVibePage());
      currentPage = "finder-vibe"; lastNavigationTime = Date.now();

      delete finderAnswers.flavor;
      log("< Back to vibe", "success");
    }
    else if (currentPage === "finder-vibe") {
      await rebuild(bridge, buildFinderTypePage());
      currentPage = "finder-type"; lastNavigationTime = Date.now();

      delete finderAnswers.vibe;
      log("< Back to type", "success");
    }
    else if (currentPage === "finder-type") {
      await goHome(bridge, baseUrl);
    }



    // ── Pairings back navigation ──
    else if (currentPage === "pairings-list") {
      await goHome(bridge, baseUrl);
    }
    else if (currentPage === "pairing-detail") {
      pairingsCache = await getPairings();
      await rebuild(bridge, buildPairingsListPage(pairingsCache, pairingsPage));
      await pushLogoToGlasses(bridge, baseUrl);
      currentPage = "pairings-list"; lastNavigationTime = Date.now();
      activePairing = null;
      log("< Back to pairings", "success");
    }



  } catch (err) {
    log(`[BACK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
  }
}

async function goHome(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  await rebuild(bridge, rebuildHomePage());
  currentPage = "home"; currentType = null; currentCountry = null;
  currentGrape = null; currentWineId = null;
  finderAnswers = {}; lastHoveredIndex = -1;
  activePairing = null;
  wineListPageIndex = 0; pairingsPage = 0; notesReturn = null;
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  log("< Back to Home", "success");
}

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  invalidateImages();
  navigating = true;

  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME ──
    if (currentPage === "home") {
      if (idx === LIBRARY_INDEX) {
        // Winebrary owns the display (and its events) until it returns home.
        navigating = false;
        await openLibraryOnGlasses();
        log("> My Winebrary", "success");
        return;
      }
      if (idx === FINDER_INDEX) {
        finderAnswers = {};
        await rebuild(bridge, buildFinderTypePage());
        currentPage = "finder-type";
        lastNavigationTime = Date.now();

        log("> Find My Wine", "success");
      }
      else if (idx === STUDY_INDEX) {
        // Study owns the display (and its events) until it returns home.
        navigating = false;
        await openStudyOnGlasses();
        log("> Study", "success");
        return;
      }
      else if (idx === ATLAS_INDEX) {
        // Atlas owns the display (and its events) until double tap from its country list.
        navigating = false;
        try { await openAtlasOnGlasses(); log("> Wine Atlas", "success"); }
        catch (error) { log(`Wine Atlas unavailable: ${error instanceof Error ? error.message : String(error)}`, "error"); }
        return;
      }
      else if (idx === PAIRINGS_INDEX) {
        pairingsCache = await getPairings();
        pairingsPage = 0;
        await rebuild(bridge, buildPairingsListPage(pairingsCache));
        await pushLogoToGlasses(bridge, baseUrl);
        currentPage = "pairings-list";
        lastNavigationTime = Date.now();
        log("> Pairings", "success");
      }
      else if (idx >= TYPE_START_INDEX) {
        const typeIdx = idx - TYPE_START_INDEX;
        if (typeIdx >= 0 && typeIdx < WINE_TYPES.length) {
          currentType = WINE_TYPES[typeIdx];
          await rebuild(bridge, buildCountryListPage(currentType));
          await showCountryFootprint(bridge, baseUrl);
          currentPage = "countries"; lastHoveredIndex = -1;
          lastNavigationTime = Date.now();
          log(`> ${currentType}`, "success");
        }
      }
      return;
    }

    // ── COUNTRIES ──
    if (currentPage === "countries" && currentType) {
      const countries = COUNTRIES[currentType];
      if (idx === countries.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < countries.length) {
        currentCountry = countries[idx];
        const only = getWinesForCountry(currentType, currentCountry);
        if (only.length === 1) {
          // One wine in this country: open it, no one-row grape step in between.
          const wine = only[0], wineId = getWineId(currentType, currentCountry, wine.name), type = currentType, country = currentCountry;
          currentWineId = wineId; currentGrape = null;
          await rebuild(bridge, buildTastingNotesPage(wine, wineId));
          currentPage = "notes"; lastNavigationTime = Date.now();
          notesReturn = async () => {
            await rebuild(bridge, buildCountryListPage(type));
            currentPage = "countries"; currentCountry = null; lastHoveredIndex = -1; lastNavigationTime = Date.now();
            await showCountryFootprint(bridge, baseUrl);
          };
          await pushTastingNotesImages(bridge, baseUrl, wineId);
          log(`> ${wine.name} (the only wine from ${country})`, "success");
          return;
        }
        await rebuild(bridge, buildGrapeListPage(currentType, currentCountry));
        await showGrapeCountry(bridge, baseUrl);
        currentPage = "grapes"; lastHoveredIndex = -1;
        lastNavigationTime = Date.now();
        log(`> ${currentCountry}`, "success");
      }
      return;
    }

    // ── GRAPES ──
    if (currentPage === "grapes" && currentType && currentCountry) {
      const grapes = getGrapesForCountry(currentType, currentCountry);
      if (idx === grapes.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < grapes.length) {
        currentGrape = grapes[idx];
        const wines = getWinesForGrape(currentType, currentCountry, currentGrape);
        if (wines.length === 1) {
          const wine = wines[0];
          const wineId = getWineId(currentType, currentCountry, wine.name);
          currentWineId = wineId;
          await rebuild(bridge, buildTastingNotesPage(wine, wineId));
          currentPage = "notes"; lastNavigationTime = Date.now();
          const [type, country] = [currentType, currentCountry];
          notesReturn = async () => {
            await rebuild(bridge, buildGrapeListPage(type, country));
            currentPage = "grapes"; currentGrape = null; lastHoveredIndex = -1; lastNavigationTime = Date.now();
            await showGrapeCountry(bridge, baseUrl);
          };
          await pushTastingNotesImages(bridge, baseUrl, wineId);
          log(`> ${wine.name} (direct)`, "success");
        } else {
          wineListPageIndex = 0;
          await rebuild(bridge, buildWineListPage(currentType, currentCountry, currentGrape));
          currentPage = "wines"; lastHoveredIndex = -1;
          lastNavigationTime = Date.now();
          log(`> ${currentGrape}`, "success");
        }
      }
      return;
    }

    // ── WINES ──
    if (currentPage === "wines" && currentType && currentCountry && currentGrape) {
      const wines = getWinesForGrape(currentType, currentCountry, currentGrape);
      const row = wineListPage(currentType, currentCountry, currentGrape, wineListPageIndex).rows[idx];
      if (row?.kind === "back") { navigating = false; await goBack(bridge, baseUrl); return; }
      if (row?.kind === "more") {
        await rebuild(bridge, buildWineListPage(currentType, currentCountry, currentGrape, wineListPageIndex + 1));
        wineListPageIndex++; lastNavigationTime = Date.now();
        return;
      }
      if (row?.kind === "item") {
        const wine = wines[row.index];
        const wineId = getWineId(currentType, currentCountry, wine.name);
        currentWineId = wineId;
        await rebuild(bridge, buildTastingNotesPage(wine, wineId));
        currentPage = "notes"; lastNavigationTime = Date.now();
        const [type, country, grape, page] = [currentType, currentCountry, currentGrape, wineListPageIndex];
        notesReturn = async () => {
          await rebuild(bridge, buildWineListPage(type, country, grape, page));
          currentPage = "wines"; wineListPageIndex = page; lastHoveredIndex = -1; lastNavigationTime = Date.now();
        };
        await pushTastingNotesImages(bridge, baseUrl, wineId);
        log(`> ${wine.name}`, "success");
      }
      return;
    }

    // ═══ FINDER STEPS ═══

    if (currentPage === "finder-type") {
      const typeOptions = ["Red", "White", "Sparkling", "Rose", "Orange", "Dessert"];
      if (idx === 7) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === 6) { finderAnswers.type = "skip"; }
      else if (idx >= 0 && idx < 6) { finderAnswers.type = typeOptions[idx]; }
      await rebuild(bridge, buildFinderVibePage());
      currentPage = "finder-vibe"; lastNavigationTime = Date.now();

      log(`> Finder type: ${finderAnswers.type}`, "success");
      return;
    }

    if (currentPage === "finder-vibe") {
      const vibeIds = ["fresh", "smooth", "bold", "funky", "elegant", "cozy"];
      if (idx === 7) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === 6) { finderAnswers.vibe = "skip"; }
      else if (idx >= 0 && idx < 6) { finderAnswers.vibe = vibeIds[idx]; }
      const type = finderAnswers.type as WineType | "skip" | undefined;
      await rebuild(bridge, buildFinderFlavorPage(type && type !== "skip" ? type : null));
      currentPage = "finder-flavor"; lastNavigationTime = Date.now();

      log(`> Finder vibe: ${finderAnswers.vibe}`, "success");
      return;
    }

    if (currentPage === "finder-flavor") {
      const type = finderAnswers.type as WineType | "skip" | undefined;
      const flavorOpts = getFlavorOptionsForType(type && type !== "skip" ? type : null);
      const totalItems = flavorOpts.length + 2;
      if (idx === totalItems - 1) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === totalItems - 2) { finderAnswers.flavor = "skip"; }
      else if (idx >= 0 && idx < flavorOpts.length) { finderAnswers.flavor = flavorOpts[idx].id; }
      await rebuild(bridge, buildFinderBodyPage());
      currentPage = "finder-body"; lastNavigationTime = Date.now();

      log(`> Finder flavor: ${finderAnswers.flavor}`, "success");
      return;
    }

    if (currentPage === "finder-body") {
      const bodyIds = ["light", "medium", "full"];
      if (idx === 4) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === 3) { finderAnswers.body = "skip"; }
      else if (idx >= 0 && idx < 3) { finderAnswers.body = bodyIds[idx]; }
      await rebuild(bridge, buildFinderWorldPage());
      currentPage = "finder-world"; lastNavigationTime = Date.now();

      log(`> Finder body: ${finderAnswers.body}`, "success");
      return;
    }

    if (currentPage === "finder-world") {
      const worldIds = ["old", "new", "skip"];
      if (idx === 3) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < 3) { finderAnswers.world = worldIds[idx]; }
      finderResults = getRankedWines(finderAnswers).slice(0, 12);
      await rebuild(bridge, buildFinderResultsPage(finderResults));
      currentPage = "finder-results"; lastHoveredIndex = -1; lastNavigationTime = Date.now();
      if (finderResults.length > 0) {
        const r = finderResults[0];
        const wid = getWineId(r.type, r.country, r.wine.name);
        await pushBottleSprite(bridge, baseUrl, wid, 3, "bottle");
        lastHoveredIndex = 0;
      }
      log(`> Finder results: ${finderResults.length} matches`, "success");
      return;
    }

    if (currentPage === "finder-results") {
      if (idx === finderResults.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < finderResults.length) {
        const r = finderResults[idx];
        const wineId = getWineId(r.type, r.country, r.wine.name);
        currentType = r.type; currentCountry = r.country; currentGrape = null;
        currentWineId = wineId;
        await rebuild(bridge, buildTastingNotesPage(r.wine, wineId));
        currentPage = "notes"; lastNavigationTime = Date.now();
        notesReturn = async () => {
          await rebuild(bridge, buildFinderResultsPage(finderResults));
          currentPage = "finder-results"; lastHoveredIndex = -1; lastNavigationTime = Date.now();
          await updateFinderResultPreview(bridge, baseUrl, 0);
        };
        await pushTastingNotesImages(bridge, baseUrl, wineId);
        log(`> ${r.wine.name} (finder)`, "success");
      }
      return;
    }

    // ═══ PAIRINGS ═══

    if (currentPage === "pairings-list") {
      const row = pairingsListPage(pairingsCache, pairingsPage).rows[idx];
      if (row?.kind === "back") { navigating = false; await goBack(bridge, baseUrl); return; }
      if (row?.kind === "more") {
        await rebuild(bridge, buildPairingsListPage(pairingsCache, pairingsPage + 1));
        pairingsPage++; lastNavigationTime = Date.now();
        return;
      }
      if (row?.kind === "item") {
        activePairing = pairingsCache[row.index];
        const wineNames = activePairing.wineIds.map(lookupName);
        await rebuild(bridge, buildPairingDetailPage(activePairing, wineNames));
        currentPage = "pairing-detail"; lastNavigationTime = Date.now();
        log(`> Pairing: ${activePairing.name}`, "success");
      }
      return;
    }

    if (currentPage === "pairing-detail") {
      if (!activePairing) return;
      const wineCount = activePairing.wineIds.length;
      if (idx === wineCount) { navigating = false; await goBack(bridge, baseUrl); return; }
      // Tap a wine in the pairing → go to tasting notes
      if (idx >= 0 && idx < wineCount) {
        const targetId = activePairing.wineIds[idx];
        const found = lookupWineById(targetId);
        if (!found) { log(`[PAIRING] ${targetId} is not in the catalog; not opened`, "error"); return; }
        currentType = found.type; currentCountry = found.country; currentGrape = null;
        currentWineId = found.id;
        await rebuild(bridge, buildTastingNotesPage(found.wine, found.id));
        currentPage = "notes"; lastNavigationTime = Date.now();
        const pairing = activePairing;
        const names = pairing.wineIds.map(lookupName);
        notesReturn = async () => {
          await rebuild(bridge, buildPairingDetailPage(pairing, names));
          currentPage = "pairing-detail"; activePairing = pairing; lastNavigationTime = Date.now();
        };
        await pushTastingNotesImages(bridge, baseUrl, found.id);
        log(`> ${found.wine.name} (pairing)`, "success");
      }
      return;
    }

  } catch (err) {
    log(`[CLICK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
  }
}

// ═══ DOUBLE-CLICK = BACK on ALL pages ═══
async function handleDoubleClick(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  log(`[DBLCLICK] page=${currentPage}`);
  if (currentPage === 'home') {
    if (navigating || Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;
    navigating = true;
    try {
      // Keep listeners and state alive: cancelling the system dialog must remain usable.
      await sendSerial(async () => {
        if (!await bridge.shutDownPageContainer(1)) throw new Error('Exit dialog was not accepted. Try again.');
      });
    } finally { navigating = false; lastNavigationTime = Date.now(); }
    return;
  }
  await goBack(bridge, baseUrl);
}

// ═══ MAIN EVENT HANDLER ═══
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {
  if (handleAtlasGlassesEvent(event) || handleStudyGlassesEvent(event) || handleLibraryGlassesEvent(event)) return;
  const gesture=event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (gesture === OsEventTypeList.DOUBLE_CLICK_EVENT) { await handleDoubleClick(bridge, baseUrl); return; }

  // List events
  if (event.listEvent) {
    const le = event.listEvent;
    const idx = le.currentSelectItemIndex;
    if (idx != null) lastSelectedIndex = idx;
    else lastSelectedIndex = 0;

    const type = le.eventType;

    // Reactive sprites on scroll — finder results
    if (currentPage === "finder-results") {
      if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        await updateFinderResultPreview(bridge, baseUrl, lastSelectedIndex);
        return;
      }
      await updateFinderResultPreview(bridge, baseUrl, lastSelectedIndex);
    }

    // Live globe — catalog country list
    if (currentPage === "countries" && (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT)) {
      await hoverCountry(bridge, lastSelectedIndex);
      return;
    }

    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    if (type !== undefined && type !== OsEventTypeList.CLICK_EVENT) return;
    await handleClick(bridge, lastSelectedIndex, baseUrl);
    return;
  }

  // Tasting notes: a tap on the notes saves this wine to My Winebrary (the footer answers).
  if (event.textEvent && currentPage === "notes" && event.textEvent.containerName === 'notes') {
    const type = event.textEvent.eventType;
    if ((type === undefined || type === OsEventTypeList.CLICK_EVENT) && Date.now() - lastNavigationTime >= NAV_DEBOUNCE_MS) {
      await saveFromGlasses(bridge, currentWineId);
    }
    return;
  }

  // System events
  if (event.sysEvent) {
    const type = event.sysEvent.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      await handleDoubleClick(bridge, baseUrl);
    }
  }
}
