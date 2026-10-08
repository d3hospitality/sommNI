// ═══════════════════════════════════════════════════════════════════
// sommNI — Seven Second Sommelier
// Sprite-enhanced wine experience for Even Realities G2
// ═══════════════════════════════════════════════════════════════════

import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { initWinebrary } from './winebrary';
import { connectWinebraryGlasses, setWinebraryDeviceConnected } from './winebrary-glasses';
import { buildHomePage, rebuildHomePage } from './pages';
import { pushLogoToGlasses } from './image-utils';
import { registerEventHandlers } from './events';
import { initSync, migrateLegacyWineIds, inEvenHubHost } from './sync';
import { loadCatalogView } from './catalog-view';
import { useAccount, useStorage, eventCount } from './study/store';
import { connectStudyGlasses } from './study/glasses';
import { connectAtlasGlasses } from './atlas-app';
import { initAtlasCard } from './atlas-phone';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_WINES } from './constants';
import { initDashboard, refreshAll, setDeviceInfo, setVersionInfo, setGlassesStatus } from './dashboard';

async function main(): Promise<void> {
  const hostBridge = inEvenHubHost() ? await waitForEvenAppBridge() : null;
  if (hostBridge) await useStorage(initSync(hostBridge));
  // Guest study log first; the Winebrary session (if any) switches it to the account.
  await useAccount(null);
  await runMigration();
  await loadCatalogView();
  initDashboard();
  initAtlasCard();
  initWinebrary();
  await refreshAll();

  log("Initializing...");
  setStatus("connecting", "Waiting for bridge...");

  const bridge = hostBridge || await waitForEvenAppBridge();
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
      setBattery(device.status.batteryLevel);
      setGlassesStatus(true, device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
    setGlassesStatus(false);
  }

  const unsubscribeDevice = bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      setStatus("connected");
      setWinebraryDeviceConnected(true);
      setBattery(status.batteryLevel);
      setGlassesStatus(true, status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      setStatus("disconnected");
      setWinebraryDeviceConnected(false);
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
  log("Home page created", "success");

  // Use full GitHub Pages URL for remote assets (ehpk doesn't bundle bottles)
  const baseUrl = new URL('./', location.href).href;
  connectWinebraryGlasses(bridge, baseUrl);
  connectStudyGlasses(bridge, baseUrl);
  connectAtlasGlasses(bridge, baseUrl);
  // Inside Even Hub, companion data and study progress live in the host's storage.
  log(`Storage: ${inEvenHubHost() ? 'Even Hub' : 'browser'} · ${eventCount()} study reviews on this device`);
  if (inEvenHubHost()) {
    await useStorage(initSync(bridge));
    log(`Study log reloaded from Even Hub storage: ${eventCount()} reviews`);
    await runMigration();
    await loadCatalogView();
    await refreshAll();
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('g2-fixture') === 'library') {
    (await import('./dev-fixture')).installLibraryFixture(baseUrl);
  }
  try {
    await new Promise(r => setTimeout(r, 500));
    await pushLogoToGlasses(bridge, baseUrl);
    log("Logo pushed", "success");
  } catch (err) {
    log("Logo not loaded: " + err, "error");
  }

  // Initialize sync bridge (shared localStorage with phone dashboard)
  initSync(bridge);
  log("Sync bridge ready", "success");

  // Register event handlers
  registerEventHandlers(bridge, baseUrl, unsubscribeDevice);
  log("Events active", "success");

  await bridge.setLocalStorage("sommni_version", "2.0.0");
  setVersionInfo("3.0.0 · wineLENS");
  log(`wineLENS v3.0.0 — ${TOTAL_WINES} wines · courses · quiz · pairings · 86 list`, "success");

  // Refresh all dashboard tabs with data from bridge
  await refreshAll();
  log("Dashboard loaded", "success");
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
