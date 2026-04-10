// ═══════════════════════════════════════════════════════════════════
// sommNI — Seven Second Sommelier
// Sprite-enhanced wine experience for Even Realities G2
// ═══════════════════════════════════════════════════════════════════

import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { buildHomePage } from './pages';
import { pushLogoToGlasses } from './image-utils';
import { registerEventHandlers } from './events';
import { initSync } from './sync';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_WINES } from './constants';
import { initDashboard, refreshAll, setDeviceInfo, setVersionInfo, setGlassesStatus } from './dashboard';

async function main(): Promise<void> {
  // Initialize dashboard tab switching immediately
  initDashboard();

  log("Initializing...");
  setStatus("connecting", "Waiting for bridge...");

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
      setBattery(device.status.batteryLevel);
      setGlassesStatus(true, device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
    setGlassesStatus(false);
  }

  bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      setStatus("connected");
      setBattery(status.batteryLevel);
      setGlassesStatus(true, status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      setStatus("disconnected");
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
    log("Startup failed: " + result, "error");
    return;
  }
  log("Home page created", "success");

  // Push logo with slight delay for SDK readiness
  const baseUrl = import.meta.env.BASE_URL;
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
  registerEventHandlers(bridge, baseUrl);
  log("Events active", "success");

  await bridge.setLocalStorage("sommni_version", "2.0.0");
  setVersionInfo("2.0.0");
  log(`sommNI v2.0.0 — ${TOTAL_WINES} wines · courses · quiz · pairings · 86 list`, "success");

  // Refresh all dashboard tabs with data from bridge
  await refreshAll();
  log("Dashboard loaded", "success");
}

main().catch((err) => {
  log("Fatal: " + err, "error");
  console.error(err);
});
