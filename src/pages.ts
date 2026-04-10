// ═══════════════════════════════════════════════════════════════════
// sommNI TG — Page Builders v2 (merged: editor positions + dynamic logic)
// Max 4 containers per page (soPHICON pattern)
// Navigation: Home → Countries → Grapes → Wines → Tasting Notes
// + Find My Wine (5-step questionnaire)
// ═══════════════════════════════════════════════════════════════════

import {
  CreateStartUpPageContainer, RebuildPageContainer,
  ListContainerProperty, TextContainerProperty,
  ImageContainerProperty, ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, TYPE_DISPLAY, COUNTRIES,
  getGrapesForCountry, getWinesForGrape, getWinesForCountry,
  getFlavorOptionsForType, getWineDisplayName,
  Wine, WineType,
} from './constants';
import type { QuizQuestion } from './quiz';
import type { Pairing, CourseSlot } from './sync';

const BACK_LABEL = "Back";

// Home list: Find My Wine + Wine Pairings + Quiz Me + wine types
// Course Builder and 86 List live in the phone dashboard only
export const HOME_LIST_ITEMS = [
  "Find My Wine",
  "Wine Pairings",
  "Quiz Me",
  "──────",   // separator
  ...WINE_TYPES.map(t => TYPE_DISPLAY[t]),
];
export const FINDER_INDEX = 0;
export const PAIRINGS_INDEX = 1;
export const QUIZ_INDEX = 2;
export const SEPARATOR_INDEX = 3;
export const TYPE_START_INDEX = 4;  // wine types start here

// ══════════════════════════════════════════════════════════════════
// Shared info-bar constants — right-aligned at bottom of screen
// ══════════════════════════════════════════════════════════════════
const INFO_X = 276;       // right half of 576px screen
const INFO_W = 298;       // ends at x=574 (2px safe zone from right)
const INFO_H = 25;

// ══════════════════════════════════════════════════════════════════
// Shared right-panel constants (home + finder pages share this layout)
//   Logo/sprite sits at PANEL_X, tagline/step text 3px right of that
// ══════════════════════════════════════════════════════════════════
const PANEL_X = 298;       // logo/sprite x (shifted 80px left from 378)
const PANEL_W = 190;       // image width
const PANEL_HALF_H = 95;   // each half of the split image
const PANEL_TOP_Y = 2;     // flush to ceiling (2px safe zone)
const PANEL_BOT_Y = PANEL_TOP_Y + PANEL_HALF_H;            // 97
const PANEL_TAG_Y = PANEL_BOT_Y + PANEL_HALF_H;             // 192
const PANEL_TAG_X = PANEL_X + 3;                            // 3px right of logo center
const PANEL_TAG_W = PANEL_W;                                // same width

// ══════════════════════════════════════════════════════════════════
// HOME — 5 containers
//   2 = list (left, narrow — text is short)
//   3 = logo top (190×95)
//   4 = logo bottom (190×95)
//   5 = "D3Hospitality" (300w, centered under logo)
//   6 = "Dining / Done Different" (300w, centered under logo)
// ══════════════════════════════════════════════════════════════════

function homeContainers() {
  const typeList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 185, height: 254,
    containerID: 2, containerName: "home-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: HOME_LIST_ITEMS.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...HOME_LIST_ITEMS],
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "logo-top",
  });

  const logoBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "logo-bottom",
  });

  // Tagline containers — text is left-aligned in SDK, so we position each
  // container so the text naturally appears centered under the logo.
  // Logo center = PANEL_X + PANEL_W/2 = 393
  // "D3Hospitality" ≈ 14ch × ~9px = ~126px → x = 393 - 63 = 330
  // "Dining / Done Different" ≈ 23ch × ~9px = ~207px → x = 393 - 103 = 290
  const tagLine1 = new TextContainerProperty({
    xPosition: 297, yPosition: PANEL_TAG_Y, width: 300, height: 30,
    containerID: 5, containerName: "tag1",
    content: `Dining / Done Different`,
    isEventCapture: 0,
  });

  const tagLine2 = new TextContainerProperty({
    xPosition: 337, yPosition: PANEL_TAG_Y + 25, width: 300, height: 30,
    containerID: 6, containerName: "tag2",
    content: `D3Hospitality`,
    isEventCapture: 0,
  });

  return { typeList, logoTop, logoBottom, tagLine1, tagLine2 };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 5,
    listObject: [c.typeList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 5,
    listObject: [c.typeList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// COUNTRY LIST — 4 containers
//   2 = country list + Back  (left side)
//   3 = globe top (190×95, same position as home logo)
//   4 = globe bottom (190×95)
//   5 = info text (below globe)
//   Format: "Red · 10 Countries"
// ══════════════════════════════════════════════════════════════════

export function buildCountryListPage(type: WineType): RebuildPageContainer {
  const countries = COUNTRIES[type];
  const listItems = [...countries, BACK_LABEL];

  const LIST_W = PANEL_X - 4; // 294 — leave room for globe on right

  const countryList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: LIST_W, height: 254,
    containerID: 2, containerName: "countries",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const globeTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "globe-top",
  });

  const globeBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "globe-bottom",
  });

  const countLabel = countries.length === 1 ? 'Country' : 'Countries';
  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: 50,
    containerID: 5, containerName: "info",
    content: `${TYPE_DISPLAY[type]} · ${countries.length} ${countLabel}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [countryList],
    textObject: [infoText],
    imageObject: [globeTop, globeBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// GRAPE LIST — 4 containers
//   2 = grape list + Back  (left side)
//   3 = grape sprite top (190×95, same position as globe/logo)
//   4 = grape sprite bottom (190×95)
//   5 = info text (below sprite)
//   Format: "Red · France · 15 Wines"
// ══════════════════════════════════════════════════════════════════

export function buildGrapeListPage(type: WineType, country: string): RebuildPageContainer {
  const grapes = getGrapesForCountry(type, country);

  const grapeLabels = grapes.map(g => {
    const count = getWinesForGrape(type, country, g).length;
    const label = g.length > 40 ? g.slice(0, 38) + ".." : g;
    return count > 1 ? `${label} (${count})` : label;
  });
  const listItems = [...grapeLabels, BACK_LABEL];

  const LIST_W = PANEL_X - 4;

  const grapeList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: LIST_W, height: 254,
    containerID: 2, containerName: "grapes",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const grapeTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "grape-top",
  });

  const grapeBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "grape-bottom",
  });

  const totalWines = getWinesForCountry(type, country).length;
  const wineLabel = totalWines === 1 ? 'Wine' : 'Wines';
  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: 50,
    containerID: 5, containerName: "info",
    content: `${TYPE_DISPLAY[type]} · ${country} · ${totalWines} ${wineLabel}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [grapeList],
    textObject: [infoText],
    imageObject: [grapeTop, grapeBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// WINE LIST — 2 containers (no image)
//   2 = wine names list + Back  (flush to top, 2px offset)
//   3 = info text                (5px below list)
//   Format: "Sauvignon Blanc · France · 3 Wines"
// ══════════════════════════════════════════════════════════════════

export function buildWineListPage(type: WineType, country: string, grape: string): RebuildPageContainer {
  const wines = getWinesForGrape(type, country, grape);

  const wineNames = wines.map(w => {
    const display = getWineDisplayName(w, grape);
    return display.length > 60 ? display.slice(0, 58) + ".." : display;
  });
  const listItems = [...wineNames, BACK_LABEL];

  const LIST_Y = 2;
  const LIST_H = 254;
  const INFO_Y = LIST_Y + LIST_H + 5;

  const wineList = new ListContainerProperty({
    xPosition: 2, yPosition: LIST_Y, width: 572, height: LIST_H,
    containerID: 2, containerName: "wines",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const wineLabel = wines.length === 1 ? 'Wine' : 'Wines';
  const infoText = new TextContainerProperty({
    xPosition: INFO_X, yPosition: INFO_Y, width: INFO_W, height: INFO_H,
    containerID: 3, containerName: "info",
    content: `${grape} · ${country} · ${wines.length} ${wineLabel}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [wineList],
    textObject: [infoText],
  });
}

// ══════════════════════════════════════════════════════════════════
// TASTING NOTES — 7 containers (4 image + 3 text)
//   Images 1-4 = bottle sprite in 4 strips
//                Display: 120w × 70h each, stacked at y=4 → total 280px, nearly full height
//                Image data: 120×140 per strip (center-cropped from 1024×1024 RGBA)
//                SDK limits: max 288w × 144h per image container
//   Text   5   = wine name           — y=2 (flush to ceiling)
//   Text   6   = region · style
//   Text   7   = tasting notes       — flush down to y=286 (scrollable)
//
//   Source: 1024×1024 RGBA → scale to fit 100×288 → 2 halves of 100×144
//   Display: 2 containers at 100×144 display pixels, stacked from y=0
//
//   Layout (576×288):
//   ┌──────────┬───────────────────────────────────────┐ y=0
//   │          │ Sancerre "Le Mont" - Fourcher Lebrun  │
//   │ 100×144  │ Loire Valley, FR · Dry - Mineral      │
//   │ (top)    │───────────────────────────────────────│
//   │          │ Appearance: Pale gold with green...   │
//   │──────────│ Nose: White peach, chalky mineral...  │
//   │          │ Palate: Crisp, racy acidity...        │
//   │ 100×144  │ Finish: Long, saline, refreshing...   │
//   │ (bot)    │ Story: ...                             │
//   │          │                                        │
//   └──────────┴───────────────────────────────────────┘ y=288
//   2+100+4=106px               470px
// ══════════════════════════════════════════════════════════════════

export function buildTastingNotesPage(wine: Wine, _wineId: string): RebuildPageContainer {
  const IMG_X = 2;            // 2px safe zone from left
  const IMG_W = 100;          // display width (144 - 22 clipped each side)
  const IMG_H = 144;          // display height per half (2 × 144 = 288, full screen)
  const IMG_Y = 0;            // flush top
  const TEXT_X = IMG_X + IMG_W + 4; // 106
  const TEXT_W = 576 - TEXT_X;      // 470
  const TEXT_TOP = 2;         // flush to ceiling

  // 2 image halves — scale-to-fit, no stretch, no crop
  const p1 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y, width: IMG_W, height: IMG_H,
    containerID: 1, containerName: "bottle-top",
  });
  const p2 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y + IMG_H, width: IMG_W, height: IMG_H,
    containerID: 2, containerName: "bottle-bot",
  });

  // Wine name — flush to ceiling
  const header = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP, width: TEXT_W, height: 28,
    containerID: 3, containerName: "wine-name",
    content: wine.name,
    isEventCapture: 0,
  });

  // Region · style
  const sub = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP + 28, width: TEXT_W, height: 22,
    containerID: 4, containerName: "sub",
    content: `${wine.region} · ${wine.style}`,
    isEventCapture: 0,
  });

  // Tasting notes — 5px gap below sub, flush all the way down to bottom
  const NOTES_Y = TEXT_TOP + 28 + 22 + 5; // header + sub + 5px gap = 57
  const NOTES_H = 288 - NOTES_Y - 2;     // 229px, flush to floor with 2px safe zone

  const notesLines: string[] = [];
  notesLines.push("Appearance: " + wine.appearance);
  notesLines.push("");
  notesLines.push("Nose: " + wine.nose);
  notesLines.push("");
  notesLines.push("Palate: " + wine.palate);
  notesLines.push("");
  notesLines.push("Finish: " + wine.finish);
  if (wine.anecdote) {
    notesLines.push("");
    notesLines.push("Story: " + wine.anecdote);
  }

  const notes = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: NOTES_Y, width: TEXT_W, height: NOTES_H,
    containerID: 5, containerName: "notes",
    content: notesLines.join("\n"),
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 5,
    textObject: [header, sub, notes],
    imageObject: [p1, p2],
  });
}

// ══════════════════════════════════════════════════════════════════
// FIND MY WINE — 5-step questionnaire pages
// Each step: 4 containers (list + robot sprite top/bottom + step text)
//   2 = options list (left, narrow)
//   3 = robot sprite top half (same position as home logo)
//   4 = robot sprite bottom half
//   5 = step text (same position as home tagline, flush to floor)
//
// Robot emotion per step (shuffled where noted — picked in events.ts):
//   Step 1 → thinking
//   Step 2 → contemplating
//   Step 3 → curious | warning (random)
//   Step 4 → swirling | sommelier (random)
//   Step 5 → presenting | delighted | pouring | celebrating (random)
// ══════════════════════════════════════════════════════════════════

const FINDER_STEP_H = 288 - PANEL_TAG_Y - 2; // flush to floor minus 2px safe zone

function finderContainers(listName: string, options: string[], stepContent: string) {
  const optList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 250, height: 254,
    containerID: 2, containerName: listName,
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  const step = new TextContainerProperty({
    xPosition: PANEL_TAG_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_TAG_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "step",
    content: stepContent,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [optList],
    textObject: [step],
    imageObject: [spriteTop, spriteBottom],
  });
}

export function buildFinderTypePage(): RebuildPageContainer {
  return finderContainers("finder-type",
    ["Red", "White", "Sparkling", "Rosé", "Orange", "Dessert", "Surprise Me", BACK_LABEL],
    "Step 1/5\nWhat are you\nin the mood for?");
}

export function buildFinderVibePage(): RebuildPageContainer {
  return finderContainers("finder-vibe",
    ["Fresh & Crisp", "Smooth & Easy", "Bold & Powerful",
     "Funky & Adventurous", "Elegant & Complex", "Cozy & Warm",
     "Skip", BACK_LABEL],
    "Step 2/5\nWhat kind of vibe?");
}

export function buildFinderFlavorPage(type: WineType | null): RebuildPageContainer {
  const flavorOpts = getFlavorOptionsForType(type);
  const options = [...flavorOpts.map(f => f.label), "Skip", BACK_LABEL];
  return finderContainers("finder-flavor", options,
    "Step 3/5\nWhat sounds good\nright now?");
}

export function buildFinderBodyPage(): RebuildPageContainer {
  return finderContainers("finder-body",
    ["Light & Refreshing", "Medium & Balanced", "Full & Rich", "Skip", BACK_LABEL],
    "Step 4/5\nHow should it feel?");
}

export function buildFinderWorldPage(): RebuildPageContainer {
  return finderContainers("finder-world",
    ["Old World", "New World", "No Preference", BACK_LABEL],
    "Step 5/5\nOld World or\nNew World?");
}

// ══════════════════════════════════════════════════════════════════
// FINDER RESULTS — 3 containers
//   2 = top wine names list + Back
//   3 = bottle sprite (100x100) — reactive
//   4 = match info
// ══════════════════════════════════════════════════════════════════

export function buildFinderResultsPage(
  results: { wine: Wine; type: WineType; country: string; score: number }[],
): RebuildPageContainer {
  const top = results.slice(0, 12);

  const wineNames = top.map(r => {
    // Strip grape prefix — finder results span multiple grapes
    const mainGrape = r.wine.grape.split("/")[0].replace(/\s*\([^)]*\)/, "").trim();
    let display = r.wine.name;
    if (display.startsWith(mainGrape)) {
      const rest = display.slice(mainGrape.length).replace(/^[\s–—\-]+/, "").trim();
      if (rest.length > 0) display = rest;
    }
    return display.length > 40 ? display.slice(0, 38) + ".." : display;
  });
  const listItems = [...wineNames, BACK_LABEL];

  const resultList = new ListContainerProperty({
    xPosition: 10, yPosition: 20, width: 470, height: 255,
    containerID: 2, containerName: "results",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 486, yPosition: 10, width: 80, height: 80,
    containerID: 3, containerName: "bottle",
  });

  const firstResult = top[0];
  const infoText = new TextContainerProperty({
    xPosition: 486, yPosition: 92, width: 86, height: 50,
    containerID: 4, containerName: "info",
    content: firstResult
      ? `${firstResult.country}`
      : "No matches",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [resultList],
    textObject: [infoText],
    imageObject: [bottleSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// COURSE BUILDER — overview of saved courses (up to 5)
//   2 = course slot list (left panel)
//   3 = robot sprite top (right panel)
//   4 = robot sprite bottom
//   5 = header text
// ══════════════════════════════════════════════════════════════════

export function buildCourseOverviewPage(courses: CourseSlot[]): RebuildPageContainer {
  const listItems: string[] = [];

  // Show course slots (max 5)
  for (let i = 0; i < Math.max(courses.length, 1); i++) {
    const c = courses[i];
    if (c && c.wineName) {
      listItems.push(`${i + 1}. ${c.wineName.length > 30 ? c.wineName.slice(0, 28) + ".." : c.wineName}`);
    } else {
      listItems.push(`${i + 1}. [Set up course]`);
    }
  }

  if (courses.length < 5) listItems.push("+ Add Course");
  listItems.push(BACK_LABEL);

  const LIST_W = PANEL_X - 4;

  const courseList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: LIST_W, height: 254,
    containerID: 2, containerName: "course-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  const header = new TextContainerProperty({
    xPosition: PANEL_TAG_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_TAG_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "header",
    content: `Course Builder\n${courses.filter(c => c.wineName).length}/${courses.length} set`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [courseList],
    textObject: [header],
    imageObject: [spriteTop, spriteBottom],
  });
}

// Course Builder uses the same finder flow pages (buildFinderTypePage, etc.)
// The events.ts handler tracks which course slot is being configured

// ══════════════════════════════════════════════════════════════════
// QUIZ — question page with 4 options
//   2 = options list (left, wide — options are long text)
//   3 = robot sprite top (right panel)
//   4 = robot sprite bottom
//   5 = question text + category + progress
// ══════════════════════════════════════════════════════════════════

export function buildQuizQuestionPage(
  q: QuizQuestion, questionNum: number, totalQuestions: number,
  wineName: string,
): RebuildPageContainer {
  const listItems = [...q.options.map(o =>
    o.length > 55 ? o.slice(0, 53) + ".." : o
  )];

  const optList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 300, height: 254,
    containerID: 2, containerName: "quiz-opts",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  // Truncate wine name for display
  const nameShort = wineName.length > 28 ? wineName.slice(0, 26) + ".." : wineName;

  const questionText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "question",
    content: `Q${questionNum}/${totalQuestions} · ${q.category}\n\n${q.question}\n\n${nameShort}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [optList],
    textObject: [questionText],
    imageObject: [spriteTop, spriteBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ — answer feedback page (shows correct/wrong + Next/Score)
//   2 = action list (Next Question / See Score / Quit)
//   5 = feedback text
//   3,4 = robot sprite
// ══════════════════════════════════════════════════════════════════

export function buildQuizFeedbackPage(
  correct: boolean, correctAnswer: string,
  questionNum: number, totalQuestions: number,
  scoreSoFar: number,
): RebuildPageContainer {
  const isLast = questionNum >= totalQuestions;
  const listItems = isLast
    ? ["See Score", "Quit Quiz"]
    : ["Next Question", "Quit Quiz"];

  const actionList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 300, height: 254,
    containerID: 2, containerName: "quiz-action",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  const mark = correct ? "CORRECT!" : "WRONG";
  const ansLine = correct ? "" : `\nAnswer:\n${correctAnswer.length > 45 ? correctAnswer.slice(0, 43) + ".." : correctAnswer}`;
  const feedback = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "feedback",
    content: `${mark}${ansLine}\n\nScore: ${scoreSoFar}/${questionNum}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [actionList],
    textObject: [feedback],
    imageObject: [spriteTop, spriteBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ — score screen
//   2 = action list (Try Again / Random Wine / Back)
//   5 = score display
//   3,4 = robot sprite (celebrating if high score)
// ══════════════════════════════════════════════════════════════════

export function buildQuizScorePage(
  score: number, total: number, wineName: string,
): RebuildPageContainer {
  const pct = Math.round((score / total) * 100);
  const emoji = pct === 100 ? "PERFECT" : pct >= 75 ? "GREAT" : pct >= 50 ? "GOOD" : "KEEP GOING";
  const nameShort = wineName.length > 30 ? wineName.slice(0, 28) + ".." : wineName;

  const listItems = ["Try Again", "Random Wine", BACK_LABEL];

  const actionList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 300, height: 254,
    containerID: 2, containerName: "quiz-score-action",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  const scoreText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "score",
    content: `${emoji}!\n\n${score}/${total} — ${pct}%\n\n${nameShort}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [actionList],
    textObject: [scoreText],
    imageObject: [spriteTop, spriteBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ — wine picker (list of favorited wines to quiz on)
//   2 = wine list + Random + Back
//   3,4 = robot sprite
//   5 = header
// ══════════════════════════════════════════════════════════════════

export function buildQuizPickerPage(
  wineNames: string[],
): RebuildPageContainer {
  const listItems = ["Random Wine", ...wineNames.map(n =>
    n.length > 50 ? n.slice(0, 48) + ".." : n
  ), BACK_LABEL];

  const pickerList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: PANEL_X - 4, height: 254,
    containerID: 2, containerName: "quiz-picker",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "robot-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "robot-bottom",
  });

  const header = new TextContainerProperty({
    xPosition: PANEL_TAG_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_TAG_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "header",
    content: `Quiz Me\n\nPick a wine or\ngo random`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [pickerList],
    textObject: [header],
    imageObject: [spriteTop, spriteBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// PAIRINGS — list of saved pairings
//   2 = pairing name list + Back
//   3,4 = logo sprite (right panel)
//   5 = header text
// ══════════════════════════════════════════════════════════════════

export function buildPairingsListPage(pairings: Pairing[]): RebuildPageContainer {
  const listItems = pairings.map(p => {
    const label = `${p.name} (${p.wineIds.length}/5)`;
    return label.length > 45 ? label.slice(0, 43) + ".." : label;
  });
  listItems.push(BACK_LABEL);

  const pairingList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: PANEL_X - 4, height: 254,
    containerID: 2, containerName: "pairings-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "logo-top",
  });

  const spriteBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "logo-bottom",
  });

  const header = new TextContainerProperty({
    xPosition: PANEL_TAG_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_TAG_X, height: FINDER_STEP_H,
    containerID: 5, containerName: "header",
    content: `Wine Pairings\n${pairings.length} saved`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [pairingList],
    textObject: [header],
    imageObject: [spriteTop, spriteBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// PAIRING DETAIL — wine names in a pairing + notes
//   2 = wine list + Back (left side, full width)
//   3 = pairing name + notes (below list)
// ══════════════════════════════════════════════════════════════════

export function buildPairingDetailPage(
  pairing: Pairing,
  wineNames: string[],
): RebuildPageContainer {
  const listItems = wineNames.map((n, i) => {
    const label = `${i + 1}. ${n}`;
    return label.length > 55 ? label.slice(0, 53) + ".." : label;
  });
  listItems.push(BACK_LABEL);

  const wineList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 572, height: 200,
    containerID: 2, containerName: "pairing-wines",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const notesContent = pairing.name + (pairing.notes ? `\n\n${pairing.notes}` : "");
  const notes = new TextContainerProperty({
    xPosition: 2, yPosition: 210, width: 572, height: 74,
    containerID: 3, containerName: "pairing-notes",
    content: notesContent.length > 120 ? notesContent.slice(0, 118) + ".." : notesContent,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [wineList],
    textObject: [notes],
  });
}

// ══════════════════════════════════════════════════════════════════
// 86 LIST — out-of-stock wines
//   2 = wine list + Back (full width)
//   3 = count header
// ══════════════════════════════════════════════════════════════════

export function build86ListPage(
  outOfStockWines: { name: string; grape: string; country: string }[],
): RebuildPageContainer {
  const listItems = outOfStockWines.map(w => {
    const label = `${w.name.length > 40 ? w.name.slice(0, 38) + ".." : w.name}`;
    return label;
  });
  listItems.push(BACK_LABEL);

  const wineList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 572, height: 254,
    containerID: 2, containerName: "86-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const header = new TextContainerProperty({
    xPosition: INFO_X, yPosition: 260, width: INFO_W, height: INFO_H,
    containerID: 3, containerName: "86-header",
    content: `86 List · ${outOfStockWines.length} out of stock`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [wineList],
    textObject: [header],
  });
}
