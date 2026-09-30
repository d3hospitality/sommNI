const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
// Validate the installed photographic catalog through the actual browser/G2 rasterizer.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ||
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  try {
    const page = await browser.newPage();
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
    console.log(JSON.stringify({ rendered: result.count, pendingIdentity: result.pending,
      dimensions: [100, 240], grayLevels: 16, clippingFailures: result.failures.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
