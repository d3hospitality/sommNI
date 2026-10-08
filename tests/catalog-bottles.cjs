const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
// Validate the installed photographic catalog through the actual browser/G2 rasterizer.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serveG2Bottles } = require('./g2-backend.cjs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  try {
    const page = await browser.newPage();
    const backend = await serveG2Bottles(page);
    await page.goto((BASE + '/sommNI/'));
    const result = await page.evaluate(async () => {
      const { bottleCanvas, toGreenLevels } = await import('/sommNI/src/bottle-raster.ts');
      const manifest = await (await fetch('/sommNI/bottles/manifest.json')).json();
      const failures = [], previews = [];
      for (const asset of manifest.assets) {
        try {
          const canvas = await bottleCanvas(`/sommNI/bottles/${asset.file}`, 100, 240);
          const ctx = canvas.getContext('2d');
          const gray = toGreenLevels(ctx.getImageData(0, 0, 100, 240).data);
          let pixels = 0, minY = 240, maxY = -1;
          for (let y = 0; y < 240; y++) for (let x = 0; x < 100; x++) {
            const value = gray[y * 100 + x];
            if (value % 17) throw Error('Not 16-level grayscale');
            if (value) {
              pixels++; minY = Math.min(y, minY); maxY = Math.max(y, maxY);
              if (x < 3 || x > 96 || y < 3 || y > 236) throw Error('Clipped display margin');
            }
          }
          if (pixels < 100 || maxY - minY < 175) throw Error('Bottle too small or blank');
          const preview = ctx.createImageData(100, 240);
          for (let i = 0; i < gray.length; i++) {
            preview.data[i * 4 + 1] = gray[i]; preview.data[i * 4 + 3] = 255;
          }
          ctx.putImageData(preview, 0, 0);
          previews.push({ id: asset.id, png: canvas.toDataURL('image/png').split(',')[1], pixels });
        } catch (error) { failures.push({ id: asset.id, error: String(error) }); }
      }
      return { count: manifest.assets.length, pending: manifest.issues.length, failures, previews };
    });
    assert.equal(result.count + result.pending, 215);
    assert.deepEqual(result.failures, []);
    if (process.env.BOTTLE_PREVIEW_DIR) {
      fs.mkdirSync(process.env.BOTTLE_PREVIEW_DIR, { recursive: true });
      for (const row of result.previews) fs.writeFileSync(path.join(process.env.BOTTLE_PREVIEW_DIR, row.id + '.png'), Buffer.from(row.png, 'base64'));
    }
    // The glasses pull every catalog bottle from the backend: same rasterizer, same checks, and the
    // lit subject must match the bundled photograph (the backend copy is a smaller greyscale cut-out).
    const g2 = await page.evaluate(async () => {
      const { bottleCanvas, toGreenLevels } = await import('/sommNI/src/bottle-raster.ts');
      const { catalogBottleSources, isBackendBottle, BOTTLES_HELD_FOR_REVIEW } = await import('/sommNI/src/bottle-assets.ts');
      const held = [...BOTTLES_HELD_FOR_REVIEW];
      const { allCatalogWines } = await import('/sommNI/src/identity.ts');
      const lit = async source => {
        const canvas = await bottleCanvas(source, 100, 240);
        const gray = toGreenLevels(canvas.getContext('2d').getImageData(0, 0, 100, 240).data, 100);
        let pixels = 0, minY = 240, maxY = -1;
        for (let y = 0; y < 240; y++) for (let x = 0; x < 100; x++) {
          const v = gray[y * 100 + x]; if (v % 17) throw Error('Not 16-level grayscale');
          if (v) { pixels++; minY = Math.min(y, minY); maxY = Math.max(y, maxY); if (x < 3 || x > 96 || y < 3 || y > 236) throw Error('Clipped display margin'); }
        }
        if (pixels < 100 || maxY - minY < 175) throw Error('Bottle too small or blank');
        return pixels;
      };
      const failures = [], drift = [];
      let checked = 0;
      for (const wine of allCatalogWines()) {
        const sources = catalogBottleSources('/sommNI/', wine.id);
        if (!sources.length) continue;
        try {
          if (!isBackendBottle(sources[0])) throw Error('backend not first');
          const remote = await lit([sources[0]]), local = await lit(sources[1]);
          if (Math.abs(remote - local) / local > 0.08) drift.push({ id: wine.id, remote, local });
          checked++;
        } catch (error) { failures.push({ id: wine.id, error: String(error) }); }
      }
      return { checked, failures, drift, held };
    });
    assert.deepEqual(g2.failures, []); assert.deepEqual(g2.drift, [], 'backend bottles light the same pixels as the photographs (±8%)');
    assert.equal(g2.checked, result.count, 'every reviewed photograph has its backend bottle');
    assert.deepEqual(g2.held.sort(), JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/bottles/manifest.json'), 'utf8')).issues.map(i => i.id).sort(), 'held-back bottles match the manifest issues');
    assert.ok(backend.filter(n => n.endsWith('.png')).length >= g2.checked, 'served by the backend route');
    // Backend down: the bundled photograph still draws, and the backend is skipped (not retried) for a minute.
    const down = await browser.newPage();
    const tried = await serveG2Bottles(down, { down: true });
    await down.goto((BASE + '/sommNI/'));
    const fallback = await down.evaluate(async () => {
      const { bottleCanvas } = await import('/sommNI/src/bottle-raster.ts');
      const { catalogBottleSources } = await import('/sommNI/src/bottle-assets.ts');
      const first = catalogBottleSources('/sommNI/', 'wl_grand-malbec-terrazas-de-los-andes');
      await bottleCanvas(first, 100, 240);
      return { first: first.length, after: catalogBottleSources('/sommNI/', 'wl_cabernet-sauvignon-vasse-felix').length };
    });
    assert.deepEqual(fallback, { first: 2, after: 1 }); assert.equal(tried.length, 1, 'one failed request, then the bundled photograph only');
    console.log(JSON.stringify({ rendered: result.count, pendingIdentity: result.pending,
      dimensions: [100, 240], grayLevels: 16, clippingFailures: result.failures.length, backendBottles: g2.checked, backendFallback: 'ok' }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
