import { foodPairingsText } from './food-pairings';
import { cursorRows } from './glasses-cursor';
import { SCENE_X, MAP_Y, TILE_W, TILE_H } from './wine-scene';
import { GLASS_WIDTH, GLASS_HEIGHT } from './intelligence/pour';
import { textParagraphs } from './history/content';
import { getCatalogAnecdote, anecdotePublishers } from './catalog-anecdotes';
import { readableText, READING_MAX_BYTES } from './reading/document';
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
import { lookupWineById } from './identity';
import { pageList, wholeRowHeight, clipLabel, clipBytes, labelBytes, LIST_ROW_PITCH, type ListPage } from './glasses-list';

const BACK_LABEL = "Back";

// Frequently used browsing first, then discovery, learning and account setup.
export const HOME_LIST_ITEMS = [
  'Winebrary', 'Atlas', 'Grapes', 'Find My Wine',
  'Wine History', 'Study Today', 'Pairings', 'Link Account',
];
export const LIBRARY_INDEX = 0;
export const ATLAS_INDEX = 1;
export const TYPE_START_INDEX = 2;
export const FINDER_INDEX = 3;
export const HISTORY_INDEX = 4;
export const STUDY_INDEX = 5;
export const PAIRINGS_INDEX = 6;

// List heights snap to whole 40 px rows so the last visible row is never clipped.
const LIST_VIEW_H = wholeRowHeight(254);   // 240 = 6 rows, leaves room for an info line

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
// HOME — 3 containers
//   2 = compact text cursor menu (left)
//   3 = Aperture with a centered ソムニ / retro sommNI backdrop (128×144)
//   6 = exit hint
// ══════════════════════════════════════════════════════════════════

function homeContainers() {
  const typeList = new TextContainerProperty({
    xPosition: 12, yPosition: 30, width: 280, height: 224,
    containerID: 2, containerName: 'home-list',
    content: cursorRows(HOME_LIST_ITEMS, 0, 280, 8), isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 414-GLASS_WIDTH/2, yPosition: 66, width: GLASS_WIDTH, height: GLASS_HEIGHT,
    containerID: 3, containerName: "home-pour",
  });

  const tagLine2 = new TextContainerProperty({
    xPosition: 330, yPosition: 250, width: 240, height: 30,
    containerID: 6, containerName: "tag2",
    content: `Double tap: exit`,
    isEventCapture: 0,
  });

  return { typeList, logoTop, tagLine2 };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [c.typeList, c.tagLine2],
    imageObject: [c.logoTop],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [c.typeList, c.tagLine2],
    imageObject: [c.logoTop],
  });
}

// ══════════════════════════════════════════════════════════════════
// COUNTRY CURSOR — 5 containers
//   2 = text cursor + Back (left side; every swipe updates the globe)
//   3 = globe top (190×95, same position as home logo)
//   4 = globe bottom (190×95)
//   5 = info text (below globe)
//   Format: "Red · 10 Countries"
// ══════════════════════════════════════════════════════════════════

/** Two lines under the globe: the hovered country and how much of the catalog it holds. */
export function countryInfoText(type: WineType, index: number): string {
  const countries = COUNTRIES[type];
  const country = countries[index];
  if (!country) {
    const wines = countries.reduce((n, c) => n + getWinesForCountry(type, c).length, 0);
    return `${TYPE_DISPLAY[type]} · ${countries.length} ${countries.length === 1 ? 'country' : 'countries'}\n${wines} wines, lit on the globe`;
  }
  const wines = getWinesForCountry(type, country).length;
  return `${country}\n${TYPE_DISPLAY[type]} · ${wines} ${wines === 1 ? 'wine' : 'wines'} · ${index + 1}/${countries.length}`;
}

export function countryRows(type: WineType, index = 0): string {
  const labels = [...COUNTRIES[type], BACK_LABEL];
  const start = Math.max(0, Math.min(index - 2, labels.length - 6));
  return labels.slice(start, start + 6).map((label, row) => `${start + row === index ? '>' : ' '} ${clipLabel(label, 30)}`).join('\n');
}
export function buildCountryListPage(type: WineType, index = 0): RebuildPageContainer {
  return new RebuildPageContainer({containerTotalNum:5,textObject:[
    new TextContainerProperty({xPosition:12,yPosition:12,width:280,height:30,containerID:1,containerName:'country-title',content:`${TYPE_DISPLAY[type]} · Countries`,isEventCapture:0}),
    new TextContainerProperty({xPosition:12,yPosition:52,width:280,height:180,containerID:2,containerName:'countries',content:countryRows(type,index),isEventCapture:1}),
    new TextContainerProperty({xPosition:PANEL_X,yPosition:PANEL_TAG_Y,width:574-PANEL_X,height:56,containerID:5,containerName:'info',content:countryInfoText(type,index),isEventCapture:0}),
  ],imageObject:[
    new ImageContainerProperty({xPosition:PANEL_X,yPosition:PANEL_TOP_Y,width:PANEL_W,height:PANEL_HALF_H,containerID:3,containerName:'globe-top'}),
    new ImageContainerProperty({xPosition:PANEL_X,yPosition:PANEL_BOT_Y,width:PANEL_W,height:PANEL_HALF_H,containerID:4,containerName:'globe-bottom'}),
  ]});
}

// ══════════════════════════════════════════════════════════════════
// GRAPE CURSOR — text selection with a representative bottle over its origin.
// ══════════════════════════════════════════════════════════════════

export function grapeListLabels(type: WineType, country: string): string[] {
  return [...getGrapesForCountry(type,country).map(grape=>`${grape} (${getWinesForGrape(type,country,grape).length})`), BACK_LABEL];
}
function bottleCursorPage(name: string, labels: string[], header: string, country: string, cursor: number): RebuildPageContainer {
  return new RebuildPageContainer({containerTotalNum:6,textObject:[
    new TextContainerProperty({xPosition:12,yPosition:4,width:SCENE_X-24,height:34,containerID:3,containerName:'info',content:clipLabel(header,36),isEventCapture:0}),
    new TextContainerProperty({xPosition:12,yPosition:42,width:SCENE_X-24,height:196,containerID:2,containerName:name,content:cursorRows(labels,cursor,SCENE_X-24),isEventCapture:1}),
    new TextContainerProperty({xPosition:SCENE_X,yPosition:4,width:TILE_W,height:30,containerID:5,containerName:'browse-place',content:clipLabel(country,20),isEventCapture:0}),
    new TextContainerProperty({xPosition:12,yPosition:242,width:SCENE_X-24,height:40,containerID:6,containerName:'browse-preview',content:'Scroll to preview · Tap to open',isEventCapture:0}),
  ],imageObject:[
    new ImageContainerProperty({xPosition:SCENE_X,yPosition:MAP_Y,width:TILE_W,height:TILE_H,containerID:1,containerName:'browse-top'}),
    new ImageContainerProperty({xPosition:SCENE_X,yPosition:MAP_Y+TILE_H,width:TILE_W,height:TILE_H,containerID:4,containerName:'browse-bottom'}),
  ]});
}
export function buildGrapeListPage(type: WineType, country: string, cursor = 0): RebuildPageContainer {
  return bottleCursorPage('grapes',grapeListLabels(type,country),`${TYPE_DISPLAY[type]} · Grapes`,country,cursor);
}

// ══════════════════════════════════════════════════════════════════
// WINE CURSOR — live bottle over its origin map; the same six-container layout.
// ══════════════════════════════════════════════════════════════════

export function wineListPage(type: WineType, country: string, grape: string, page = 0): ListPage {
  const wines = getWinesForGrape(type, country, grape);
  return pageList(wines.map(w => getWineDisplayName(w, grape)), page);
}

export function buildWineListPage(type: WineType, country: string, grape: string, page = 0, cursor = 0): RebuildPageContainer {
  const paged=wineListPage(type,country,grape,page);
  const count=getWinesForGrape(type,country,grape).length;
  return bottleCursorPage('wines',paged.labels,`${grape} · ${count} wines${paged.pageCount>1?` · ${paged.page+1}/${paged.pageCount}`:''}`,country,cursor);
}

// ══════════════════════════════════════════════════════════════════
// TASTING NOTES v2 — "lit stage" layout, 7 containers (3 image + 4 text)
//   Images 1-2 = bottle portrait on an unlit field, 112×140 halves
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
  const kickerText = [wine.grape, type, style].filter(Boolean).join(' · ');
  const subText = clipChars([producer, wine.region].filter(Boolean).join(' · '), PER_LINE);

  let y = 2;
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

  const NOTES_H = Math.floor((254 - y) / LINE) * LINE + 4;
  const sections: [string, string][] = [
    ["LOOK", wine.appearance], ["NOSE", wine.nose], ["PALATE", wine.palate], ["FINISH", wine.finish],
  ];

  const body = sections.filter(([, text]) => text).map(([label, text]) => `${label}\n${text}`);
  const pairings=foodPairingsText({grape:wine.grape,style:wine.style,color:type});
  if(pairings)body.push(pairings);
  if (wine.anecdote) body.push(`BEHIND THE WINE\n${wineId&&getCatalogAnecdote(wineId)?.title?getCatalogAnecdote(wineId)!.title+'\n\n':''}${textParagraphs(wine.anecdote).join('\n\n')}`);
  if(wineId){const record=getCatalogAnecdote(wineId);const publishers=anecdotePublishers(wineId);if(record)body.push((record.scope==='producer'?'Producer history':'Wine history')+' · AI-researched\n'+publishers.join(' · '));}
  body.push('Reference tasting profile; exact vintage unconfirmed.');

  const notes = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: y, width: TEXT_W, height: NOTES_H,
    containerID: 5, containerName: "notes", content: clipBytes(body.join("\n\n")), isEventCapture: 1,
  });
  const footer = new TextContainerProperty({
    xPosition: TEXT_X, yPosition: 258, width: TEXT_W, height: 28,
    containerID: 8, containerName: 'notes-hint', content: 'Scroll notes · 2x: Back', isEventCapture: 0,
  });

  // Keep the wine and producer visible; scroll grape/style with the tasting narrative.
  header.yPosition=4; sub.yPosition=4+TITLE_H;
  notes.yPosition=8+TITLE_H+LINE; notes.height=250-notes.yPosition;
  const fullReading=[kickerText,...body].join('\n\n'),tail='\n\nContinued on your phone.';
  const reading=labelBytes(fullReading)>READING_MAX_BYTES?clipBytes(fullReading,READING_MAX_BYTES-labelBytes(tail))+tail:fullReading;
  return readableText(new RebuildPageContainer({
    containerTotalNum: 6,
    textObject: [header, sub, notes, footer],
    imageObject: [p1, p2],
  }), 5, reading);
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

/** The home stays quiet; catalog styles now live inside one folder. */
export function buildWineTypesPage():RebuildPageContainer {
 const labels=[...WINE_TYPES.map(t=>TYPE_DISPLAY[t]),'Back'];
 return new RebuildPageContainer({containerTotalNum:2,textObject:[new TextContainerProperty({xPosition:16,yPosition:4,width:544,height:32,containerID:1,containerName:'grape-folder',content:'WINE BY GRAPE · Choose a style',isEventCapture:0})],listObject:[new ListContainerProperty({xPosition:2,yPosition:42,width:572,height:240,containerID:2,containerName:'wine-types',isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:labels.length,itemWidth:0,isItemSelectBorderEn:1,itemName:labels})})]});
}
