// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Event Handlers v2
// Nav: Home → Countries → Grapes → Wines → Tasting Notes
// + Find My Wine (5-step questionnaire → results → tasting notes)
// Double-tap = BACK on ALL pages (including wine selection)
// Reactive bottle sprites on list scroll
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, COUNTRIES, WineType,
  getGrapesForCountry, getWinesForGrape,
  getWineId, getFlavorOptionsForType, getRankedWines, Wine,
} from './constants';
import {
  rebuildHomePage, buildCountryListPage, buildGrapeListPage,
  buildWineListPage, buildTastingNotesPage,
  buildFinderTypePage, buildFinderVibePage, buildFinderFlavorPage,
  buildFinderBodyPage, buildFinderWorldPage, buildFinderResultsPage,
  HOME_LIST_ITEMS, FINDER_INDEX,
} from './pages';
import { pushLogoToGlasses, pushGlobeToGlasses, pushGrapeSpriteToGlasses, pushBottleSprite, pushBottleSpriteQuad, pushRobotSpriteToGlasses } from './image-utils';
import { log } from './ui';

// ═══ ROBOT EMOTION MAPPING PER FINDER STEP ═══
// Steps 3-5 shuffle randomly from their pool each time the page is entered
function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

async function pushFinderRobot(bridge: EvenAppBridge, baseUrl: string, page: string): Promise<void> {
  const emotionFn = FINDER_ROBOT[page];
  if (!emotionFn) return;
  const emotion = emotionFn();
  await pushRobotSpriteToGlasses(bridge, baseUrl, emotion);
  log(`[ROBOT] ${emotion}`);
}

const FINDER_ROBOT: Record<string, () => string> = {
  "finder-type":   () => "thinking",
  "finder-vibe":   () => "contemplating",
  "finder-flavor": () => pickRandom(["curious", "warning"]),
  "finder-body":   () => pickRandom(["swirling", "sommelier"]),
  "finder-world":  () => pickRandom(["presenting", "delighted", "pouring", "celebrating"]),
};

// ═══ STATE ═══
type Page =
  | "home" | "countries" | "grapes" | "wines" | "notes"
  | "finder-type" | "finder-vibe" | "finder-flavor" | "finder-body" | "finder-world" | "finder-results";

let currentPage: Page = "home";
let currentType: WineType | null = null;
let currentCountry: string | null = null;
let currentGrape: string | null = null;
let currentWineId: string | null = null;

// Find My Wine state
let finderAnswers: Record<string, string> = {};
let finderResults: { wine: Wine; type: WineType; country: string; score: number }[] = [];

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAV_DEBOUNCE_MS = 500;

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredIndex: number = -1;

// ═══ REGISTER ═══
export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
  bridgeRef = bridge;
  baseUrlRef = baseUrl;

  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, baseUrl);
  });
}

// ═══ REACTIVE SPRITES ═══
// Country, Grape, Wine selection pages no longer have image containers.
// Only finder results still has a reactive bottle sprite.

async function updateFinderResultPreview(
  bridge: EvenAppBridge, baseUrl: string, index: number
): Promise<void> {
  if (index < 0 || index >= finderResults.length) return;
  if (index === lastHoveredIndex) return;
  lastHoveredIndex = index;
  const r = finderResults[index];
  const wineId = getWineId(r.type, r.country, r.wine.name);
  await pushBottleSprite(bridge, baseUrl, wineId, 3, "bottle");
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[BACK] from ${currentPage}`);

    if (currentPage === "notes" && currentType && currentCountry && currentGrape) {
      await bridge.rebuildPageContainer(buildWineListPage(currentType, currentCountry, currentGrape));
      currentPage = "wines"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to wines", "success");
    }
    else if (currentPage === "notes" && currentType && currentCountry) {
      // Came from finder results or voice — go to grapes
      await bridge.rebuildPageContainer(buildGrapeListPage(currentType, currentCountry));
      await pushGrapeSpriteToGlasses(bridge, baseUrl);
      currentPage = "grapes"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "wines" && currentType && currentCountry) {
      await bridge.rebuildPageContainer(buildGrapeListPage(currentType, currentCountry));
      await pushGrapeSpriteToGlasses(bridge, baseUrl);
      currentPage = "grapes"; currentGrape = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "grapes" && currentType) {
      await bridge.rebuildPageContainer(buildCountryListPage(currentType));
      await pushGlobeToGlasses(bridge, baseUrl);
      currentPage = "countries"; currentCountry = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to countries", "success");
    }
    else if (currentPage === "countries") {
      await bridge.rebuildPageContainer(rebuildHomePage());
      currentPage = "home"; currentType = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    // Finder back navigation
    else if (currentPage === "finder-results") {
      await bridge.rebuildPageContainer(buildFinderWorldPage());
      currentPage = "finder-world"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-world");
      log("< Back to world", "success");
    }
    else if (currentPage === "finder-world") {
      await bridge.rebuildPageContainer(buildFinderBodyPage());
      currentPage = "finder-body"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-body");
      delete finderAnswers.world;
      log("< Back to body", "success");
    }
    else if (currentPage === "finder-body") {
      const type = finderAnswers.type as WineType | undefined;
      await bridge.rebuildPageContainer(buildFinderFlavorPage(type || null));
      currentPage = "finder-flavor"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-flavor");
      delete finderAnswers.body;
      log("< Back to flavor", "success");
    }
    else if (currentPage === "finder-flavor") {
      await bridge.rebuildPageContainer(buildFinderVibePage());
      currentPage = "finder-vibe"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-vibe");
      delete finderAnswers.flavor;
      log("< Back to vibe", "success");
    }
    else if (currentPage === "finder-vibe") {
      await bridge.rebuildPageContainer(buildFinderTypePage());
      currentPage = "finder-type"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-type");
      delete finderAnswers.vibe;
      log("< Back to type", "success");
    }
    else if (currentPage === "finder-type") {
      await bridge.rebuildPageContainer(rebuildHomePage());
      currentPage = "home"; finderAnswers = {}; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
  } catch (err) {
    log(`[BACK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
  }
}

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME ──
    if (currentPage === "home") {
      if (idx === FINDER_INDEX) {
        // Find My Wine
        finderAnswers = {};
        await bridge.rebuildPageContainer(buildFinderTypePage());
        currentPage = "finder-type";
        lastNavigationTime = Date.now();
        await pushFinderRobot(bridge, baseUrl, "finder-type");
        log("> Find My Wine", "success");
      } else {
        // Wine type (offset by 1 because Find My Wine is index 0)
        const typeIdx = idx - 1;
        if (typeIdx >= 0 && typeIdx < WINE_TYPES.length) {
          currentType = WINE_TYPES[typeIdx];
          await bridge.rebuildPageContainer(buildCountryListPage(currentType));
          await pushGlobeToGlasses(bridge, baseUrl);
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
        await bridge.rebuildPageContainer(buildGrapeListPage(currentType, currentCountry));
        await pushGrapeSpriteToGlasses(bridge, baseUrl);
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

        // If only 1 wine for this grape, skip straight to tasting notes
        if (wines.length === 1) {
          const wine = wines[0];
          const wineId = getWineId(currentType, currentCountry, wine.name);
          currentWineId = wineId;
          await bridge.rebuildPageContainer(buildTastingNotesPage(wine, wineId));
          currentPage = "notes";
          lastNavigationTime = Date.now();
          await pushBottleSpriteQuad(bridge, baseUrl, wineId, 120, 50);
          log(`> ${wine.name} (direct)`, "success");
        } else {
          await bridge.rebuildPageContainer(buildWineListPage(currentType, currentCountry, currentGrape));
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
      if (idx === wines.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < wines.length) {
        const wine = wines[idx];
        const wineId = getWineId(currentType, currentCountry, wine.name);
        currentWineId = wineId;
        await bridge.rebuildPageContainer(buildTastingNotesPage(wine, wineId));
        currentPage = "notes";
        lastNavigationTime = Date.now();
        await pushBottleSpriteQuad(bridge, baseUrl, wineId, 120, 50);
        log(`> ${wine.name}`, "success");
      }
      return;
    }

    // ═══ FINDER STEPS ═══

    // ── FINDER TYPE ──
    if (currentPage === "finder-type") {
      const typeOptions = ["Red", "White", "Sparkling", "Rose", "Orange", "Dessert"];
      if (idx === 7) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx === 6) { finderAnswers.type = "skip"; } // Surprise Me
      else if (idx >= 0 && idx < 6) { finderAnswers.type = typeOptions[idx]; }
      await bridge.rebuildPageContainer(buildFinderVibePage());
      currentPage = "finder-vibe";
      lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-vibe");
      log(`> Finder type: ${finderAnswers.type}`, "success");
      return;
    }

    // ── FINDER VIBE ──
    if (currentPage === "finder-vibe") {
      const vibeIds = ["fresh", "smooth", "bold", "funky", "elegant", "cozy"];
      if (idx === 7) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx === 6) { finderAnswers.vibe = "skip"; } // Skip
      else if (idx >= 0 && idx < 6) { finderAnswers.vibe = vibeIds[idx]; }
      const type = finderAnswers.type as WineType | undefined;
      await bridge.rebuildPageContainer(buildFinderFlavorPage(type && type !== "skip" ? type : null));
      currentPage = "finder-flavor";
      lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-flavor");
      log(`> Finder vibe: ${finderAnswers.vibe}`, "success");
      return;
    }

    // ── FINDER FLAVOR ──
    if (currentPage === "finder-flavor") {
      const type = finderAnswers.type as WineType | undefined;
      const flavorOpts = getFlavorOptionsForType(type && type !== "skip" ? type : null);
      const totalItems = flavorOpts.length + 2; // + Skip + Back
      if (idx === totalItems - 1) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx === totalItems - 2) { finderAnswers.flavor = "skip"; } // Skip
      else if (idx >= 0 && idx < flavorOpts.length) { finderAnswers.flavor = flavorOpts[idx].id; }
      await bridge.rebuildPageContainer(buildFinderBodyPage());
      currentPage = "finder-body";
      lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-body");
      log(`> Finder flavor: ${finderAnswers.flavor}`, "success");
      return;
    }

    // ── FINDER BODY ──
    if (currentPage === "finder-body") {
      const bodyIds = ["light", "medium", "full"];
      if (idx === 4) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx === 3) { finderAnswers.body = "skip"; } // Skip
      else if (idx >= 0 && idx < 3) { finderAnswers.body = bodyIds[idx]; }
      await bridge.rebuildPageContainer(buildFinderWorldPage());
      currentPage = "finder-world";
      lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-world");
      log(`> Finder body: ${finderAnswers.body}`, "success");
      return;
    }

    // ── FINDER WORLD ──
    if (currentPage === "finder-world") {
      const worldIds = ["old", "new", "skip"];
      if (idx === 3) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx >= 0 && idx < 3) { finderAnswers.world = worldIds[idx]; }

      // Score and show results
      finderResults = getRankedWines(finderAnswers).slice(0, 12);
      await bridge.rebuildPageContainer(buildFinderResultsPage(finderResults));
      currentPage = "finder-results"; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      if (finderResults.length > 0) {
        const r = finderResults[0];
        const wid = getWineId(r.type, r.country, r.wine.name);
        await pushBottleSprite(bridge, baseUrl, wid, 3, "bottle");
        lastHoveredIndex = 0;
      }
      log(`> Finder results: ${finderResults.length} matches`, "success");
      return;
    }

    // ── FINDER RESULTS ──
    if (currentPage === "finder-results") {
      if (idx === finderResults.length) { navigating = false; await goBack(bridge, baseUrl); return; } // Back
      if (idx >= 0 && idx < finderResults.length) {
        const r = finderResults[idx];
        const wineId = getWineId(r.type, r.country, r.wine.name);
        currentType = r.type;
        currentCountry = r.country;
        currentGrape = null; // came from finder, not grape nav
        currentWineId = wineId;
        await bridge.rebuildPageContainer(buildTastingNotesPage(r.wine, wineId));
        currentPage = "notes";
        lastNavigationTime = Date.now();
        await pushBottleSpriteQuad(bridge, baseUrl, wineId, 120, 50);
        log(`> ${r.wine.name} (finder)`, "success");
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
  await goBack(bridge, baseUrl);
}

// ═══ MAIN EVENT HANDLER ═══
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

  // List events
  if (event.listEvent) {
    const le = event.listEvent;
    const idx = le.currentSelectItemIndex;
    if (idx != null) lastSelectedIndex = idx;
    else lastSelectedIndex = 0;

    const type = le.eventType;

    // Reactive sprites on scroll — only finder results has an image container
    if (currentPage === "finder-results") {
      if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        await updateFinderResultPreview(bridge, baseUrl, lastSelectedIndex);
        return;
      }
      await updateFinderResultPreview(bridge, baseUrl, lastSelectedIndex);
    }

    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    await handleClick(bridge, lastSelectedIndex, baseUrl);
    return;
  }

  // System events
  if (event.sysEvent) {
    const type = event.sysEvent.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT || type === 3) {
      await handleDoubleClick(bridge, baseUrl);
    }
  }
}
