const { serveG2Bottles } = require('./g2-backend.cjs');
// Wine lists on the phone, end to end: the browser talks to the real wine-list handler
// (real resolver, in-memory database, fake model), so every chip on screen is the resolver's answer.
const BASE = process.env.WL_BASE_URL || 'http://127.0.0.1:5192';
const { chromium } = require('playwright');
const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path'); const { randomUUID } = require('node:crypto');
const { createWineListHandler } = require('../server/wine-list.cjs');
const { createCatalogReviewHandler } = require('../server/catalog-review.cjs');
const { env, invoke, fixture, user: apiUser } = require('./billing-helpers.cjs');
const { memoryDb } = require('./memory-db.cjs');
const output = process.env.WINELENS_TEST_OUTPUT || require('os').tmpdir() + '/winelens-browser-tests'; fs.mkdirSync(output, { recursive: true });
const user = apiUser.id, now = Math.floor(Date.now() / 1000);
const jwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: user, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }, 'test'].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session = { access_token: jwt, refresh_token: 'local-test-only', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user: { id: user, email: 'test@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const card = require('../shared/rate-card.json');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const W = (producer, wine_name, vintage, region = '', country = '', color = 'Red', confidence = 0.9) => ({ producer, wine_name, vintage, region, country, grape: '', color, price: '58', source_line: `${producer} ${wine_name} ${vintage}`.trim(), confidence });
const PAGE = [W('Terrazas de los Andes', 'Grand Malbec', 2017, 'Mendoza', 'Argentina'), W('Ameztoi', 'Txakoli Rosé', 2023, 'Getariako Txakolina', 'Spain', 'Rose'),
  W('', 'Terrazas de los Andes Grand Malbec', 2017), W('Mystery Estate', 'Reserva', 'unknown', 'Somewhere Nice', 'France'), W('', 'Cuvée Prestige', 'NV', '', '', 'Sparkling', 0.4)];

let failureDump = async () => {};
(async () => {
  // Server side: the real handler, the same fakes as tests/wine-list.test.cjs.
  const f = fixture(), service = memoryDb(), udb = memoryDb({ owner: user, tables: { user_collection: [] } });
  const jobs = new Map(), rpc = f.db.rpc, from = f.db.from.bind(f.db); let modelCalls = 0;
  f.db.from = t => t.startsWith('winelens_list') || ['winelens_shared_notes', 'winelens_catalog_proposals', 'winelens_entitlements'].includes(t) ? service.from(t) : from(t);
  service.tables.winelens_entitlements = [{ user_id: user, plan: 'owner' }];
  f.db.rpc = async (name, args) => {
    if (name === 'winelens_begin_job') {
      f.calls.push([name, args]); const prev = jobs.get(args.p_request_id);
      if (prev) return { data: prev.fp !== args.p_fingerprint ? { allowed: false, reason: 'request_mismatch' } : { replayed: true, result: prev.result, status: prev.status } };
      jobs.set(args.p_request_id, { fp: args.p_fingerprint, status: 'reserved', result: null }); return { data: { allowed: true, reservation_id: randomUUID() } };
    }
    if (name === 'winelens_finish_job') { const j = jobs.get(args.p_request_id); j.result = args.p_result; j.status = args.p_result ? 'committed' : 'released'; return { data: { status: j.status } }; }
    if (name === 'winelens_propose_wine') {
      f.calls.push([name, args]); const rows = service.tables.winelens_catalog_proposals ||= [], hit = rows.find(r => r.wine_key === args.p_key);
      if (hit) hit.seen++; else rows.push({ wine_key: args.p_key, wine: args.p_wine, place: args.p_place, status: 'pending', seen: 1, created_at: new Date().toISOString() });
      return { data: { status: hit?.status || 'pending' } };
    }
    if (name === 'winelens_decide_proposal') { f.calls.push([name, args]); const hit = service.tables.winelens_catalog_proposals.find(r => r.wine_key === args.p_key); hit.status = args.p_decision; return { data: { status: args.p_decision, catalog_id: args.p_row?.id ?? null } }; }
    return rpc(name, args);
  };
  const openai = { chat: { completions: { create: async () => { modelCalls++; return { choices: [{ message: { content: JSON.stringify({ wines: PAGE }) } }] }; } } } };
  const handler = createWineListHandler({ getDb: () => f.db, getUserDb: () => udb, env, getOpenAI: () => openai,
    extractPdfText: async bytes => bytes.includes(Buffer.from('SCAN')) ? { text: '', pages: 2 } : { text: 'Terrazas de los Andes Grand Malbec 2017 ........ 58\n'.repeat(20), pages: 1 } });
  const review = createCatalogReviewHandler({ getDb: () => f.db });
  const status = { pro: true, plan: 'pro', tokens: 100, auto_spend: false, scan_available: true, rate_card: card,
    allowances: { label_scan: { remaining: 60, limit: 60 }, tasting_notes: { remaining: 60, limit: 60 }, studio_render: { remaining: 10, limit: 10 }, wine_list_page: { remaining: 5, limit: 5 }, wine_list_text: { remaining: 100, limit: 100 } } };

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });await serveG2Bottles(context);
  const errors = [];
  await context.route('https://mcmtasetompygfktzhpr.supabase.co/auth/**', route => route.fulfill({ json: session.user }));
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
    if (url.pathname === '/api/device-link') return route.fulfill({ json: body.action === 'redeem' ? { session, device_id: randomUUID() } : { status: 'linked', removed: true } });
    assert.equal(req.headers().authorization, 'Bearer ' + jwt);
    if (url.pathname === '/api/billing') return route.fulfill({ json: status });
    if (url.pathname === '/api/study') return route.fulfill({ json: body.action === 'pull' ? { events: [] } : { accepted: [], duplicates: [], rejected: [] } });
    if (url.pathname === '/api/winebrary' && body.action === 'list') return route.fulfill({ json: { items: udb.tables.user_collection.map(r => ({ ...r })), count: udb.tables.user_collection.length } });
    if (url.pathname === '/api/wine-list') { const res = await invoke(handler, body); return route.fulfill({ status: res.status, json: res.body }); }
    if (url.pathname === '/api/catalog-review') { const res = await invoke(review, body); return route.fulfill({ status: res.status, json: res.body }); }
    return route.fulfill({ status: 404, json: { error: 'Unhandled test path ' + url.pathname } });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  process.on('exit', code => { if (code) console.error('errors:', errors); });
  failureDump = async () => { console.error('feedback:', await page.locator('#wl-feedback').textContent().catch(() => '?'), '| cost:', await page.locator('.wl-cost-line').textContent().catch(() => '-'));
    await page.screenshot({ path: path.resolve(output, 'wineLENS-WineList-FAILED.png') }).catch(() => {}); };
  const dialog = page.getByRole('dialog');
  await page.goto(BASE + '/sommNI/');
  await page.getByRole('button', { name: 'Link account ↗', exact: true }).click(); await page.getByLabel('Link code').fill('ABCD-2345');
  await page.getByRole('button', { name: 'Link this device', exact: true }).click(); await page.getByRole('button', { name: 'My account ↗', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Winebrary', exact: true }).click();
  await page.locator('#wl-list').click();

  // 1 · Photos: compressed on the phone, billed per page, the panel follows the page count.
  await dialog.getByRole('heading', { name: /A whole list/ }).waitFor();
  await dialog.getByRole('button', { name: /Photos of the pages/ }).click();
  await dialog.getByText('Included with wineLENS · 5 of 5 left this month').waitFor();
  assert.equal(await page.locator('#wl-list-read').isDisabled(), true, 'nothing to read yet');
  await page.locator('#wl-list-photos').setInputFiles([{ name: 'page-1.png', mimeType: 'image/png', buffer: png }, { name: 'page-2.png', mimeType: 'image/png', buffer: png }]);
  await dialog.getByText('Included with wineLENS · uses 2 of your 5 left this month').waitFor();
  assert.equal(await page.locator('.wl-list-thumbs img').count(), 2);
  await dialog.getByRole('button', { name: 'Read 2 pages ✦' }).click();

  // 2 · Review: grouped, every wine resolved (catalog, globe, notes), duplicates merged.
  await dialog.getByRole('heading', { name: '4 wines found.' }).waitFor();
  const begin = f.calls.find(c => c[0] === 'winelens_begin_job')[1];
  assert.deepEqual([begin.p_feature, begin.p_quantity, modelCalls], ['wine_list_page', 2, 2]);
  const row = name => dialog.locator('.wl-list-row', { hasText: name });
  assert.equal(await dialog.locator('.wl-list-group', { hasText: 'In the wineLENS catalog' }).locator('.wl-list-row').count(), 1, 'single-column line merged with its catalog twin');
  const malbec = row('Grand Malbec');
  for (const chip of ['In the catalog ✓', 'On the globe · Mendoza, Argentina', 'Catalog notes', 'Listed 4×']) await malbec.getByText(chip, { exact: true }).waitFor();
  assert.equal(await malbec.locator('.wl-list-catalog').isChecked(), true);
  await row('Txakoli').getByText('Getariako Txakolina · not on the globe yet').waitFor();
  const prestige = dialog.locator('.wl-list-group', { hasText: 'Needs a look' }).locator('.wl-list-row', { hasText: 'Cuvée Prestige' });
  await prestige.getByText('Hard to read · check it').waitFor(); assert.equal(await prestige.locator('.wl-list-save').isChecked(), false, 'low confidence starts unticked');
  await dialog.getByRole('button', { name: 'Save 3 wines to Winebrary ↗' }).waitFor();
  // Fix a misread place inline: the server re-resolves it.
  const mystery = row('Reserva'); await mystery.getByRole('button', { name: 'Edit details' }).click();
  await mystery.getByLabel('Region').fill('Maipo Valley'); await mystery.getByLabel('Country').fill('Chile');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth + 1), 'review fits a phone');
  await page.screenshot({ path: path.resolve(output, 'wineLENS-WineList-Review-Mobile.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await dialog.getByRole('button', { name: 'Save 3 wines to Winebrary ↗' }).click();

  // 3 · Saved: Winebrary, catalog proposals, everything else skipped.
  await dialog.getByRole('heading', { name: '3 wines in your Winebrary.' }).waitFor();
  await dialog.getByText('2 new to wineLENS, suggested to the catalog for review.').waitFor(); await dialog.getByText('1 skipped.').waitFor();
  const saved = udb.tables.user_collection;
  assert.equal(saved.find(w => w.wine_name === 'Grand Malbec').wine_id, 'wl_grand-malbec-terrazas-de-los-andes');
  const myst = saved.find(w => w.wine_name === 'Reserva');
  assert.deepEqual([myst.region, myst.metadata.country, myst.metadata.place_status, myst.metadata.region_source], ['Valle del Maipo', 'Chile', 'mapped', 'Maipo Valley']);
  assert.equal(f.calls.filter(c => c[0] === 'winelens_propose_wine').length, 2);
  // Wine cards for the whole list: one token each, with consent.
  await dialog.getByText('Uses 3 tokens (100 left)', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Make 3 wine cards ✦' }).isDisabled(), true, 'consent first');
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.wl-bottle-card', { hasText: 'Grand Malbec' }).getByText('Catalog notes').waitFor();
  assert.equal(await page.locator('.wl-bottle-card').count(), 3);

  // 4 · Beyond the allowance: tokens per page, only with an explicit tick; Free cannot top up.
  status.allowances.wine_list_page.remaining = 1;
  await page.locator('#wl-list').click(); await dialog.getByRole('button', { name: /Photos of the pages/ }).click();
  await page.locator('#wl-list-photos').setInputFiles([1, 2, 3].map(i => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png })));
  await dialog.getByText('1 included, then uses 2 tokens (100 left)').waitFor();
  assert.equal(await page.locator('#wl-list-read').isDisabled(), true, 'tokens need consent');
  await dialog.getByLabel('Use 2 tokens for this').check(); assert.equal(await page.locator('#wl-list-read').isDisabled(), false);
  await dialog.getByRole('button', { name: 'Remove page 3' }).click();
  await dialog.getByText('1 included, then uses 1 token (100 left)').waitFor();
  assert.equal(await dialog.getByLabel('Use 1 token for this').isChecked(), false, 'a new amount needs a new tick');
  status.pro = false; status.plan = 'free'; status.allowances.wine_list_page = { remaining: 1, limit: 1 };
  await dialog.getByRole('button', { name: '← Choose another way' }).click(); await dialog.getByRole('button', { name: /Photos of the pages/ }).click();
  await page.locator('#wl-list-photos').setInputFiles([1, 2].map(i => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png })));
  await dialog.getByText('The free preview includes 1 wine-list photo page a month and 1 is left; this needs 2. The wineLENS app includes more.').waitFor();
  await dialog.getByRole('link', { name: 'Get wineLENS ↗' }).waitFor(); assert.equal(await page.locator('#wl-list-read').isDisabled(), true);
  status.pro = true; status.plan = 'pro'; status.allowances.wine_list_page = { remaining: 5, limit: 5 };

  // 5 · PDFs: a free check first; scans go to photos; text PDFs are billed as text pages.
  await dialog.getByRole('button', { name: '← Choose another way' }).click(); await dialog.getByRole('button', { name: /A PDF/ }).click();
  await page.locator('#wl-list-pdf').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 SCAN') });
  await dialog.getByText(/This PDF is a scan/).waitFor(); await dialog.getByRole('button', { name: 'Photograph the pages instead →' }).click();
  await dialog.getByRole('heading', { name: 'One photo per page.' }).waitFor();
  await dialog.getByRole('button', { name: '← Choose another way' }).click(); await dialog.getByRole('button', { name: /A PDF/ }).click();
  const calls = modelCalls;
  await page.locator('#wl-list-pdf').setInputFiles({ name: 'list.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 text list') });
  await dialog.getByText('1 PDF page · 1 text page to read.').waitFor(); assert.equal(modelCalls, calls, 'checking a PDF is free');
  await dialog.getByText('Included with wineLENS · 100 of 100 left this month').waitFor();
  await dialog.getByRole('button', { name: 'Read 1 text page ✦' }).click();
  await dialog.getByRole('heading', { name: '4 wines found.' }).waitFor();
  const pdfJob = f.calls.filter(c => c[0] === 'winelens_begin_job').at(-1)[1]; assert.deepEqual([pdfJob.p_feature, pdfJob.p_quantity], ['wine_list_text', 1]);
  await row('Grand Malbec').getByText('Already in your Winebrary').waitFor(); assert.equal(await row('Grand Malbec').locator('.wl-list-save').isChecked(), false, 'already saved: unticked');

  // 6 · Review later and come back: the paid read is kept in the account.
  await dialog.getByRole('button', { name: 'Review later' }).click();
  await page.locator('#wl-list').click(); await dialog.getByRole('button', { name: /Continue your last list · 4 wines to review/ }).click();
  await dialog.getByRole('heading', { name: '4 wines found.' }).waitFor();

  // 7 · Pasted text: live page count; spreadsheets are free and never reach the model.
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('#wl-list').click(); await dialog.getByRole('button', { name: /Paste the list/ }).click();
  await dialog.getByLabel('Wine list').fill('Terrazas de los Andes Grand Malbec 2017 ........ 58\n'.repeat(140));
  await dialog.getByText(/text pages$/).filter({ hasText: '2 text pages' }).waitFor();
  await dialog.getByText('Included with wineLENS · uses 2 of your 100 left this month').waitFor();
  await dialog.getByRole('button', { name: '← Choose another way' }).click(); await dialog.getByRole('button', { name: /A spreadsheet/ }).click();
  await page.locator('#wl-list-csv').setInputFiles({ name: 'list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') });
  await dialog.getByText(/Save the spreadsheet as CSV first/).waitFor();
  const before = modelCalls;
  await page.locator('#wl-list-csv').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from('Producer;Wine;Vintage;Region;Country\nBillecart-Salmon;Brut Réserve;NV;Champagne;France\nCatena Zapata;Malbec Argentino;2019;Mendoza;Argentina\n') });
  await dialog.getByRole('heading', { name: '2 wines found.' }).waitFor(); assert.equal(modelCalls, before, 'CSV: no AI');
  await row('Brut Réserve').getByText(/On the globe · Champagne/).waitFor();
  await page.screenshot({ path: path.resolve(output, 'wineLENS-WineList-Review.png'), fullPage: false });

  // 8 · Owner: suggestions from those saves, places needing an alias, approve with a correction.
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  status.plan = 'owner';
  await page.getByRole('button', { name: 'My account ↗', exact: true }).click(); await dialog.getByText(/^wineLENS owner/).waitFor();
  await dialog.getByRole('button', { name: 'Review catalog suggestions' }).click();
  await dialog.getByRole('heading', { name: 'Suggested wines.' }).waitFor();
  await dialog.locator('.wl-list-group', { hasText: 'Places not on the globe yet' }).getByText('Getariako Txakolina', { exact: false }).waitFor();
  const txa = dialog.locator('.wl-review-row', { hasText: 'Txakoli Rosé' });
  await txa.getByLabel('Grape').fill('Hondarrabi Zuri'); await txa.getByRole('button', { name: 'Add to catalog' }).click();
  await dialog.getByText(/^Added to the catalog as wl_txakoli-rose-ameztoi-[0-9a-f]{8}\.$/).waitFor();
  const decided = f.calls.filter(c => c[0] === 'winelens_decide_proposal').at(-1)[1];
  assert.deepEqual([decided.p_decision, decided.p_row.grape, decided.p_row.color], ['approved', 'Hondarrabi Zuri', 'rose']);
  await dialog.locator('.wl-review-row', { hasText: 'Reserva' }).getByRole('button', { name: 'Reject' }).click();
  await dialog.getByText('Rejected. It will not be suggested again.').waitFor(); assert.equal(await dialog.locator('.wl-review-row').count(), 0);
  await page.screenshot({ path: path.resolve(output, 'wineLENS-Catalog-Review.png') });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['photos compressed and billed per page', 'review groups + resolver chips', 'inline edit re-resolved on save', 'Winebrary + catalog proposals', 'per-page tokens need a fresh tick per amount', 'Free cannot top up', 'PDF check free, scans → photos, text pages billed', 'review later + resume', 'pasted text page count', 'CSV free, Excel asks for CSV', 'fits a phone', 'owner review: approve with correction, reject'] }));
  await browser.close();
})().catch(async e => { console.error(e); await failureDump(); process.exit(1); });
