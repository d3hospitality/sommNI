// Find My Wine: the engine (pairings, reasons, Winebrary, hidden catalog) and the phone flow
// (questions → picks → save / glasses / notes → the sommelier beyond the catalog).
const { serveG2Bottles } = require('./g2-backend.cjs');
const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const { chromium } = require('playwright');
const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const output = process.env.WINELENS_TEST_OUTPUT || require('os').tmpdir() + '/winelens-browser-tests'; fs.mkdirSync(output, { recursive: true });
const user = '11111111-1111-4111-8111-111111111111';
const now = Math.floor(Date.now() / 1000); const jwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: user, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }, 'test'].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session = { access_token: jwt, refresh_token: 'local-test-only', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user: { id: user, email: 'test@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const card = require('../shared/rate-card.json');
const somm = (name, extra = {}) => ({ name, producer: 'Giacomo Fenocchio', region: 'Piedmont', country: 'Italy', grape: 'Nebbiolo', color: 'Red', vintage: 'Recent vintage', why: 'Firm tannin and bright acidity cut through a rich steak.', serve: 'Decant for an hour; serve at 16 to 18 °C.', confidence: 0.8, ...extra });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); await serveG2Bottles(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let items = [], adds = [], asks = [];
  const status = { pro: true, plan: 'pro', tokens: 100, auto_spend: false, scan_available: true, rate_card: card, allowances: { sommelier: { remaining: 30, limit: 30 }, wine_card: { remaining: 0, limit: 0 } } };
  await page.route('https://mcmtasetompygfktzhpr.supabase.co/auth/**', route => route.fulfill({ json: session.user }));
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
    if (url.pathname === '/api/device-link') return route.fulfill({ json: body.action === 'redeem' ? { session, device_id: user } : { status: 'linked', removed: true } });
    assert.equal(req.headers().authorization, 'Bearer ' + jwt);
    if (url.pathname === '/api/billing') return route.fulfill({ json: status });
    if (url.pathname === '/api/study') return route.fulfill({ json: body.action === 'pull' ? { events: [] } : { accepted: [], duplicates: [], rejected: [] } });
    if (url.pathname === '/api/winebrary') {
      if (body.action === 'list') return route.fulfill({ json: { items, count: items.length } });
      if (body.action === 'add') {
        adds.push(body);
        const item = { id: require('crypto').randomUUID(), user_id: user, wine_name: body.wine_name, producer: body.producer || null, region: body.region || null, notes: null, wine_id: body.wine_id || null, vintage: body.vintage_state === 'year' ? Number(body.vintage) : null, metadata: { vintage_state: body.vintage_state, color: body.color, country: body.country, grape: body.grape } };
        items.unshift(item); return route.fulfill({ json: { item } });
      }
    }
    if (url.pathname === '/api/sommelier') {
      asks.push(body);
      return route.fulfill({ json: { wines: [somm('Barolo'), somm('Ribera del Duero Reserva', { producer: 'Pesquera', country: 'Spain', grape: 'Tempranillo', region: 'Ribera del Duero', vintage: '2018' }), somm('Mendoza Cabernet Franc', { country: 'Argentina', grape: 'Cabernet Franc' })], replayed: false, charged: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unhandled test path ' + url.pathname } });
  });
  await page.goto(BASE + '/sommNI/');

  // ── 1 · The engine ──
  const engine = await page.evaluate(async () => {
    const F = await import('/sommNI/src/finder.ts'), V = await import('/sommNI/src/catalog-view.ts'), I = await import('/sommNI/src/identity.ts');
    const steak = F.findWines({ moment: 'dinner', food: 'steak', color: 'Red' }, [], 12);
    const again = F.findWines({ moment: 'dinner', food: 'steak', color: 'Red' }, [], 12);
    const top6 = steak.slice(0, 6), perGrape = {};
    for (const r of top6) perGrape[r.grape] = (perGrape[r.grape] || 0) + 1;
    const fish = F.findWines({ food: 'seafood' }, [], 8);
    const malbec = I.allCatalogWines().find(w => w.wine.grape === 'Cabernet Sauvignon' && w.type === 'Red');
    const library = [
      { id: 'a', wine_id: malbec.id, wine_name: 'My Cabernet', producer: 'Me', metadata: { color: 'Red', grape: 'Cabernet Sauvignon', country: malbec.country } },
      { id: 'b', wine_name: 'Cellar Syrah', producer: 'Local', notes: 'Blackberry, smoke and pepper; firm tannin.', metadata: { color: 'Red', grape: 'Syrah', country: 'Australia' } },
    ];
    const withLib = F.findWines({ food: 'steak', color: 'Red', flavor: 'dark_fruits' }, library, 400);
    const mineTwin = withLib.find(r => r.key === malbec.id), cellar = withLib.find(r => r.key === 'lib:b');
    const otherMalbec = withLib.find(r => r.grape === 'Cabernet Sauvignon' && r.key !== malbec.id);
    await V.setCatalogHidden(true);
    const hidden = F.findWines({}, library, 12);
    await V.setCatalogHidden(false);
    const steps = F.finderSteps({ color: 'White' }), reds = F.finderSteps({ color: 'Red' });
    const cleared = F.answerStep({ color: 'Red', flavor: 'dark_fruits' }, 'color', 'White');
    return {
      topWhy: steak[0].reasons, stable: JSON.stringify(steak.map(r => r.key)) === JSON.stringify(again.map(r => r.key)), allRed: steak.every(r => r.type === 'Red'),
      maxPerGrape: Math.max(...Object.values(perGrape)), fishTypes: [...new Set(fish.map(r => r.type))], fishWhy: fish[0].reasons.join(' | '),
      mineTwin: mineTwin && { mine: mineTwin.mine, hasItem: !!mineTwin.item }, cellar: cellar && { mine: cellar.mine, reasons: cellar.reasons, item: cellar.item },
      likeYours: otherMalbec?.reasons.includes('Like your My Cabernet'), hidden: hidden.map(r => r.key).sort(),
      flavorWhite: steps[4].options.map(o => o.id).join(','), flavorRed: reds[4].options.map(o => o.id).join(','), cleared,
      line: F.answersLine({ moment: 'dinner', food: 'steak', color: 'skip', taste: 'bold' }),
    };
  });
  assert.ok(engine.topWhy.some(r => /red meat/.test(r)), 'steak picks say why: ' + engine.topWhy);
  assert.ok(engine.stable && engine.allRed, 'same answers, same list; colour respected');
  assert.ok(engine.maxPerGrape <= 2, 'a sommelier’s spread: at most two of a grape near the top');
  assert.ok(engine.fishTypes.every(t => ['White', 'Sparkling', 'Rose'].includes(t)), 'seafood: whites, sparkling, rosé first: ' + engine.fishTypes);
  assert.match(engine.fishWhy, /seafood/);
  assert.deepEqual(engine.mineTwin, { mine: true, hasItem: true }, 'a saved catalog wine keeps its catalog notes and is marked yours');
  assert.equal(engine.cellar.mine, true); assert.equal(engine.cellar.item, null);
  assert.ok(engine.cellar.reasons.includes('Your notes mention blackberry'), 'own wines are matched on their notes: ' + engine.cellar.reasons);
  assert.equal(engine.likeYours, true, 'more of what you keep');
  assert.equal(engine.hidden.length, 2, 'default wines hidden: only the Winebrary is searched'); assert.ok(engine.hidden.includes('lib:b'));
  assert.notEqual(engine.flavorWhite, engine.flavorRed, 'flavour options follow the colour');
  assert.deepEqual(engine.cleared, { color: 'White' }, 'a new colour clears the flavour');
  assert.equal(engine.line, 'Dinner · Steak & red meat · Bold & powerful');

  // ── 2 · Phone, signed out: questions → picks with reasons; the sommelier needs an account ──
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Find my wine', exact: true }).click();
  await dialog.getByRole('heading', { name: 'What’s the moment?' }).waitFor();
  await page.screenshot({ path: path.resolve(output, 'wineLENS-Finder-Question.png') });
  await dialog.getByRole('button', { name: 'Dinner', exact: true }).click();
  await dialog.getByRole('heading', { name: 'What are you eating?' }).waitFor(); await dialog.getByText('Dinner', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Steak & red meat' }).click();
  await dialog.getByRole('button', { name: 'Red', exact: true }).click();
  // Back keeps earlier answers and lets you change one.
  await dialog.getByRole('button', { name: '← Back' }).click(); await dialog.getByRole('heading', { name: 'Any colour in mind?' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Red', exact: true }).getAttribute('class'), 'wl-finder-option active');
  await dialog.getByRole('button', { name: 'Red', exact: true }).click();
  await dialog.getByRole('button', { name: 'Bold & powerful' }).click();
  await dialog.getByRole('button', { name: 'Skip →' }).click();
  await dialog.getByRole('heading', { name: 'Here’s what I’d pour.' }).waitFor();
  await dialog.getByText('Dinner · Steak & red meat · Red · Bold & powerful', { exact: true }).waitFor();
  const firstPick = dialog.locator('.wl-pick').first();
  await firstPick.locator('.wl-pick-why li', { hasText: 'red meat' }).first().waitFor();
  assert.ok(await dialog.locator('.wl-pick').count() >= 5, 'several picks');
  await firstPick.getByText('Tasting notes').click(); await firstPick.locator('dt', { hasText: 'NOSE' }).waitFor();
  await dialog.getByRole('button', { name: 'Link your account to ask' }).waitFor();
  await dialog.getByRole('button', { name: 'Show on glasses' }).click();
  await dialog.getByText('Connect your Even G2 glasses first.').waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth + 1), 'picks fit a phone');
  await page.screenshot({ path: path.resolve(output, 'wineLENS-Finder-Picks-Mobile.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  // ── 3 · Signed in: save a pick, then ask the sommelier and save one of theirs ──
  await page.getByRole('button', { name: 'Link account ↗', exact: true }).click(); await page.getByLabel('Link code').fill('ABCD-2345');
  await page.getByRole('button', { name: 'Link this device', exact: true }).click(); await page.getByRole('button', { name: 'My account ↗', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Find my wine', exact: true }).click();
  for (const answer of ['Dinner', 'Steak & red meat', 'Red', 'Bold & powerful']) await dialog.getByRole('button', { name: answer, exact: true }).click();
  await dialog.getByRole('button', { name: 'Skip →' }).click();
  const title = await dialog.locator('.wl-pick strong').first().textContent();
  await dialog.locator('.wl-pick').first().getByRole('button', { name: 'Save to Winebrary' }).click();
  await dialog.locator('.wl-pick').first().getByText('Saved ✓').waitFor();
  assert.equal(adds.length, 1); assert.equal(adds[0].wine_name, title); assert.match(adds[0].wine_id, /^wl_/, 'saved with its catalog ID'); assert.equal(adds[0].vintage_state, 'unknown');
  await dialog.getByText('Included with wineLENS · 30 of 30 left this month').waitFor();
  await dialog.getByLabel('Anything else?').fill('Under $40, something Italian');
  await dialog.getByRole('button', { name: 'Ask the sommelier ✦' }).click();
  await dialog.getByText('Barolo', { exact: true }).waitFor();
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0].brief, ['Moment: Dinner', 'Food: Steak & red meat', 'Colour: Red', 'Feel: Bold & powerful']);
  assert.equal(asks[0].note, 'Under $40, something Italian'); assert.ok(asks[0].avoid.length >= 5 && asks[0].avoid.length <= 12, 'tells the sommelier what was already shown');
  assert.equal(asks[0].spend_consent, false, 'allowance: no token consent needed'); assert.match(asks[0].request_id, /^[0-9a-f-]{36}$/);
  await dialog.getByText('From the wineLENS sommelier (AI), not a tasting. Check the label and vintage at the shop.').waitFor();
  const pesquera = dialog.locator('.wl-somm-pick', { hasText: 'Ribera del Duero Reserva' });
  await pesquera.getByRole('button', { name: 'Save to Winebrary' }).click();
  await pesquera.getByRole('button', { name: 'Make its wine card ✦' }).waitFor();
  assert.deepEqual([adds[1].wine_name, adds[1].producer, adds[1].color, adds[1].grape, adds[1].vintage_state, adds[1].vintage, adds[1].wine_id], ['Ribera del Duero Reserva', 'Pesquera', 'Red', 'Tempranillo', 'year', '2018', undefined]);
  await page.screenshot({ path: path.resolve(output, 'wineLENS-Finder-Sommelier.png') });
  await pesquera.getByRole('button', { name: 'Make its wine card ✦' }).click();
  await dialog.getByRole('heading', { name: 'Ribera del Duero Reserva', exact: true }).waitFor();
  await dialog.getByRole('button', { name: /Make my wine card/ }).waitFor();
  // The finder now learns from what was saved: the saved pick is marked as yours.
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Find my wine', exact: true }).click();
  for (const answer of ['Dinner', 'Steak & red meat', 'Red', 'Bold & powerful']) await dialog.getByRole('button', { name: answer, exact: true }).click();
  await dialog.getByRole('button', { name: 'Skip →' }).click();
  const own = dialog.locator('.wl-pick', { hasText: 'In your Winebrary' }).first(); await own.waitFor();
  assert.ok(await dialog.locator('.wl-pick').nth(1).filter({ hasText: 'In your Winebrary' }).count() || await dialog.locator('.wl-pick').nth(0).filter({ hasText: 'In your Winebrary' }).count(), 'your best-fitting bottle sits near the top');
  await own.getByRole('button', { name: 'Open in Winebrary' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['pairing reasons', 'stable + spread', 'Winebrary-aware (twins, own notes, like yours)', 'hidden catalog → Winebrary only', 'questions with back/skip', 'picks with notes', 'save a pick', 'sommelier brief + avoid + allowance', 'save a sommelier pick → wine card', 'fits a phone'] }));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
