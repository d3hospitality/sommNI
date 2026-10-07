// Hardware constraints the simulator does not enforce, plus catalog/exit regressions.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = (process.env.WL_BASE_URL || 'http://localhost:5186').replace(/\/$/, '');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(BASE + '/sommNI/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Catalog regression</title>' }));
    await page.goto(BASE + '/sommNI/');
    const result = await page.evaluate(async () => {
      const P = await import('/sommNI/src/pages.ts');
      const I = await import('/sommNI/src/identity.ts');
      const A = await import('/sommNI/src/atlas-app.ts');
      const E = await import('/sommNI/src/events.ts');
      const G = await import('/sommNI/src/winebrary-glasses.ts');
      const V = await import('/sommNI/src/glasses-page.ts');
      const B = await import('/sommNI/src/bottle-assets.ts');
      const R = await import('/sommNI/src/bottle-raster.ts');
      const PNG = await import('/sommNI/src/pngEncoder.ts');
      const D = await import('/sommNI/src/display.ts');
      const checks = [];
      const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
      const violations = [];
      for (const item of I.allCatalogWines()) {
        const pg = P.buildTastingNotesPage(item.wine, item.id);
        V.validateGlassesPage(pg);
        for (const img of pg.imageObject) {
          if (img.width < 20 || img.width > 288 || img.height < 20 || img.height > 144) violations.push(`${item.id}/${img.containerName}: ${img.width}x${img.height}`);
        }
      }
      // The simulator accepts some invalid payloads: our preflight must not.
      const invalid = P.buildTastingNotesPage(I.allCatalogWines()[0].wine, I.allCatalogWines()[0].id);
      invalid.imageObject[0].height = 10;
      let refused = false; try { V.validateGlassesPage(invalid); } catch { refused = true; }
      check(refused, 'preflight rejects undersized images');
      let handler, unsubscribed = 0, cleaned = 0, inFlight = 0, peak = 0, rejectNotes = false;
      const shown = [], images = [], exitModes = [], sentText = [];
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const operation = async task => {
        peak = Math.max(peak, ++inFlight);
        try { await wait(30); return task(); } finally { inFlight--; }
      };
      const bridge = {
        onEvenHubEvent: cb => { handler = cb; return () => { unsubscribed++; }; },
        rebuildPageContainer: pg => operation(() => {
          V.validateGlassesPage(pg);
          if (rejectNotes && pg.textObject.some(t => t.containerName === 'notes')) { rejectNotes = false; return false; }
          shown.push(pg); return true;
        }),
        updateImageRawData: img => operation(() => { images.push(img); return 'success'; }),
        textContainerUpgrade: t => operation(() => { sentText.push(t); return true; }),
        shutDownPageContainer: mode => operation(() => { exitModes.push(mode); return true; }),
        getLocalStorage: async () => '', setLocalStorage: async () => true,
      };
      const base = location.origin + '/sommNI/';
      G.connectWinebraryGlasses(bridge, base);
      G.setLibrarySource(() => ({ userId: null, loading: false, error: '', items: [] }));
      A.connectAtlasGlasses(bridge, base);
      E.registerEventHandlers(bridge, base, () => { cleaned++; });
      const input = async event => { handler(event); await wait(750); };
      const tap = () => input({ sysEvent: { eventSource: 1 } }); // firmware omits CLICK=0
      const back = () => input({ sysEvent: { eventType: 3 } });
      const down = { textEvent: { containerID: 2, containerName: 'atlas-rows', eventType: 2 } };
      const last = () => shown.at(-1);
      const scope = A.catalogAtlas(await A.loadAtlasRenderer());
      await A.openAtlasOnGlasses('FRA'); await wait(850);
      await tap();
      const region = scope.data.regions.find(r => r.name === A.atlasStatus().region && r.country === 'FRA');
      const entries = scope.entries.get(region.id);
      await tap();
      check(A.atlasStatus().mode === 'detail', 'country → region → catalog');
      for (let i = 0; i < 3; i++) handler(down);
      await wait(1300);
      const chosen = entries[3].item;
      const source = B.bottleImageUrl(base, I.assetIdFor(chosen.id));
      const canvas = await R.stageCanvas(source, 244, 244);
      const expected = R.toGreenLevels(canvas.getContext('2d').getImageData(0, 0, 244, 244).data, 244);
      const top = images.filter(i => i.containerName === 'atlas-top').at(-1);
      check(JSON.stringify(top.imageData) === JSON.stringify(Array.from(PNG.encodeGrayscalePng(244, 122, expected.subarray(0, 244 * 122)))), 'rapid scroll sends the selected bottle, not the map or a stale wine');
      // A failed page is restored to the same cursor, then a retry succeeds.
      rejectNotes = true;
      await tap(); await wait(750);
      check(A.atlasStatus().active && last().textObject.some(t => t.containerName === 'atlas-rows'), 'refused notes restore the wine list');
      handler({ sysEvent: { eventSource: 1 } });
      handler({ sysEvent: { eventSource: 1 } }); // second tap while transport is closing
      await wait(1000);
      check(last().textObject.some(t => t.containerName === 'wine-name' && chosen.wine.name.startsWith(t.content)), 'tap opens the selected tasting notes');
      check(exitModes.length === 0, 'wine selection never calls shutdown');
      await back();
      check(A.atlasStatus().mode === 'detail' && sentText.filter(t => t.containerName === 'atlas-hint').at(-1).content.startsWith('4 /'), 'Back preserves the selected wine');
      // Background stops input without treating lifecycle events as a selection.
      const count = shown.length;
      await input({ sysEvent: { eventType: 5 } }); await tap();
      check(shown.length === count, 'background input does not open a wine');
      await input({ sysEvent: { eventType: 4 } });
      check(A.atlasStatus().active && A.atlasStatus().mode === 'detail', 'resume restores Atlas selection');
      await back(); await back(); await back();
      check(last().listObject?.[0].containerName === 'home-list', 'Back returns to Home');
      await back();
      check(exitModes.length === 1 && exitModes[0] === 1 && unsubscribed === 0 && cleaned === 0, 'Home requests confirmed exit without premature cleanup');
      // Cancel has no terminal event. The next action still opens a page normally.
      await input({ listEvent: { containerID: 2, containerName: 'home-list', currentSelectItemIndex: P.ATLAS_INDEX } });
      check(A.atlasStatus().active, 'cancelled exit leaves input working');
      await back(); // currently at countries
      await back(); // exit dialog again
      check(exitModes.every(mode => mode === 1), 'no immediate exits');
      const countBeforeExit = shown.length;
      await input({ sysEvent: { eventType: 7 } });
      await input({ sysEvent: { eventType: 6 } });
      await tap();
      check(unsubscribed === 1 && cleaned === 1 && shown.length === countBeforeExit, 'confirmed/abnormal exit cleans up once and ignores later input');
      check(D.displayOwner() === 'catalog', 'exit releases display ownership');
      check(peak === 1, 'map, bottle, notes, Back and exit never overlap bridge sends');
      return { violations, wines: I.allCatalogWines().length, checks };
    });
    assert.deepEqual(result.violations, [], 'Every tasting-notes image must meet the real G2 minimum AND maximum dimensions');
    assert.deepEqual(errors, []);
    console.log('CATALOG LIFECYCLE PASS', result.wines, 'wine layouts', result.checks);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
