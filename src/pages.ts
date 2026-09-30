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
import type { Pairing, CourseSlot } from './sync';
import { pageList, wholeRowHeight, clipLabel, LIST_ROW_PITCH, type ListPage } from './glasses-list';

const BACK_LABEL = "Back";

// Home list: Find My Wine + Wine Pairings + Quiz Me + wine types
// Course Builder and 86 List live in the phone dashboard only
// No separator row: on G2 every list row is selectable, so a divider is a dead stop.
export const HOME_LIST_ITEMS = [
  "My Winebrary",
  "Find My Wine",
  "Wine Pairings",
  "Study today",
  ...WINE_TYPES.map(t => TYPE_DISPLAY[t]),
];
export const LIBRARY_INDEX = 0;
export const FINDER_INDEX = 1;
export const PAIRINGS_INDEX = 2;
export const STUDY_INDEX = 3;   // shared recall engine (study/glasses.ts)
export const TYPE_START_INDEX = 4;  // wine types start here

// List heights snap to whole 40 px rows so the last visible row is never clipped.
const LIST_VIEW_H = wholeRowHeight(254);   // 240 = 6 rows, leaves room for an info line
const HOME_LIST_H = wholeRowHeight(284);   // 280 = 7 rows

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
    xPosition: 2, yPosition: 2, width: 185, height: HOME_LIST_H,
    containerID: 2, containerName: "home-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: HOME_LIST_ITEMS.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...HOME_LIST_ITEMS].map(label => clipLabel(label)),
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
    xPosition: 290, yPosition: PANEL_TAG_Y, width: 280, height: 30,
    containerID: 5, containerName: "tag1",
    content: `YOUR WINE. IN FOCUS.`,
    isEventCapture: 0,
  });

  const tagLine2 = new TextContainerProperty({
    xPosition: 288, yPosition: PANEL_TAG_Y + 25, width: 280, height: 30,
    containerID: 6, containerName: "tag2",
    content: `A clearer view of wine.`,
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
    xPosition: 2, yPosition: 2, width: LIST_W, height: LIST_VIEW_H,
    containerID: 2, containerName: "countries",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
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
    xPosition: 2, yPosition: 2, width: LIST_W, height: LIST_VIEW_H,
    containerID: 2, containerName: "grapes",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
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

export function wineListPage(type: WineType, country: string, grape: string, page = 0): ListPage {
  const wines = getWinesForGrape(type, country, grape);
  return pageList(wines.map(w => getWineDisplayName(w, grape)), page);
}

export function buildWineListPage(type: WineType, country: string, grape: string, page = 0): RebuildPageContainer {
  const wines = getWinesForGrape(type, country, grape);
  const paged = wineListPage(type, country, grape, page);
  const listItems = paged.labels;

  // Same hierarchy as the Winebrary list: context line on top, list sized to its rows
  // (a list shorter than its container is centred vertically by the firmware).
  const LIST_Y = 42;
  const LIST_H = Math.min(LIST_VIEW_H, listItems.length * LIST_ROW_PITCH);

  const wineList = new ListContainerProperty({
    xPosition: 2, yPosition: LIST_Y, width: 572, height: LIST_H,
    containerID: 2, containerName: "wines",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
    }),
    isEventCapture: 1,
  });

  const wineLabel = wines.length === 1 ? 'wine' : 'wines';
  const infoText = new TextContainerProperty({
    xPosition: 16, yPosition: 4, width: 544, height: 34,
    containerID: 3, containerName: "info",
    content: clipLabel(`${grape} · ${country} · ${wines.length} ${wineLabel}` + (paged.pageCount > 1 ? ` · ${paged.page + 1}/${paged.pageCount}` : ''), 57),
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

export function buildTastingNotesPage(wine: Wine, _wineId: string | null): RebuildPageContainer {
  const IMG_X = 2;            // 2px safe zone from left
  const IMG_W = 100;          // display width (144 - 22 clipped each side)
  const IMG_H = 140;          // display height per half (2 × 140 = 280, under SDK max of 144)
  const IMG_Y = 4;            // centered: (288 - 280) / 2 = 4
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
  // Long names wrap to a second line instead of being cut off (~49 characters per line
  // at 470 px); everything below moves down and the notes keep whole lines only.
  const NAME_LINES = [...wine.name].length > Math.floor(TEXT_W / 9.5) ? 2 : 1;
  const NAME_H = NAME_LINES * 27 + 1;
  const header = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP, width: TEXT_W, height: NAME_H,
    containerID: 3, containerName: "wine-name",
    content: wine.name,
    isEventCapture: 0,
  });

  // Region · style
  // 28 px: one full 27 px text line (22 px clipped descenders: "Tuscany" read "Tuscanv").
  const sub = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP + NAME_H, width: TEXT_W, height: 28,
    containerID: 4, containerName: "sub",
    content: `${wine.region} · ${wine.style}`,
    isEventCapture: 0,
  });

  // Tasting notes — whole 27 px lines down to the floor (8 lines, or 7 under a two-line name)
  const NOTES_Y = TEXT_TOP + NAME_H + 28 + 4;
  const NOTES_H = Math.floor((286 - NOTES_Y) / 27) * 27 + 4;

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
// Each step: a selectable list and a full-height prompt panel.
//   2 = options list (left, narrow)
//   5 = step text in the right panel
//
// ══════════════════════════════════════════════════════════════════

const FINDER_STEP_H = 288 - PANEL_TAG_Y - 2; // flush to floor minus 2px safe zone

function finderContainers(listName: string, options: string[], stepContent: string) {
  const optList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 250, height: LIST_VIEW_H,
    containerID: 2, containerName: listName,
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options.map(label => clipLabel(label)),
    }),
    isEventCapture: 1,
  });

  const step = new TextContainerProperty({
    xPosition: 314, yPosition: 12, width: 260, height: 264,
    containerID: 5, containerName: "step",
    content: stepContent,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [optList],
    textObject: [step],
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
    xPosition: 10, yPosition: 20, width: 470, height: LIST_VIEW_H,
    containerID: 2, containerName: "results",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
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
    xPosition: 2, yPosition: 2, width: LIST_W, height: LIST_VIEW_H,
    containerID: 2, containerName: "course-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
    }),
    isEventCapture: 1,
  });

  const header = new TextContainerProperty({
    xPosition: 314, yPosition: 12, width: 260, height: 264,
    containerID: 5, containerName: "header",
    content: `Course Builder\n${courses.filter(c => c.wineName).length}/${courses.length} set`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [courseList],
    textObject: [header],
  });
}

// Course Builder uses the same finder flow pages (buildFinderTypePage, etc.)
// The events.ts handler tracks which course slot is being configured

// ══════════════════════════════════════════════════════════════════
// PAIRINGS — list of saved pairings
//   2 = pairing name list + Back
//   3,4 = logo sprite (right panel)
//   5 = header text
// ══════════════════════════════════════════════════════════════════

export function pairingsListPage(pairings: Pairing[], page = 0): ListPage {
  return pageList(pairings.map(p => `${p.name} (${p.wineIds.length}/5)`), page);
}

export function buildPairingsListPage(pairings: Pairing[], page = 0): RebuildPageContainer {
  const listItems = pairingsListPage(pairings, page).labels;

  const pairingList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: PANEL_X - 4, height: LIST_VIEW_H,
    containerID: 2, containerName: "pairings-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
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
      itemName: listItems.map(label => clipLabel(label)),
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
    xPosition: 2, yPosition: 2, width: 572, height: LIST_VIEW_H,
    containerID: 2, containerName: "86-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems.map(label => clipLabel(label)),
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
