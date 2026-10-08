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
  WINE_TYPES, TYPE_DISPLAY, COUNTRIES, countriesFor,
  getGrapesForCountry, getWinesForGrape, getWinesForCountry, placeLabel,
  getFlavorOptionsForType, getWineDisplayName,
  Wine, WineType,
} from './constants';
import type { Pairing, CourseSlot } from './sync';
import { lookupWineById } from './identity';
import { catalogHidden } from './catalog-view';
import { pageList, wholeRowHeight, clipLabel, clipBytes, LIST_ROW_PITCH, type ListPage } from './glasses-list';

/** Tasting-notes footer. A tap on the notes saves the wine to My Winebrary (see quick-save.ts). */
export const NOTES_HINT = 'Scroll notes · Tap: save · Double tap: Back';

const BACK_LABEL = "Back";

// Home list: Find My Wine + Wine Pairings + Quiz Me + wine types
// Course Builder and 86 List live in the phone dashboard only
// No separator row: on G2 every list row is selectable, so a divider is a dead stop.
export const HOME_LIST_ITEMS = [
  "My Winebrary",
  "Find My Wine",
  "Wine Pairings",
  "Study",
  "Wine Atlas",
  ...WINE_TYPES.map(t => TYPE_DISPLAY[t]),
];
export const LIBRARY_INDEX = 0;
export const FINDER_INDEX = 1;
export const PAIRINGS_INDEX = 2;
export const STUDY_INDEX = 3;   // seasons + daily review (study/glasses.ts)
export const ATLAS_INDEX = 4;   // globe + winery-cluster explorer (atlas-app.ts)
export const TYPE_START_INDEX = 5;  // wine types start here
/** Home rows: the catalog's wine types only while the default wines are shown. */
export function homeItems(): string[] { return catalogHidden() ? HOME_LIST_ITEMS.slice(0, TYPE_START_INDEX) : [...HOME_LIST_ITEMS]; }

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
      itemCount: homeItems().length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: homeItems().map(label => clipLabel(label)),
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
    content: `Double tap: exit`,
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

/** Two lines under the globe: the hovered country and how much of the catalog it holds. */
export function countryInfoText(type: WineType, index: number): string {
  const countries = countriesFor(type);
  const country = countries[index];
  if (!country) {
    const wines = countries.reduce((n, c) => n + getWinesForCountry(type, c).length, 0);
    return `${TYPE_DISPLAY[type]} · ${countries.length} ${countries.length === 1 ? 'country' : 'countries'}\n${wines} wines, lit on the globe`;
  }
  const wines = getWinesForCountry(type, country).length;
  return `${country}\n${TYPE_DISPLAY[type]} · ${wines} ${wines === 1 ? 'wine' : 'wines'} · ${index + 1}/${countries.length}`;
}

export function buildCountryListPage(type: WineType): RebuildPageContainer {
  const countries = countriesFor(type);
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

  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 574 - PANEL_X, height: 56,
    containerID: 5, containerName: "info",
    content: countryInfoText(type, -1),
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
// TASTING NOTES v2 — "lit stage" layout, 7 containers (3 image + 4 text)
//   Images 1-2 = bottle on a lit stage (spotlight, floor pool, faint reflection), 112×140 halves
//   Image  6   = hairline rule under the header, fading out to the right
//   Text   3   = wine (1–2 lines)             Text 4 = producer · region
//   Text   5   = tasting notes (scrollable)   Text 7 = GRAPE · TYPE · STYLE kicker
//
//   ┌────────────┬──────────────────────────────────────┐ y=0
//   │   ░░▒▒░░   │ PINOT NOIR · RED · DRY, ELEGANT      │
//   │    ▐█▌     │ Aloxe-Corton                         │
//   │    ▐█▌     │ Louis Latour · Côte-de-Beaune, FR    │
//   │    ▐█▌     │ ━━━━━━━━━━━━━━━━━━━───────           │
//   │    ▐█▌     │ LOOK  Bright ruby with garnet hints. │
//   │  ░▒███▒░   │ NOSE  Red cherry, raspberry compote… │
//   │    ░░░     │ …                                    │
//   └────────────┴──────────────────────────────────────┘ y=288
// ══════════════════════════════════════════════════════════════════

/** Split "Aloxe-Corton – Louis Latour" into wine and producer. */
export function splitWineName(name: string): { title: string; producer: string } {
  const at = name.lastIndexOf(' – ');
  return at > 0 ? { title: name.slice(0, at).trim(), producer: name.slice(at + 3).trim() } : { title: name, producer: '' };
}

function clipChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

export const NOTES_IMG = { x: 4, y: 4, w: 112, h: 140 } as const;
// The hairline still draws one pixel; its image container must be at least 20px high.
export const NOTES_RULE = { w: 288, h: 20 } as const;

export function buildTastingNotesPage(wine: Wine, wineId: string | null): RebuildPageContainer {
  const TEXT_X = NOTES_IMG.x + NOTES_IMG.w + 8; // 124
  const TEXT_W = 576 - TEXT_X - 4;              // 448
  const PER_LINE = Math.floor(TEXT_W / 9.5);    // ~47 characters
  const LINE = 27;

  const p1 = new ImageContainerProperty({
    xPosition: NOTES_IMG.x, yPosition: NOTES_IMG.y, width: NOTES_IMG.w, height: NOTES_IMG.h,
    containerID: 1, containerName: "bottle-top",
  });
  const p2 = new ImageContainerProperty({
    xPosition: NOTES_IMG.x, yPosition: NOTES_IMG.y + NOTES_IMG.h, width: NOTES_IMG.w, height: NOTES_IMG.h,
    containerID: 2, containerName: "bottle-bot",
  });

  const { title, producer } = splitWineName(wine.name);
  const type = lookupWineById(wineId)?.type;
  const style = (wine.style || '').replace(/\s*[–-]\s*/g, ', ');
  const kickerText = clipChars([wine.grape, type, style].filter(Boolean).join(' · ').toUpperCase(), PER_LINE);
  const subText = clipChars([producer, placeLabel(wine.region, lookupWineById(wineId)?.country)].filter(Boolean).join(' · '), PER_LINE);

  let y = 2;
  const kicker = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: y, width: TEXT_W, height: LINE + 1,
    containerID: 7, containerName: "kicker", content: kickerText, isEventCapture: 0,
  });
  y += LINE + 1;

  const TITLE_LINES = [...title].length > PER_LINE ? 2 : 1;
  const TITLE_H = TITLE_LINES * LINE + 1;
  const header = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: y, width: TEXT_W, height: TITLE_H,
    containerID: 3, containerName: "wine-name", content: title, isEventCapture: 0,
  });
  y += TITLE_H;

  const sub = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: y, width: TEXT_W, height: LINE + 1,
    containerID: 4, containerName: "sub", content: subText, isEventCapture: 0,
  });
  y += LINE + 1;

  const rule = new ImageContainerProperty({
    xPosition: TEXT_X + 4, yPosition: y + 1, width: NOTES_RULE.w, height: NOTES_RULE.h,
    containerID: 6, containerName: "rule",
  });
  y += NOTES_RULE.h + 4;

  const NOTES_H = Math.floor((254 - y) / LINE) * LINE + 4;
  const sections: [string, string][] = [
    ["LOOK", wine.appearance], ["NOSE", wine.nose], ["PALATE", wine.palate], ["FINISH", wine.finish],
  ];
  if (wine.anecdote) sections.push(["STORY", wine.anecdote]);
  const body = sections.filter(([, text]) => text).map(([label, text]) => `${label}  ${text}`);
  body.push("— Catalog notes · not producer-verified");

  const notes = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: y, width: TEXT_W, height: NOTES_H,
    containerID: 5, containerName: "notes", content: clipBytes(body.join("\n\n")), isEventCapture: 1,
  });
  const footer = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: 258, width: TEXT_W, height: 28,
    containerID: 8, containerName: 'notes-hint', content: NOTES_HINT, isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 8,
    textObject: [header, sub, notes, kicker, footer],
    imageObject: [p1, p2, rule],
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
    // Empty: say where pairings come from instead of a bare "0 saved".
    content: pairings.length ? `Wine Pairings\n${pairings.length} saved` : 'No pairings yet.\nCreate one in Pairings\non your phone.',
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
