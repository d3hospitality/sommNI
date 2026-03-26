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
  getFlavorOptionsForType,
  Wine, WineType,
} from './constants';

const BACK_LABEL = "Back";

// Home list: Find My Wine + wine types
export const HOME_LIST_ITEMS = ["Find My Wine", ...WINE_TYPES.map(t => TYPE_DISPLAY[t])];
export const FINDER_INDEX = 0;

// ══════════════════════════════════════════════════════════════════
// HOME — 3 containers
//   2 = list: [Find My Wine, Red, White, Sparkling, Rosé, Orange, Dessert]
//   3 = logo top (200x100)
//   4 = logo bottom (200x100)
// ══════════════════════════════════════════════════════════════════

function homeContainers() {
  const typeList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 255,
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
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const logoBottom = new ImageContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 100,
    containerID: 4, containerName: "logo-bottom",
  });

  return { typeList, logoTop, logoBottom };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 3,
    listObject: [c.typeList],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [c.typeList],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// COUNTRY LIST — 3 containers
//   2 = country list + Back
//   3 = bottle sprite (100x100)
//   4 = info text
// ══════════════════════════════════════════════════════════════════

export function buildCountryListPage(type: WineType): RebuildPageContainer {
  const countries = COUNTRIES[type];
  const listItems = [...countries, BACK_LABEL];

  const countryList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 370, height: 255,
    containerID: 2, containerName: "countries",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 400, yPosition: 85, width: 100, height: 100,
    containerID: 3, containerName: "bottle",
  });

  const infoText = new TextContainerProperty({
    xPosition: 400, yPosition: 185, width: 155, height: 90,
    containerID: 4, containerName: "count",
    content: `${TYPE_DISPLAY[type]}\n${countries.length} countries`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [countryList],
    textObject: [infoText],
    imageObject: [bottleSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// GRAPE LIST — 3 containers
//   2 = grape list + Back
//   3 = bottle sprite (100x100)
//   4 = info text
// ══════════════════════════════════════════════════════════════════

export function buildGrapeListPage(type: WineType, country: string): RebuildPageContainer {
  const grapes = getGrapesForCountry(type, country);

  const grapeLabels = grapes.map(g => {
    const count = getWinesForGrape(type, country, g).length;
    const label = g.length > 22 ? g.slice(0, 20) + ".." : g;
    return count > 1 ? `${label} (${count})` : label;
  });
  const listItems = [...grapeLabels, BACK_LABEL];

  const grapeList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 370, height: 255,
    containerID: 2, containerName: "grapes",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 400, yPosition: 85, width: 100, height: 100,
    containerID: 3, containerName: "bottle",
  });

  const totalWines = getWinesForCountry(type, country).length;
  const infoText = new TextContainerProperty({
    xPosition: 400, yPosition: 185, width: 155, height: 90,
    containerID: 4, containerName: "info",
    content: `${TYPE_DISPLAY[type]} · ${country}\n${totalWines} wines`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [grapeList],
    textObject: [infoText],
    imageObject: [bottleSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// WINE LIST — 3 containers
//   2 = wine names list + Back
//   3 = bottle sprite (100x100) — reactive on hover
//   4 = info text
// ══════════════════════════════════════════════════════════════════

export function buildWineListPage(type: WineType, country: string, grape: string): RebuildPageContainer {
  const wines = getWinesForGrape(type, country, grape);

  const wineNames = wines.map(w => w.name.length > 28 ? w.name.slice(0, 26) + ".." : w.name);
  const listItems = [...wineNames, BACK_LABEL];

  const wineList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 370, height: 255,
    containerID: 2, containerName: "wines",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 400, yPosition: 85, width: 100, height: 100,
    containerID: 3, containerName: "bottle",
  });

  const firstWine = wines[0];
  const infoText = new TextContainerProperty({
    xPosition: 400, yPosition: 185, width: 155, height: 90,
    containerID: 4, containerName: "info",
    content: firstWine ? `${TYPE_DISPLAY[type]} · ${grape}\n${country}\n${firstWine.style}` : "",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [wineList],
    textObject: [infoText],
    imageObject: [bottleSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// TASTING NOTES — 4 containers
//   1 = wine name header
//   2 = bottle sprite (100x100)
//   3 = grape · region · style subheader
//   4 = tasting notes text (scrollable)
// ══════════════════════════════════════════════════════════════════

export function buildTastingNotesPage(wine: Wine, _wineId: string): RebuildPageContainer {
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 130, width: 475, height: 30,
    containerID: 1, containerName: "wine-name",
    content: wine.name,
    isEventCapture: 0,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 0, yPosition: 20, width: 100, height: 100,
    containerID: 2, containerName: "bottle",
  });

  const subheader = new TextContainerProperty({
    xPosition: 100, yPosition: 20, width: 395, height: 110,
    containerID: 3, containerName: "sub",
    content: `${wine.grape}\n${wine.region}\n${wine.style}`,
    isEventCapture: 0,
  });

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
    xPosition: 20, yPosition: 160, width: 540, height: 120,
    containerID: 4, containerName: "notes",
    content: notesLines.join("\n"),
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, subheader, notes],
    imageObject: [bottleSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// FIND MY WINE — 5-step questionnaire pages
// Each step: 3 containers (list, logo-top 200x100, step text)
// Steps: Type → Vibe → Flavor → Body → Old/New World → Results
// ══════════════════════════════════════════════════════════════════

export function buildFinderTypePage(): RebuildPageContainer {
  const options = [
    "Red", "White", "Sparkling", "Rosé", "Orange", "Dessert", "Surprise Me", BACK_LABEL,
  ];

  const optList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 250,
    containerID: 2, containerName: "finder-type",
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const step = new TextContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "step",
    content: "Step 1/5\nWhat are you\nin the mood for?",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [optList],
    textObject: [step],
    imageObject: [logoTop],
  });
}

export function buildFinderVibePage(): RebuildPageContainer {
  const options = [
    "Fresh & Crisp", "Smooth & Easy", "Bold & Powerful",
    "Funky & Adventurous", "Elegant & Complex", "Cozy & Warm",
    "Skip", BACK_LABEL,
  ];

  const optList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 250,
    containerID: 2, containerName: "finder-vibe",
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const step = new TextContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "step",
    content: "Step 2/5\nWhat kind of vibe?",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [optList],
    textObject: [step],
    imageObject: [logoTop],
  });
}

export function buildFinderFlavorPage(type: WineType | null): RebuildPageContainer {
  const flavorOpts = getFlavorOptionsForType(type);
  const options = [...flavorOpts.map(f => f.label), "Skip", BACK_LABEL];

  const optList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 250,
    containerID: 2, containerName: "finder-flavor",
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const step = new TextContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "step",
    content: "Step 3/5\nWhat sounds good\nright now?",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [optList],
    textObject: [step],
    imageObject: [logoTop],
  });
}

export function buildFinderBodyPage(): RebuildPageContainer {
  const options = ["Light & Refreshing", "Medium & Balanced", "Full & Rich", "Skip", BACK_LABEL];

  const optList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 250,
    containerID: 2, containerName: "finder-body",
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const step = new TextContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "step",
    content: "Step 4/5\nHow should it feel?",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [optList],
    textObject: [step],
    imageObject: [logoTop],
  });
}

export function buildFinderWorldPage(): RebuildPageContainer {
  const options = ["Old World", "New World", "No Preference", BACK_LABEL];

  const optList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 250,
    containerID: 2, containerName: "finder-world",
    itemContainer: new ListItemContainerProperty({
      itemCount: options.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: options,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: 340, yPosition: 20, width: 200, height: 100,
    containerID: 3, containerName: "logo-top",
  });

  const step = new TextContainerProperty({
    xPosition: 340, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "step",
    content: "Step 5/5\nOld World or\nNew World?",
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [optList],
    textObject: [step],
    imageObject: [logoTop],
  });
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
    const name = r.wine.name.length > 24 ? r.wine.name.slice(0, 22) + ".." : r.wine.name;
    return name;
  });
  const listItems = [...wineNames, BACK_LABEL];

  const resultList = new ListContainerProperty({
    xPosition: 20, yPosition: 20, width: 320, height: 255,
    containerID: 2, containerName: "results",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const bottleSprite = new ImageContainerProperty({
    xPosition: 350, yPosition: 20, width: 100, height: 100,
    containerID: 3, containerName: "bottle",
  });

  const firstResult = top[0];
  const infoText = new TextContainerProperty({
    xPosition: 350, yPosition: 120, width: 200, height: 50,
    containerID: 4, containerName: "info",
    content: firstResult
      ? `${firstResult.wine.grape}\n${firstResult.country}`
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
