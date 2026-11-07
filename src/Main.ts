import {initSoundFeedback} from './sound-feedback';
import { initPhoneGestures } from './phone-gestures';
import { initPhoneShell } from './phone-shell';
import { initSetupGuide } from './setup-guide';
import { isGuestLibrary } from './cloud-library';
import { initHomeGlobe } from './home-globe';
import { connectLabelGlasses } from './research/label-glasses';
import { initGlassesContext } from './wine-context';
import { initInitiative } from './community/home';
import { initSharedCatalog } from './shared-catalog';
import { renderBetaCatalog } from './beta/catalog';
import {connectPairingGlasses} from './pairing-glasses';
import { connectAddWineGlasses, pauseAddWineGlasses, resumeAddWineGlasses } from './research/glasses-add';
import { initOfflineBottleImages } from './artwork-store';
import { initWineContributions } from './wine-contributions';
import { connectIntelligenceGlasses } from './intelligence/glasses';
import { initIntelligence } from './intelligence/home';
import { initWineNotes } from './wine-notes';
import { syncCatalogAnecdotes } from './catalog-anecdotes';
import { initResearchPanel } from './research/phone';
import { connectHistoryGlasses, setHistoryConnected, resumeHistoryGlasses } from './history/glasses';
import { initHistoryHome } from './history/home';
import { initHomeAtlas } from './home-atlas';
// ═══════════════════════════════════════════════════════════════════
// sommNI — Seven Second Sommelier
// Sprite-enhanced wine experience for Even Realities G2
// ═══════════════════════════════════════════════════════════════════

import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { initWinebrary } from './winebrary';
import { connectWinebraryGlasses, setWinebraryDeviceConnected } from './winebrary-glasses';
import { buildHomePage, rebuildHomePage } from './pages';
import { pushHomeToGlasses, suspendImages, resumeHomePour, registerHomeLayout } from './image-utils';
import { registerEventHandlers } from './events';
import { initSync, migrateLegacyWineIds, inEvenHubHost } from './sync';
import { useAccount, useStorage, eventCount } from './study/store';
import { connectStudyGlasses } from './study/glasses';
import { connectAtlasGlasses, pauseAtlasGlasses } from './atlas-app';
import { initAtlasCard } from './atlas-phone';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_WINES } from './constants';
import { initDashboard, refreshAll, setDeviceInfo, setVersionInfo, setGlassesStatus } from './dashboard';

import './app-shell.css';
import './beta/refresh.css';
import { initBetaRefresh } from './beta/refresh';
import './sommni-origin.css';
import './wine-context.css';
import './home-atlas.css';
import './phone-shell.css';
import './balanced-actions.css';
import './history/layout.css';

async function main(): Promise<void> {
  // Guest study log first; the Winebrary session (if any) switches it to the account.
  await useAccount(null);
  await runMigration();
  initDashboard();
  initPhoneGestures();
  initPhoneShell();
  initSoundFeedback();
  initGlassesContext();
  initWineNotes();
  void syncCatalogAnecdotes();
  initHomeAtlas();
  initHistoryHome();
  initResearchPanel();
  initAtlasCard();
  initHomeGlobe();
  initWinebrary();
  initSetupGuide(()=>!isGuestLibrary());
  initOfflineBottleImages();
  initWineContributions();
  initBetaRefresh();
  initInitiative();
  await initIntelligence();
  await refreshAll();
  window.addEventListener('sommni-catalog-updated',()=>{void refreshAll();void renderBetaCatalog();});
  void initSharedCatalog();

  if (!inEvenHubHost()) {
    setStatus("disconnected", "Browser mode");
    setGlassesStatus(false);
    setVersionInfo("3.7.53 · Beta");
  } else {
    setStatus("connecting", "Waiting for bridge...");
  }

  log("Initializing...");

  const bridge = await waitForEvenAppBridge();
  log("Bridge ready", "success");

  const user = await bridge.getUserInfo();
  log("User: " + user.name);

  const device = await bridge.getDeviceInfo();
  if (device) {
    log("Device: " + device.model + " (" + device.sn + ")");
    setDeviceInfo(device.model, device.sn);
    if (device.status?.isConnected()) {
      setStatus("connected");
      setWinebraryDeviceConnected(true);
      setHistoryConnected(true);
      setBattery(device.status.batteryLevel);
      setGlassesStatus(true, device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
    setGlassesStatus(false);
  }

  const unsubscribeDevice = bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      suspendImages(false);void resumeHomePour();void resumeAddWineGlasses().catch(console.warn);
      setStatus("connected");
      setWinebraryDeviceConnected(true);
      setHistoryConnected(true);void resumeHistoryGlasses().catch(console.warn);
      setBattery(status.batteryLevel);
      setGlassesStatus(true, status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      suspendImages(true);
      void pauseAtlasGlasses().catch(error=>console.warn('[Atlas] disconnect cleanup',error));
      void pauseAddWineGlasses().catch(console.warn);
      setStatus("disconnected");
      setWinebraryDeviceConnected(false);
      setHistoryConnected(false);
      setGlassesStatus(false);
      log("Disconnected", "error");
    } else if (status.connectType === DeviceConnectType.Connecting) {
      setStatus("connecting");
    }
  });

  // Create startup page
  const homePage = buildHomePage();
  const result = await bridge.createStartUpPageContainer(homePage);
  if (result !== 0) {
    // The glasses keep the startup page when only the web view reloads (Even Hub web view
    // restart, dev hot reload). Take over the existing page instead of stopping.
    log("Startup page exists (" + result + "); rebuilding home");
    if (!await bridge.rebuildPageContainer(rebuildHomePage())) {
      log("Startup failed: " + result, "error");
      return;
    }
  }
  registerHomeLayout();
  log("Home page created", "success");

  // Use full GitHub Pages URL for remote assets (ehpk doesn't bundle bottles)
  const baseUrl = new URL('./', location.href).href;
  connectWinebraryGlasses(bridge, baseUrl);
  connectAddWineGlasses(bridge);
  connectLabelGlasses(bridge);
  connectPairingGlasses(bridge);
  connectStudyGlasses(bridge, baseUrl);
  connectIntelligenceGlasses(bridge, baseUrl);
  connectAtlasGlasses(bridge, baseUrl);
  // Inside Even Hub, companion data and study progress live in the host's storage.
  log(`Storage: ${inEvenHubHost() ? 'Even Hub' : 'browser'} · ${eventCount()} study reviews on this device`);
  if (inEvenHubHost()) {
    await useStorage(initSync(bridge));
    log(`Study log reloaded from Even Hub storage: ${eventCount()} reviews`);
    await runMigration();
    await refreshAll();
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('g2-fixture') === 'library') {
    (await import('./dev-fixture')).installLibraryFixture(baseUrl);
  }
  // Initialize sync bridge (shared localStorage with phone dashboard)
  initSync(bridge);
  log("Sync bridge ready", "success");

  // Register event handlers
  registerEventHandlers(bridge, baseUrl, () => { setHistoryConnected(false); unsubscribeDevice(); });
  connectHistoryGlasses(bridge);
  log("Events active", "success");

  await bridge.setLocalStorage("sommni_version", "3.7.53");
  setVersionInfo("3.7.53 · Beta");
  log(`sommNI v3.7.53 Beta — ${TOTAL_WINES} wines · courses · quiz · pairings · 86 list`, "success");

  // Refresh all dashboard tabs with data from bridge
  await refreshAll();
  log("Dashboard loaded", "success");
  try {
    await new Promise(r => setTimeout(r, 500));
    await pushHomeToGlasses(bridge);
    log("Logo pushed", "success");
  } catch (err) {
    log("Logo not loaded: " + err, "error");
  }


}

/** One-time conversion of stored positional wine IDs (w0…) to canonical IDs. */
async function runMigration(): Promise<void> {
  try {
    const report = await migrateLegacyWineIds();
    if (report.unresolved.length) log(`ID migration kept ${report.unresolved.length} unknown IDs unchanged: ${report.unresolved.join(', ')}`, "error");
  } catch (err) {
    log("ID migration did not complete; legacy data is unchanged: " + err, "error");
  }
}

main().catch((err) => {
  log("Fatal: " + err, "error");
  console.error(err);
});
