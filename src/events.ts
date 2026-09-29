// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Event Handlers v3
// Nav: Home → Countries → Grapes → Wines → Tasting Notes
// + Find My Wine (5-step questionnaire → results → tasting notes)
// + Course Builder (multi-course wine planner)
// + Quiz Me (flash cards / multiple-choice quiz)
// + Pairings (read saved pairing collections)
// + 86 List (out-of-stock wines from inventory)
// Double-tap = BACK on ALL pages
// Reactive bottle sprites on list scroll
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer } from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, COUNTRIES, WineType, TYPE_DISPLAY,
  getGrapesForCountry, getWinesForGrape,
  getWineId, getFlavorOptionsForType, getRankedWines, Wine, WINES,
} from './constants';
import {
  rebuildHomePage, buildCountryListPage, buildGrapeListPage,
  buildWineListPage, buildTastingNotesPage,
  buildFinderTypePage, buildFinderVibePage, buildFinderFlavorPage,
  buildFinderBodyPage, buildFinderWorldPage, buildFinderResultsPage,
  buildQuizPickerPage, buildQuizQuestionPage, buildQuizFeedbackPage, buildQuizScorePage,
  buildPairingsListPage, buildPairingDetailPage,
  wineListPage, quizPickerPage, pairingsListPage,
  HOME_LIST_ITEMS, LIBRARY_INDEX, FINDER_INDEX, QUIZ_INDEX, PAIRINGS_INDEX,
  TYPE_START_INDEX,
} from './pages';
import {
  pushLogoToGlasses, pushGlobeToGlasses, pushGrapeSpriteToGlasses,
  pushBottleSprite, pushBottleSpriteDual,
} from './image-utils';
import {
  startQuizSession, answerQuiz, nextQuizQuestion, endQuiz, clearQuiz,
  getQuizState,
} from './quiz';
import {
  initSync, getInventory, getPairings, getFavorites,
  recordQuizAnswer, recordQuizSession, checkAndUpdateLearned,
  type Pairing,
} from './sync';
import { handleLibraryGlassesEvent, openLibraryOnGlasses } from './winebrary-glasses';
import { invalidateImages } from './image-utils';
import { log } from './ui';

// ═══ STATE ═══
type Page =
  | "home" | "countries" | "grapes" | "wines" | "notes"
  | "finder-type" | "finder-vibe" | "finder-flavor" | "finder-body" | "finder-world" | "finder-results"
  | "quiz-picker" | "quiz-question" | "quiz-feedback" | "quiz-score"
  | "pairings-list" | "pairing-detail";

let currentPage: Page = "home";
let currentType: WineType | null = null;
let currentCountry: string | null = null;
let currentGrape: string | null = null;
let currentWineId: string | null = null;

// Find My Wine state
let finderAnswers: Record<string, string> = {};
let finderResults: { wine: Wine; type: WineType; country: string; score: number }[] = [];

// Quiz state
let quizWines: { wine: Wine; type: WineType; country: string; wineId: string }[] = [];

// Pairings state
let pairingsCache: Pairing[] = [];
let activePairing: Pairing | null = null;

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAV_DEBOUNCE_MS = 500;

// Paged lists (G2 lists hold at most 20 rows) and where "Back" from notes should land.
let wineListPageIndex = 0;
let quizPage = 0;
let pairingsPage = 0;
let notesReturn: (() => Promise<void>) | null = null;
let lastQuizWine: { wine: Wine; type: WineType; country: string; wineId: string } | null = null;

/** Rebuild the glasses page; throws when the glasses reject it so callers never advance state. */
async function rebuild(bridge: EvenAppBridge, page: RebuildPageContainer): Promise<void> {
  if (!(await bridge.rebuildPageContainer(page))) throw new Error('Glasses rejected the page');
}

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredIndex: number = -1;

// ═══ REGISTER ═══
export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
  window.addEventListener('winelens-glasses-home', () => { currentPage="home"; lastHoveredIndex=-1; });
  bridgeRef = bridge;
  baseUrlRef = baseUrl;
  initSync(bridge);

  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, baseUrl);
  });
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
  await pushBottleSprite(bridge, baseUrl, wineId, 3, "bottle");
}

function lookupName(wineId: string): string {
  let wIdx = 0;
  for (const t of WINE_TYPES) for (const c of COUNTRIES[t]) for (const w of (WINES[t]?.[c] || [])) {
    if (`w${wIdx}` === wineId) return w.name;
    wIdx++;
  }
  return `Unknown (${wineId})`;
}

// ═══ HELPER: get all wines flat ═══
function getAllWinesFlat(): { wine: Wine; type: WineType; country: string }[] {
  const result: { wine: Wine; type: WineType; country: string }[] = [];
  for (const t of WINE_TYPES) {
    for (const c of COUNTRIES[t]) {
      for (const w of (WINES[t]?.[c] || [])) {
        result.push({ wine: w, type: t, country: c });
      }
    }
  }
  return result;
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
    else if (currentPage === "quiz-picker" && quizPage > 0) {
      quizPage--;
      await showQuizPicker(bridge, baseUrl, quizPage);
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
      await pushGrapeSpriteToGlasses(bridge, baseUrl);
      currentPage = "grapes"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "wines" && currentType && currentCountry) {
      await rebuild(bridge, buildGrapeListPage(currentType, currentCountry));
      await pushGrapeSpriteToGlasses(bridge, baseUrl);
      currentPage = "grapes"; currentGrape = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to grapes", "success");
    }
    else if (currentPage === "grapes" && currentType) {
      await rebuild(bridge, buildCountryListPage(currentType));
      await pushGlobeToGlasses(bridge, baseUrl);
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



    // ── Quiz back navigation ──
    else if (currentPage === "quiz-picker") {
      await goHome(bridge, baseUrl);
    }
    else if (currentPage === "quiz-question" || currentPage === "quiz-feedback") {
      clearQuiz();
      await showQuizPicker(bridge, baseUrl);
      log("< Back to quiz picker", "success");
    }
    else if (currentPage === "quiz-score") {
      clearQuiz();
      await showQuizPicker(bridge, baseUrl);
      log("< Back to quiz picker", "success");
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
  wineListPageIndex = 0; quizPage = 0; pairingsPage = 0; notesReturn = null;
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  log("< Back to Home", "success");
}

// ═══ QUIZ HELPER ═══
async function showQuizPicker(bridge: EvenAppBridge, baseUrl: string, page = 0): Promise<void> {
  // Load favorites from sync, fall back to first 10 wines
  const favIds = await getFavorites();
  const allFlat = getAllWinesFlat();
  quizWines = [];
  if (favIds.length > 0) {
    quizWines = favIds.map(id => {
      // Find wine by ID
      let idx = 0;
      for (const t of WINE_TYPES) {
        for (const c of COUNTRIES[t]) {
          for (const w of (WINES[t]?.[c] || [])) {
            if (`w${idx}` === id) return { wine: w, type: t, country: c, wineId: id };
            idx++;
          }
        }
      }
      return null;
    }).filter(Boolean) as typeof quizWines;
  }
  if (quizWines.length === 0) {
    quizWines = allFlat.slice(0, 15).map(w => ({
      ...w, wineId: getWineId(w.type, w.country, w.wine.name),
    }));
  }

  const names = quizWines.map(w => w.wine.name);
  await rebuild(bridge, buildQuizPickerPage(names, page));
  quizPage = quizPickerPage(names, page).page;

  currentPage = "quiz-picker";
  lastNavigationTime = Date.now();
}

async function startQuizForWine(
  bridge: EvenAppBridge, baseUrl: string,
  wine: Wine, wineType: WineType, wineCountry: string, wineId: string,
): Promise<void> {
  const qs = startQuizSession(wine, wineType, wineCountry, wineId);
  lastQuizWine = { wine, type: wineType, country: wineCountry, wineId };
  if (!qs) {
    log("[QUIZ] No questions generated", "error");
    return;
  }
  const q = qs.questions[0];
  const nameShort = wine.name.length > 30 ? wine.name.slice(0, 28) + ".." : wine.name;
  await rebuild(bridge, buildQuizQuestionPage(q, 1, qs.questions.length, nameShort));

  currentPage = "quiz-question";
  lastNavigationTime = Date.now();
  log(`> Quiz: ${wine.name} (${qs.questions.length}Q)`, "success");
}

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  invalidateImages();
  if (navigating) return;
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
      else if (idx === QUIZ_INDEX) {
        quizPage = 0;
        await showQuizPicker(bridge, baseUrl);
        log("> Quiz Me", "success");
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
        await rebuild(bridge, buildGrapeListPage(currentType, currentCountry));
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
            await pushGrapeSpriteToGlasses(bridge, baseUrl);
          };
          await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 140);
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
        await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 140);
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
        await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 140);
        log(`> ${r.wine.name} (finder)`, "success");
      }
      return;
    }

    // ═══ QUIZ ═══

    if (currentPage === "quiz-picker") {
      const row = quizPickerPage(quizWines.map(w => w.wine.name), quizPage).rows[idx];
      if (row?.kind === "back") { navigating = false; await goBack(bridge, baseUrl); return; }
      if (row?.kind === "more") { await showQuizPicker(bridge, baseUrl, quizPage + 1); return; }

      let targetWine: typeof quizWines[0] | null = null;
      if (row?.kind === "item" && row.index === 0) {
        // Random wine
        targetWine = quizWines[Math.floor(Math.random() * quizWines.length)];
      } else if (row?.kind === "item") {
        targetWine = quizWines[row.index - 1] ?? null;
      }

      if (targetWine) {
        await startQuizForWine(bridge, baseUrl, targetWine.wine, targetWine.type, targetWine.country, targetWine.wineId);
      }
      return;
    }

    if (currentPage === "quiz-question") {
      const qs = getQuizState();
      if (!qs) return;
      if (idx >= 0 && idx < qs.questions[qs.currentQ].options.length) {
        const result = answerQuiz(idx);
        if (result) {
          // Record answer to sync
          await recordQuizAnswer(qs.wineId, result.correct);
          // Show feedback page
          await rebuild(bridge, buildQuizFeedbackPage(
            result.correct, result.correctAnswer,
            qs.currentQ + 1, qs.questions.length, qs.score,
          ));

          currentPage = "quiz-feedback"; lastNavigationTime = Date.now();
        }
      }
      return;
    }

    if (currentPage === "quiz-feedback") {
      const qs = getQuizState();
      if (!qs) return;
      if (idx === 1) {
        // Quit quiz
        clearQuiz();
        await showQuizPicker(bridge, baseUrl);
        return;
      }
      if (idx === 0) {
        // Next question or see score
        const action = nextQuizQuestion();
        if (action === "next") {
          const q = qs.questions[qs.currentQ];
          const nameShort = qs.wine.name.length > 30 ? qs.wine.name.slice(0, 28) + ".." : qs.wine.name;
          await rebuild(bridge, buildQuizQuestionPage(
            q, qs.currentQ + 1, qs.questions.length, nameShort,
          ));

          currentPage = "quiz-question"; lastNavigationTime = Date.now();
        } else {
          // Done — show score
          const finalScore = endQuiz();
          if (finalScore) {
            await recordQuizSession(qs.wineId, qs.wine.name, finalScore.score, finalScore.total, finalScore.total);
            await checkAndUpdateLearned(qs.wineId);
            const nameShort = qs.wine.name.length > 30 ? qs.wine.name.slice(0, 28) + ".." : qs.wine.name;
            await rebuild(bridge, buildQuizScorePage(finalScore.score, finalScore.total, nameShort));

            currentPage = "quiz-score"; lastNavigationTime = Date.now();
            log(`Quiz done: ${finalScore.score}/${finalScore.total} (${finalScore.pct}%)`, "success");
          }
        }
      }
      return;
    }

    if (currentPage === "quiz-score") {
      if (idx === 0) {
        // Try again — restart with same wine
        // We need to refind the wine info
        const lastWine = lastQuizWine;
        if (lastWine) {
          await startQuizForWine(bridge, baseUrl, lastWine.wine, lastWine.type, lastWine.country, lastWine.wineId);
        }
      } else if (idx === 1) {
        // Random wine
        const target = quizWines[Math.floor(Math.random() * quizWines.length)];
        if (target) {
          await startQuizForWine(bridge, baseUrl, target.wine, target.type, target.country, target.wineId);
        }
      } else if (idx === 2) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
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
        // Resolve wine names from IDs
        const allFlat = getAllWinesFlat();
        const nameMap = new Map<string, string>();
        let wIdx = 0;
        for (const t of WINE_TYPES) {
          for (const c of COUNTRIES[t]) {
            for (const w of (WINES[t]?.[c] || [])) {
              nameMap.set(`w${wIdx}`, w.name);
              wIdx++;
            }
          }
        }
        const wineNames = activePairing.wineIds.map(id => nameMap.get(id) || `Unknown (${id})`);
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
        let wIdx = 0;
        for (const t of WINE_TYPES) {
          for (const c of COUNTRIES[t]) {
            for (const w of (WINES[t]?.[c] || [])) {
              if (`w${wIdx}` === targetId) {
                currentType = t; currentCountry = c; currentGrape = null;
                currentWineId = targetId;
                await rebuild(bridge, buildTastingNotesPage(w, targetId));
                currentPage = "notes"; lastNavigationTime = Date.now();
                const pairing = activePairing;
                const names = pairing.wineIds.map(id => lookupName(id));
                notesReturn = async () => {
                  await rebuild(bridge, buildPairingDetailPage(pairing, names));
                  currentPage = "pairing-detail"; activePairing = pairing; lastNavigationTime = Date.now();
                };
                await pushBottleSpriteDual(bridge, baseUrl, targetId, 100, 140);
                log(`> ${w.name} (pairing)`, "success");
                return;
              }
              wIdx++;
            }
          }
        }
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
  if (handleLibraryGlassesEvent(event)) return;
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

    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    if (type !== undefined && type !== OsEventTypeList.CLICK_EVENT) return;
    await handleClick(bridge, lastSelectedIndex, baseUrl);
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
