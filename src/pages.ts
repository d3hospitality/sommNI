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

const BACK_LABEL = "Back";

// Home list: Find My Wine + wine types
export const HOME_LIST_ITEMS = ["Find My Wine", ...WINE_TYPES.map(t => TYPE_DISPLAY[t])];
export const FINDER_INDEX = 0;

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
//   Images 1-4 = bottle sprite in 4 strips (120×50 each)
//                flush far-left at x=2, total 120×200, y-centered
//   Text   5   = wine name           — y=2 (flush to ceiling)
//   Text   6   = region · style
//   Text   7   = tasting notes       — flush down to y=286 (scrollable)
//
//   Source: 188×288 PNG → rendered 120×200 → 4 × 120×50
//
//   Layout (576×288):
//   ┌──────────┬─────────────────────────────────────────┐ y=2
//   │          │ Sancerre "Le Mont" - Fourcher Lebrun    │
//   │          │ Loire Valley, FR · Dry - Mineral-Driven │
//   │ P1 120×50│─────────────────────────────────────────│
//   │──────────│ Appearance: Pale gold with green...     │
//   │ P2 120×50│ Nose: White peach, chalky mineral...   │
//   │──────────│ Palate: Crisp, racy acidity...         │
//   │ P3 120×50│ Finish: Long, saline, refreshing...    │
//   │──────────│ Story: ...                              │
//   │ P4 120×50│          (scrollable)                   │
//   └──────────┴─────────────────────────────────────────┘ y=288
//   2+120+4=126px               450px
// ══════════════════════════════════════════════════════════════════

export function buildTastingNotesPage(wine: Wine, _wineId: string): RebuildPageContainer {
  const IMG_X = 2;            // 2px safe zone from left
  const IMG_W = 120;
  const IMG_H = 50;
  const IMG_Y = 44;           // vertically center 200px bottle: (288–200)/2
  const TEXT_X = IMG_X + IMG_W + 4; // 126
  const TEXT_W = 576 - TEXT_X;      // 450
  const TEXT_TOP = 2;         // flush to ceiling

  // 4 image strips — flush left
  const p1 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y, width: IMG_W, height: IMG_H,
    containerID: 1, containerName: "bottle-1",
  });
  const p2 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y + IMG_H, width: IMG_W, height: IMG_H,
    containerID: 2, containerName: "bottle-2",
  });
  const p3 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y + IMG_H * 2, width: IMG_W, height: IMG_H,
    containerID: 3, containerName: "bottle-3",
  });
  const p4 = new ImageContainerProperty({
    xPosition: IMG_X, yPosition: IMG_Y + IMG_H * 3, width: IMG_W, height: IMG_H,
    containerID: 4, containerName: "bottle-4",
  });

  // Wine name — flush to ceiling
  const header = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP, width: TEXT_W, height: 28,
    containerID: 5, containerName: "wine-name",
    content: wine.name,
    isEventCapture: 0,
  });

  // Region · style
  const sub = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: TEXT_TOP + 28, width: TEXT_W, height: 22,
    containerID: 6, containerName: "sub",
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
    containerID: 7, containerName: "notes",
    content: notesLines.join("\n"),
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 7,
    textObject: [header, sub, notes],
    imageObject: [p1, p2, p3, p4],
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
