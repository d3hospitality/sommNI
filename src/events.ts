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

import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
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
  HOME_LIST_ITEMS, FINDER_INDEX, QUIZ_INDEX, PAIRINGS_INDEX,
  SEPARATOR_INDEX, TYPE_START_INDEX,
} from './pages';
import {
  pushLogoToGlasses, pushGlobeToGlasses, pushGrapeSpriteToGlasses,
  pushBottleSprite, pushBottleSpriteDual, pushRobotSpriteToGlasses,
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
import { log } from './ui';

// ═══ ROBOT EMOTION MAPPING PER FINDER STEP ═══
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

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredIndex: number = -1;

// ═══ REGISTER ═══
export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
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
  const r = finderResults[index];
  const wineId = getWineId(r.type, r.country, r.wine.name);
  await pushBottleSprite(bridge, baseUrl, wineId, 3, "bottle");
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

  try {
    log(`[BACK] from ${currentPage}`);

    // ── Browse navigation ──
    if (currentPage === "notes" && currentType && currentCountry && currentGrape) {
      await bridge.rebuildPageContainer(buildWineListPage(currentType, currentCountry, currentGrape));
      currentPage = "wines"; currentWineId = null; lastHoveredIndex = -1;
      lastNavigationTime = Date.now();
      log("< Back to wines", "success");
    }
    else if (currentPage === "notes" && currentType && currentCountry) {
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
      await goHome(bridge, baseUrl);
    }

    // ── Finder back navigation ──
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
      await bridge.rebuildPageContainer(buildPairingsListPage(pairingsCache));
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
  await bridge.rebuildPageContainer(rebuildHomePage());
  currentPage = "home"; currentType = null; currentCountry = null;
  currentGrape = null; currentWineId = null;
  finderAnswers = {}; lastHoveredIndex = -1;
  activePairing = null;
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  log("< Back to Home", "success");
}

// ═══ QUIZ HELPER ═══
async function showQuizPicker(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  // Load favorites from sync, fall back to first 10 wines
  const favIds = await getFavorites();
  const allFlat = getAllWinesFlat();
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

  const names = quizWines.map(w => {
    const n = w.wine.name;
    return n.length > 45 ? n.slice(0, 43) + ".." : n;
  });
  await bridge.rebuildPageContainer(buildQuizPickerPage(names));
  await pushRobotSpriteToGlasses(bridge, baseUrl, "thinking");
  currentPage = "quiz-picker";
  lastNavigationTime = Date.now();
}

async function startQuizForWine(
  bridge: EvenAppBridge, baseUrl: string,
  wine: Wine, wineType: WineType, wineCountry: string, wineId: string,
): Promise<void> {
  const qs = startQuizSession(wine, wineType, wineCountry, wineId);
  if (!qs) {
    log("[QUIZ] No questions generated", "error");
    return;
  }
  const q = qs.questions[0];
  const nameShort = wine.name.length > 30 ? wine.name.slice(0, 28) + ".." : wine.name;
  await bridge.rebuildPageContainer(buildQuizQuestionPage(q, 1, qs.questions.length, nameShort));
  await pushRobotSpriteToGlasses(bridge, baseUrl, pickRandom(["curious", "thinking"]));
  currentPage = "quiz-question";
  lastNavigationTime = Date.now();
  log(`> Quiz: ${wine.name} (${qs.questions.length}Q)`, "success");
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
        finderAnswers = {};
        await bridge.rebuildPageContainer(buildFinderTypePage());
        currentPage = "finder-type";
        lastNavigationTime = Date.now();
        await pushFinderRobot(bridge, baseUrl, "finder-type");
        log("> Find My Wine", "success");
      }
      else if (idx === QUIZ_INDEX) {
        await showQuizPicker(bridge, baseUrl);
        log("> Quiz Me", "success");
      }
      else if (idx === PAIRINGS_INDEX) {
        pairingsCache = await getPairings();
        await bridge.rebuildPageContainer(buildPairingsListPage(pairingsCache));
        await pushLogoToGlasses(bridge, baseUrl);
        currentPage = "pairings-list";
        lastNavigationTime = Date.now();
        log("> Pairings", "success");
      }
      else if (idx === SEPARATOR_INDEX) {
        // Separator — do nothing
      }
      else if (idx >= TYPE_START_INDEX) {
        const typeIdx = idx - TYPE_START_INDEX;
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
        if (wines.length === 1) {
          const wine = wines[0];
          const wineId = getWineId(currentType, currentCountry, wine.name);
          currentWineId = wineId;
          await bridge.rebuildPageContainer(buildTastingNotesPage(wine, wineId));
          currentPage = "notes"; lastNavigationTime = Date.now();
          await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 144);
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
        currentPage = "notes"; lastNavigationTime = Date.now();
        await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 144);
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
      await bridge.rebuildPageContainer(buildFinderVibePage());
      currentPage = "finder-vibe"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-vibe");
      log(`> Finder type: ${finderAnswers.type}`, "success");
      return;
    }

    if (currentPage === "finder-vibe") {
      const vibeIds = ["fresh", "smooth", "bold", "funky", "elegant", "cozy"];
      if (idx === 7) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === 6) { finderAnswers.vibe = "skip"; }
      else if (idx >= 0 && idx < 6) { finderAnswers.vibe = vibeIds[idx]; }
      const type = finderAnswers.type as WineType | undefined;
      await bridge.rebuildPageContainer(buildFinderFlavorPage(type && type !== "skip" ? type : null));
      currentPage = "finder-flavor"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-flavor");
      log(`> Finder vibe: ${finderAnswers.vibe}`, "success");
      return;
    }

    if (currentPage === "finder-flavor") {
      const type = finderAnswers.type as WineType | undefined;
      const flavorOpts = getFlavorOptionsForType(type && type !== "skip" ? type : null);
      const totalItems = flavorOpts.length + 2;
      if (idx === totalItems - 1) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === totalItems - 2) { finderAnswers.flavor = "skip"; }
      else if (idx >= 0 && idx < flavorOpts.length) { finderAnswers.flavor = flavorOpts[idx].id; }
      await bridge.rebuildPageContainer(buildFinderBodyPage());
      currentPage = "finder-body"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-body");
      log(`> Finder flavor: ${finderAnswers.flavor}`, "success");
      return;
    }

    if (currentPage === "finder-body") {
      const bodyIds = ["light", "medium", "full"];
      if (idx === 4) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx === 3) { finderAnswers.body = "skip"; }
      else if (idx >= 0 && idx < 3) { finderAnswers.body = bodyIds[idx]; }
      await bridge.rebuildPageContainer(buildFinderWorldPage());
      currentPage = "finder-world"; lastNavigationTime = Date.now();
      await pushFinderRobot(bridge, baseUrl, "finder-world");
      log(`> Finder body: ${finderAnswers.body}`, "success");
      return;
    }

    if (currentPage === "finder-world") {
      const worldIds = ["old", "new", "skip"];
      if (idx === 3) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < 3) { finderAnswers.world = worldIds[idx]; }
      finderResults = getRankedWines(finderAnswers).slice(0, 12);
      await bridge.rebuildPageContainer(buildFinderResultsPage(finderResults));
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
        await bridge.rebuildPageContainer(buildTastingNotesPage(r.wine, wineId));
        currentPage = "notes"; lastNavigationTime = Date.now();
        await pushBottleSpriteDual(bridge, baseUrl, wineId, 100, 144);
        log(`> ${r.wine.name} (finder)`, "success");
      }
      return;
    }

    // ═══ QUIZ ═══

    if (currentPage === "quiz-picker") {
      const backIdx = quizWines.length + 1; // +1 for "Random Wine" at top
      if (idx === backIdx) { navigating = false; await goBack(bridge, baseUrl); return; }

      let targetWine: typeof quizWines[0] | null = null;
      if (idx === 0) {
        // Random wine
        targetWine = quizWines[Math.floor(Math.random() * quizWines.length)];
      } else if (idx >= 1 && idx <= quizWines.length) {
        targetWine = quizWines[idx - 1];
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
          await bridge.rebuildPageContainer(buildQuizFeedbackPage(
            result.correct, result.correctAnswer,
            qs.currentQ + 1, qs.questions.length, qs.score,
          ));
          const emotion = result.correct
            ? pickRandom(["celebrating", "delighted", "presenting"])
            : pickRandom(["contemplating", "warning"]);
          await pushRobotSpriteToGlasses(bridge, baseUrl, emotion);
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
          await bridge.rebuildPageContainer(buildQuizQuestionPage(
            q, qs.currentQ + 1, qs.questions.length, nameShort,
          ));
          await pushRobotSpriteToGlasses(bridge, baseUrl, pickRandom(["curious", "thinking"]));
          currentPage = "quiz-question"; lastNavigationTime = Date.now();
        } else {
          // Done — show score
          const finalScore = endQuiz();
          if (finalScore) {
            await recordQuizSession(qs.wineId, qs.wine.name, finalScore.score, finalScore.total, finalScore.total);
            await checkAndUpdateLearned(qs.wineId);
            const nameShort = qs.wine.name.length > 30 ? qs.wine.name.slice(0, 28) + ".." : qs.wine.name;
            await bridge.rebuildPageContainer(buildQuizScorePage(finalScore.score, finalScore.total, nameShort));
            const emotion = finalScore.pct === 100 ? "celebrating" : finalScore.pct >= 75 ? "delighted" : "contemplating";
            await pushRobotSpriteToGlasses(bridge, baseUrl, emotion);
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
        const allFlat = getAllWinesFlat();
        const lastWine = quizWines.find(w => true); // pick first as fallback
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
      if (idx === pairingsCache.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < pairingsCache.length) {
        activePairing = pairingsCache[idx];
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
        await bridge.rebuildPageContainer(buildPairingDetailPage(activePairing, wineNames));
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
                await bridge.rebuildPageContainer(buildTastingNotesPage(w, targetId));
                currentPage = "notes"; lastNavigationTime = Date.now();
                await pushBottleSpriteDual(bridge, baseUrl, targetId, 100, 144);
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
