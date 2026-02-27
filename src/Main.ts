import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { buildHomePage } from './pages';
import { pushLogoToGlasses } from './image-utils';
import { registerEventHandlers } from './events';
import { setStatus, setBattery, log } from './ui';

async function main(): Promise<void> {
  log("Initializing...");
  setStatus("connecting", "Waiting for bridge...");

  const bridge = await waitForEvenAppBridge();
  log("Bridge ready", "success");

  const user = await bridge.getUserInfo();
  log("User: " + user.name);

  const device = await bridge.getDeviceInfo();
  if (device) {
    log("Device: " + device.model + " (" + device.sn + ")");
    if (device.status?.isConnected()) {
      setStatus("connected");
      setBattery(device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
  }

  bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      setStatus("connected");
      setBattery(status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      setStatus("disconnected");
      log("Disconnected", "error");
    } else if (status.connectType === DeviceConnectType.Connecting) {
      setStatus("connecting");
    }
  });

  const homePage = buildHomePage();
  const result = await bridge.createStartUpPageContainer(homePage);
  if (result !== 0) {
    log("Startup failed: " + result, "error");
    return;
  }
  log("Home page created", "success");

  const logoUrl = import.meta.env.BASE_URL;
  try {
    await new Promise(r => setTimeout(r, 500));
    await pushLogoToGlasses(bridge, logoUrl);
    log("Logo pushed (raw RGBA)", "success");
  } catch (err) {
    log("Logo not loaded: " + err, "error");
  }

  registerEventHandlers(bridge, logoUrl);
  log("Events active", "success");

  await bridge.setLocalStorage("sommni_version", "0.1.0");
  log("sommNI v0.1.0 — 215 wines + anecdotes loaded", "success");
}

main().catch((err) => {
  log("Fatal: " + err, "error");
  console.error(err);
});
