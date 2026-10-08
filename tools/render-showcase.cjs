// Renders the 3D showcase's poster, fallback videos and "on the lens" stills from the live page
// (the same stage, model, captures and config the site runs), so none of them can drift from it.
//   npm run dev:site   (port 5187), then:  node tools/render-showcase.cjs [poster|video|lens|stills|all] [still names, comma separated]
// Outputs land in site/public/g2b/out/winelens/ and site/public/media/lens/.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.SITE_URL || 'http://127.0.0.1:5187/';
const OUT = path.resolve(__dirname, '../site/public/g2b/out/winelens');
const LENS = path.resolve(__dirname, '../site/public/media/lens');
const what = process.argv[2] || 'all';
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(LENS, { recursive: true });

/** The stage alone, filling the viewport, on the section colour. */
const ISOLATE = `
  body > *:not(main){display:none!important}
  main > *:not(.model-section){display:none!important}
  .model-section{padding:0!important;background:#231C19!important}
  .model-heading,.model-section .caption{display:none!important}
  .g2b{display:block!important;margin:0!important}
  .g2b-panel{display:none!important}
  .g2b-stage{position:fixed!important;inset:0!important;aspect-ratio:auto!important;border-radius:0!important;box-shadow:none!important}
`;

async function open(browser, viewport, { motion = true, record = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: motion ? 'no-preference' : 'reduce', ...(record ? { recordVideo: { dir: record, size: viewport } } : {}) });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('[data-g2b]').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('.g2b')?.classList.contains('is-live'), null, { timeout: 60000 });
  // Isolate the stage only once it is live (hiding the page first would stop it from ever starting).
  await page.addStyleTag({ content: ISOLATE });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(1500);
  return { context, page };
}
// Pillow's WebP encoder (Homebrew ffmpeg ships without libwebp).
const webp = (png, out, q = 82) => execFileSync('python3', ['-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), method=6)', png, out, String(q)]);

async function posters(browser) {
  for (const [name, viewport] of [['desktop', { width: 1920, height: 1080 }], ['mobile', { width: 864, height: 1080 }]]) {
    const { context, page } = await open(browser, viewport, { motion: false });
    const png = path.join(OUT, `poster-${name}.png`);
    await page.screenshot({ path: png });
    webp(png, path.join(OUT, `winelens-poster-${name}.webp`)); fs.rmSync(png);
    await context.close();
    console.log('poster', name);
  }
}

async function videos(browser) {
  for (const [name, viewport] of [['landscape', { width: 1280, height: 720 }], ['mobile', { width: 720, height: 900 }]]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2b-'));
    const { context, page } = await open(browser, viewport, { motion: true, record: dir });
    await page.waitForTimeout(24500);                      // one turn of the turntable (revolutionMs)
    const video = page.video(); await context.close();
    const raw = await video.path();
    // Trim the loading seconds; keep one clean revolution.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '4', '-i', raw, '-t', '22', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', path.join(OUT, `winelens-${name}.webm`)]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '4', '-i', raw, '-t', '22', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', path.join(OUT, `winelens-${name}.mp4`)]);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('video', name);
  }
}

/** Stills of each screen on the lenses, for the feature sections. */
async function lens(browser) {
  const { context, page } = await open(browser, { width: 1600, height: 900 }, { motion: false });
  for (const beat of ['notes', 'winebrary', 'atlas', 'study']) {
    await page.evaluate(id => document.querySelector(`[data-g2b-beat="${id}"]`).click(), beat);
    await page.waitForTimeout(2600);
    const png = path.join(LENS, `lens-${beat}.png`);
    await page.screenshot({ path: png });
    webp(png, path.join(LENS, `lens-${beat}.webp`), 84); fs.rmSync(png);
    console.log('lens', beat);
  }
  await context.close();
}

/**
 * Transparent stills for the page (hero + feature sections): the same stage, posed three-quarter
 * and close, one screen each, rendered straight from the canvas with an alpha channel.
 */
const STILLS = [
  { name: 'hero-notes', src: 'glasses-notes.png', pose: { yaw: -20, pitch: 8, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-winebrary', src: 'glasses-winebrary-wine.png', pose: { yaw: 18, pitch: 7, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-winebrary-region', src: 'glasses-winebrary-region.png', pose: { yaw: -16, pitch: 7, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-atlas', src: 'glasses-atlas.png', pose: { yaw: -18, pitch: 8, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-atlas-region', src: 'glasses-atlas-region.png', pose: { yaw: 16, pitch: 8, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-study', src: 'glasses-study.png', pose: { yaw: 20, pitch: 8, zoom: 0.96, lift: 0, truck: 0 } },
  { name: 'still-finder', src: 'glasses-finder.png', pose: { yaw: -18, pitch: 8, zoom: 0.96, lift: 0, truck: 0 } },
];
// Optional: only these stills (e.g. `stills still-finder,still-study`), so the others are not re-rendered.
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
async function stills(browser) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const wanted = ONLY.length ? STILLS.filter(s => ONLY.includes(s.name)) : STILLS;
  const results = await page.evaluate(async list => {
    const { Stage, loadImageCapture } = await import('/g2b/stage.ts');
    const config = await (await fetch('/g2b/winelens.json')).json();
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 1000;
    document.body.append(canvas);
    const stage = new Stage(canvas, { background: config.background, tone: config.tone, transparent: true, preserveDrawingBuffer: true, pixelRatio: 1, look: config.look });
    await stage.load('/g2b/' + config.model, config.assetAdapter);
    stage.setDisplay(config.displaySettings, config.eye);
    const out = [];
    for (const still of list) {
      const capture = await loadImageCapture('/g2b/media/winelens/' + still.src, stage.renderer);
      stage.setCaptures(capture, null, 1);
      stage.setSize(1600, 1000, 1);
      stage.setSpin(0);
      stage.setPose(still.pose);
      stage.render();
      out.push({ name: still.name, data: canvas.toDataURL('image/png') });
    }
    return out;
  }, wanted);
  for (const { name, data } of results) {
    const png = path.join(LENS, `${name}.png`);
    fs.writeFileSync(png, Buffer.from(data.split(',')[1], 'base64'));
    execFileSync('python3', ['-c', 'import sys; from PIL import Image; im=Image.open(sys.argv[1]); bb=im.getbbox(); im=im.crop((max(0,bb[0]-40),max(0,bb[1]-40),min(im.width,bb[2]+40),min(im.height,bb[3]+40))); im.save(sys.argv[2],"WEBP",quality=86,method=6)', png, path.join(LENS, `${name}.webp`)]);
    fs.rmSync(png);
    console.log('still', name);
  }
  await context.close();
}

(async () => {
  const gl = process.platform === 'darwin' ? '--use-angle=metal' : '--use-gl=swiftshader';
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [gl, '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    if (what === 'poster' || what === 'all') await posters(browser);
    if (what === 'lens') await lens(browser);
    if (what === 'stills' || what === 'all') await stills(browser);
    if (what === 'video' || what === 'all') await videos(browser);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
