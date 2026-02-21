import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  WINE_TYPES, COUNTRIES, WineType,
  getStylesForCountry, getWinesForStyle,
} from './constants';
import {
  rebuildHomePage, buildCountryListPage, buildStyleListPage,
  buildWineListPage, buildTastingNotesPage,
} from './pages';
import { pushLogoToGlasses } from './image-utils';
import { log } from './ui';
import { initVoice, startListening, handleAudioEvent, WineWithNav } from './voice';

// ══════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || "";

// ══════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════
type Page = "home" | "countries" | "styles" | "wines" | "notes";

let currentPage: Page = "home";
let currentType: WineType | null = null;
let currentCountry: string | null = null;
let currentStyle: string | null = null;

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAVIGATION_DEBOUNCE_MS = 500;

let bridgeRef: EvenAppBridge | null = null;
let logoBase64Ref: string = "";

export function registerEventHandlers(bridge: EvenAppBridge, logoBase64: string): () => void {
  bridgeRef = bridge;
  logoBase64Ref = logoBase64;
  
  if (OPENAI_API_KEY) {
    initVoice(bridge, OPENAI_API_KEY, handleVoiceWineMatch);
  }
  
  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, logoBase64);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLE VOICE WINE MATCH
// ══════════════════════════════════════════════════════════════════════════
async function handleVoiceWineMatch(wine: WineWithNav): Promise<void> {
  if (!bridgeRef) return;
  
  log(`[NAV] Voice → ${wine.name}`, "success");
  
  await bridgeRef.rebuildPageContainer(buildTastingNotesPage(wine));
  
  currentPage = "notes";
  currentType = wine.type;
  currentCountry = wine.country;
  currentStyle = wine.style;
  lastNavigationTime = Date.now();
}

// ══════════════════════════════════════════════════════════════════════════
// GO BACK
// ══════════════════════════════════════════════════════════════════════════
async function goBack(bridge: EvenAppBridge, logoBase64: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  
  try {
    log(`[BACK] from ${currentPage}`);
    
    if (currentPage === "notes" && currentType && currentCountry && currentStyle) {
      await bridge.rebuildPageContainer(buildWineListPage(currentType, currentCountry, currentStyle));
      currentPage = "wines";
      lastNavigationTime = Date.now();
      log("‹ Back to wines", "success"); 
    }
    else if (currentPage === "wines" && currentType && currentCountry) {
      await bridge.rebuildPageContainer(buildStyleListPage(currentType, currentCountry));
      currentPage = "styles"; 
      currentStyle = null;
      lastNavigationTime = Date.now();
      log("‹ Back to styles", "success"); 
    }
    else if (currentPage === "styles" && currentType) {
      await bridge.rebuildPageContainer(buildCountryListPage(currentType));
      currentPage = "countries"; 
      currentCountry = null; 
      currentStyle = null;
      lastNavigationTime = Date.now();
      log("‹ Back to countries", "success"); 
    }
    else if (currentPage === "countries") {
      await bridge.rebuildPageContainer(rebuildHomePage());
      currentPage = "home"; 
      currentType = null; 
      currentCountry = null; 
      currentStyle = null;
      lastNavigationTime = Date.now();
      if (logoBase64) await pushLogoToGlasses(bridge, logoBase64);
      log("‹ Back to Home", "success");
    }
  } catch (err) {
    log(`[BACK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLE CLICK
// ══════════════════════════════════════════════════════════════════════════
async function handleClick(bridge: EvenAppBridge, idx: number, logoBase64: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  
  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);
    
    if (currentPage === "home") {
      if (idx >= 0 && idx < WINE_TYPES.length) {
        currentType = WINE_TYPES[idx];
        await bridge.rebuildPageContainer(buildCountryListPage(currentType));
        currentPage = "countries";
        lastNavigationTime = Date.now();
        log("→ " + currentType, "success"); 
      }
      return;
    }
    
    if (currentPage === "countries" && currentType) {
      const countries = COUNTRIES[currentType];
      if (idx === countries.length) {
        navigating = false;
        await goBack(bridge, logoBase64);
        return;
      }
      if (idx >= 0 && idx < countries.length) {
        currentCountry = countries[idx];
        await bridge.rebuildPageContainer(buildStyleListPage(currentType, currentCountry));
        currentPage = "styles";
        lastNavigationTime = Date.now();
        log("→ " + currentCountry, "success"); 
      }
      return;
    }
    
    if (currentPage === "styles" && currentType && currentCountry) {
      const styles = getStylesForCountry(currentType, currentCountry);
      if (idx === styles.length) {
        navigating = false;
        await goBack(bridge, logoBase64);
        return;
      }
      if (idx >= 0 && idx < styles.length) {
        currentStyle = styles[idx];
        await bridge.rebuildPageContainer(buildWineListPage(currentType, currentCountry, currentStyle));
        currentPage = "wines";
        lastNavigationTime = Date.now();
        log("→ " + currentStyle, "success"); 
      }
      return;
    }
    
    if (currentPage === "wines" && currentType && currentCountry && currentStyle) {
      const wines = getWinesForStyle(currentType, currentCountry, currentStyle);
      if (idx === wines.length) {
        navigating = false;
        await goBack(bridge, logoBase64);
        return;
      }
      if (idx >= 0 && idx < wines.length) {
        const wine = wines[idx];
        await bridge.rebuildPageContainer(buildTastingNotesPage(wine));
        currentPage = "notes";
        lastNavigationTime = Date.now();
        log("→ " + wine.name, "success"); 
      }
      return;
    }
  } catch (err) {
    log(`[CLICK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLE DOUBLE-CLICK
// ══════════════════════════════════════════════════════════════════════════
async function handleDoubleClick(bridge: EvenAppBridge, logoBase64: string): Promise<void> {
  log(`[DOUBLE-CLICK] page=${currentPage}`);
  
  if (currentPage === "notes") {
    await goBack(bridge, logoBase64);
  } else {
    startListening();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN EVENT HANDLER
// ══════════════════════════════════════════════════════════════════════════
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, logoBase64: string): Promise<void> {
  
  if (event.audioEvent) {
    handleAudioEvent(event.audioEvent.audioPcm);
  }
  
  if (event.listEvent) {
    const le = event.listEvent;
    const idx = le.currentSelectItemIndex;
    
    if (idx != null) {
      lastSelectedIndex = idx;
    } else {
      lastSelectedIndex = 0;
    }
    
    const type = le.eventType;
    if (type === OsEventTypeList.SCROLL_TOP_EVENT ||
        type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      return;
    }
    
    const timeSinceNav = Date.now() - lastNavigationTime;
    if (timeSinceNav < NAVIGATION_DEBOUNCE_MS) {
      return;
    }
    
    await handleClick(bridge, lastSelectedIndex, logoBase64);
    return;
  }

  if (event.sysEvent) {
    const type = event.sysEvent.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT || type === 3) {
      await handleDoubleClick(bridge, logoBase64);
    }
  }
}