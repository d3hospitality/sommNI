import {
  CreateStartUpPageContainer, RebuildPageContainer,
  ListContainerProperty, TextContainerProperty,
  ImageContainerProperty, ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, TYPE_DISPLAY, COUNTRIES,
  getStylesForCountry, getWinesForStyle,
  WineType, Wine,
} from './constants';

// Back button
const BACK_LABEL = "‹ Back";

// ══════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ══════════════════════════════════════════════════════════════════════════
export function buildHomePage(): CreateStartUpPageContainer {
  const title = new TextContainerProperty({
    xPosition: 20, yPosition: 10, width: 300, height: 35,
    containerID: 1, containerName: "title",
    content: "ソムニ sommNI", isEventCapture: 0,
  });
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 50, width: 300, height: 28,
    containerID: 2, containerName: "header",
    content: "Wines", isEventCapture: 0,
  });
  
  const typeNames = WINE_TYPES.map(t => TYPE_DISPLAY[t]);
  
  const typeList = new ListContainerProperty({
    xPosition: 17, yPosition: 82, width: 330, height: 175,
    containerID: 3, containerName: "wine-types",
    itemContainer: new ListItemContainerProperty({
      itemCount: typeNames.length, 
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...typeNames],
    }),
    isEventCapture: 1,
  });
  
  const logo = new ImageContainerProperty({
    xPosition: 370, yPosition: 30, width: 80, height: 80,
    containerID: 4, containerName: "logo",
  });
  
  return new CreateStartUpPageContainer({
    containerTotalNum: 4, 
    listObject: [typeList], 
    textObject: [title, header], 
    imageObject: [logo],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const title = new TextContainerProperty({
    xPosition: 20, yPosition: 10, width: 300, height: 35,
    containerID: 1, containerName: "title",
    content: "ソムニ sommNI", isEventCapture: 0,
  });
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 50, width: 300, height: 28,
    containerID: 2, containerName: "header",
    content: "Wines", isEventCapture: 0,
  });
  
  const typeNames = WINE_TYPES.map(t => TYPE_DISPLAY[t]);
  
  const typeList = new ListContainerProperty({
    xPosition: 17, yPosition: 82, width: 330, height: 175,
    containerID: 3, containerName: "wine-types",
    itemContainer: new ListItemContainerProperty({
      itemCount: typeNames.length, 
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...typeNames],
    }),
    isEventCapture: 1,
  });
  
  const logo = new ImageContainerProperty({
    xPosition: 370, yPosition: 30, width: 80, height: 80,
    containerID: 4, containerName: "logo",
  });
  
  return new RebuildPageContainer({
    containerTotalNum: 4, 
    listObject: [typeList], 
    textObject: [title, header], 
    imageObject: [logo],
  });
}

// ══════════════════════════════════════════════════════════════════════════
// COUNTRY LIST PAGE
// ══════════════════════════════════════════════════════════════════════════
export function buildCountryListPage(type: WineType): RebuildPageContainer {
  const countries = COUNTRIES[type];
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 12, width: 536, height: 28,
    containerID: 1, containerName: "header",
    content: TYPE_DISPLAY[type], isEventCapture: 0,
  });
  
  const listItems = [...countries, BACK_LABEL];
  
  const countryList = new ListContainerProperty({
    xPosition: 17, yPosition: 45, width: 542, height: 230,
    containerID: 2, containerName: "countries",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, 
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...listItems],
    }),
    isEventCapture: 1,
  });
  
  return new RebuildPageContainer({
    containerTotalNum: 2, 
    listObject: [countryList], 
    textObject: [header], 
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════════════
// STYLE LIST PAGE
// ══════════════════════════════════════════════════════════════════════════
export function buildStyleListPage(type: WineType, country: string): RebuildPageContainer {
  const styles = getStylesForCountry(type, country);
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 12, width: 536, height: 28,
    containerID: 1, containerName: "header",
    content: TYPE_DISPLAY[type] + " · " + country, isEventCapture: 0,
  });
  
  const listItems = [...styles, BACK_LABEL];
  
  const styleList = new ListContainerProperty({
    xPosition: 17, yPosition: 45, width: 542, height: 230,
    containerID: 2, containerName: "styles",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, 
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...listItems],
    }),
    isEventCapture: 1,
  });
  
  return new RebuildPageContainer({
    containerTotalNum: 2, 
    listObject: [styleList], 
    textObject: [header], 
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════════════
// WINE LIST PAGE
// ══════════════════════════════════════════════════════════════════════════
export function buildWineListPage(type: WineType, country: string, style: string): RebuildPageContainer {
  const wines = getWinesForStyle(type, country, style);
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 12, width: 536, height: 28,
    containerID: 1, containerName: "header",
    content: TYPE_DISPLAY[type] + " · " + country + " · " + style, 
    isEventCapture: 0,
  });
  
  const wineNames = wines.map(w => w.name);
  const listItems = [...wineNames, BACK_LABEL];
  
  const wineList = new ListContainerProperty({
    xPosition: 17, yPosition: 45, width: 542, height: 230,
    containerID: 2, containerName: "wines",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length, 
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });
  
  return new RebuildPageContainer({
    containerTotalNum: 2, 
    listObject: [wineList], 
    textObject: [header], 
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════════════
// TASTING NOTES PAGE
// ══════════════════════════════════════════════════════════════════════════
export function buildTastingNotesPage(wine: Wine): RebuildPageContainer {
  const notesLines: string[] = [];
  
  notesLines.push("• Appearance");
  notesLines.push(wine.appearance);
  notesLines.push("");
  notesLines.push("• Nose");
  notesLines.push(wine.nose);
  notesLines.push("");
  notesLines.push("• Palate");
  notesLines.push(wine.palate);
  notesLines.push("");
  notesLines.push("• Finish");
  notesLines.push(wine.finish);
  
  if (wine.anecdote) {
    notesLines.push("");
    notesLines.push("• Anecdote");
    notesLines.push(wine.anecdote);
  }
  
  const header = new TextContainerProperty({
    xPosition: 20, yPosition: 5, width: 536, height: 28,
    containerID: 1, containerName: "wine-header",
    content: wine.name,
    isEventCapture: 0,
  });
  
  const subheader = new TextContainerProperty({
    xPosition: 20, yPosition: 33, width: 536, height: 22,
    containerID: 2, containerName: "wine-sub",
    content: wine.grape + " · " + wine.region,
    isEventCapture: 0,
  });
  
  const notes = new TextContainerProperty({
    xPosition: 20, yPosition: 68, width: 536, height: 195,
    containerID: 3, containerName: "notes",
    content: notesLines.join("\n"),
    isEventCapture: 1,
  });
  
  return new RebuildPageContainer({
    containerTotalNum: 3, 
    listObject: [], 
    textObject: [header, subheader, notes], 
    imageObject: [],
  });
}