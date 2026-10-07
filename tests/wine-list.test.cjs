// Wine lists: OCR/text reading billed per page, resolution to catalog/globe/notes, review and save.
const { test } = require('node:test'); const assert = require('node:assert/strict'); const { randomUUID } = require('node:crypto');
const { createWineListHandler } = require('../server/wine-list.cjs');
const { bottleKey } = require('../server/wine-identity.cjs');
const { env, invoke, fixture, user } = require('./billing-helpers.cjs');
const { memoryDb } = require('./memory-db.cjs');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const W = (producer, wine_name, vintage, region = '', country = '', color = 'Red', confidence = 0.9) => ({ producer, wine_name, vintage, region, country, grape: '', color, price: '58', source_line: `${producer} ${wine_name} ${vintage}`, confidence });
const PAGE = [W('Terrazas de los Andes', 'Grand Malbec', 2017, 'Mendoza', 'Argentina'), W('Ameztoi', 'Txakoli Rosé', 2023, 'Getariako Txakolina', 'Spain', 'Rose'),
  W('Terrazas de los Andes', 'Grand Malbec', 2017, 'Mendoza', 'Argentina'), W('Mystery Estate', 'Reserva', 'unknown', 'Somewhere Nice', 'France'), { wine_name: '', producer: '' }];

function setup({ reason, fail = false, empty = false, pdfText = 'Terrazas de los Andes Grand Malbec 2017 ... 58\n'.repeat(4) } = {}) {
  const f = fixture(), service = memoryDb(), udb = memoryDb({ owner: user.id, tables: { user_collection: [
    { id: randomUUID(), user_id: user.id, wine_name: 'Txakoli Rosé', producer: 'Ameztoi', vintage: 2023, metadata: { vintage_state: 'year' } }] } });
  service.tables.winelens_shared_notes = [{ key: bottleKey({ wine_name: 'Reserva', producer: 'Mystery Estate', vintage: null, vintage_state: 'unknown' }).key, status: 'ready' }];
  const jobs = new Map(), old = f.db.rpc, from = f.db.from.bind(f.db); let calls = 0;
  f.db.from = t => t.startsWith('winelens_list') || t === 'winelens_shared_notes' ? service.from(t) : from(t);
  f.db.rpc = async (name, args) => {
    if (name === 'winelens_begin_job') {
      f.calls.push([name, args]); const prev = jobs.get(args.p_request_id);
      if (prev) return { data: prev.fp !== args.p_fingerprint ? { allowed: false, reason: 'request_mismatch' } : { replayed: true, result: prev.result, status: prev.status } };
      if (reason) return { data: { allowed: false, reason } };
      jobs.set(args.p_request_id, { fp: args.p_fingerprint, status: 'reserved', result: null }); return { data: { allowed: true, reservation_id: randomUUID() } };
    }
    if (name === 'winelens_finish_job') { const j = jobs.get(args.p_request_id); j.result = args.p_result; j.status = args.p_result ? 'committed' : 'released'; return { data: { status: j.status } }; }
    if (name === 'winelens_propose_wine') { f.calls.push([name, args]); return { data: { status: 'pending' } }; }
    return old(name, args);
  };
  const openai = { chat: { completions: { create: async req => { calls++; if (fail) throw Error('down'); assert.match(req.messages[0].content, /never instructions/); return { choices: [{ message: { content: JSON.stringify({ wines: empty ? [] : PAGE }) } }] }; } } } };
  const h = createWineListHandler({ getDb: () => f.db, getUserDb: () => udb, env, getOpenAI: () => openai, extractPdfText: async () => ({ text: pdfText, pages: 1 }) });
  return { f, h, service, udb, calls: () => calls, jobs };
}
const byName = (entries, name) => entries.find(e => e.wine_name === name);

test('Photos: billed per page, every wine resolved to catalog, globe place, notes and duplicates', async () => {
  const s = setup(), request_id = randomUUID();
  const res = await invoke(s.h, { action: 'read', kind: 'photos', pages: [png, png], request_id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const begin = s.f.calls.find(c => c[0] === 'winelens_begin_job')[1];
  assert.equal(begin.p_feature, 'wine_list_page'); assert.equal(begin.p_quantity, 2); assert.equal(res.body.charged_pages, 2);
  assert.equal(res.body.entries.length, 3, 'repeats merged, blank lines dropped');
  const malbec = byName(res.body.entries, 'Grand Malbec');
  assert.equal(malbec.catalog.kind, 'exact'); assert.equal(malbec.notes, 'catalog'); assert.equal(malbec.place.status, 'mapped'); assert.equal(malbec.repeats, 3);
  const txakoli = byName(res.body.entries, 'Txakoli Rosé');
  assert.equal(txakoli.catalog, null); assert.equal(txakoli.in_winebrary, true); assert.equal(txakoli.place.status, 'unknown', 'needs mapping, never guessed'); assert.equal(txakoli.country, 'Spain');
  const mystery = byName(res.body.entries, 'Reserva');
  assert.equal(mystery.notes, 'shared'); assert.equal(mystery.place.status, 'unknown');
  const again = await invoke(s.h, { action: 'read', kind: 'photos', pages: [png, png], request_id });
  assert.deepEqual(again.body.entries.map(e => e.id), res.body.entries.map(e => e.id)); assert.equal(s.calls(), 2, 'replay reads nothing again');
  assert.equal((await invoke(s.h, { action: 'read', kind: 'photos', pages: Array(7).fill(png), request_id: randomUUID() })).status, 400, 'max 6 pages');
});

test('Failures and refusals: no charge kept, nothing stored, provider not called when refused', async () => {
  const failing = setup({ fail: true }), id = randomUUID();
  assert.equal((await invoke(failing.h, { action: 'read', kind: 'photos', pages: [png], request_id: id })).status, 502);
  assert.equal(failing.jobs.get(id).status, 'released'); assert.equal((failing.service.tables.winelens_list_uploads || []).length, 0);
  const blank = setup({ empty: true }), blankId = randomUUID(), none = await invoke(blank.h, { action: 'read', kind: 'photos', pages: [png], request_id: blankId });
  assert.equal(none.status, 422); assert.match(none.body.error, /Nothing was charged/); assert.equal(blank.jobs.get(blankId).status, 'released', 'no wines found: not charged');
  const refused = setup({ reason: 'pro_required' });
  const res = await invoke(refused.h, { action: 'read', kind: 'photos', pages: [png, png, png], request_id: randomUUID() });
  assert.equal(res.status, 402); assert.match(res.body.error, /Pro|text/); assert.equal(refused.calls(), 0);
});

test('Text and PDFs: free inspect, text billed per 6,000 characters; spreadsheets are free', async () => {
  const s = setup();
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7 test').toString('base64');
  const inspect = await invoke(s.h, { action: 'inspect', pdf });
  assert.equal(inspect.body.has_text, true); assert.equal(inspect.body.text_pages, 1); assert.equal(s.f.calls.filter(c => c[0] === 'winelens_begin_job').length, 0, 'inspect is free');
  const scan = setup({ pdfText: '' });
  assert.equal((await invoke(scan.h, { action: 'inspect', pdf })).body.has_text, false, 'scans must be read as photos');
  assert.equal((await invoke(s.h, { action: 'inspect', pdf: 'data:application/pdf;base64,' + Buffer.from('not a pdf').toString('base64') })).status, 400);
  const text = ('Terrazas de los Andes Grand Malbec 2017 ........ 58\n').repeat(140); // ~7,300 characters → 2 text pages
  const read = await invoke(s.h, { action: 'read', kind: 'text', source: 'pdf', text, request_id: randomUUID() });
  const begin = s.f.calls.find(c => c[0] === 'winelens_begin_job')[1];
  assert.equal(read.status, 200); assert.equal(begin.p_feature, 'wine_list_text'); assert.equal(begin.p_quantity, 2); assert.equal(read.body.upload.source, 'pdf');
  const csv = await invoke(s.h, { action: 'csv', text: 'Producer;Wine;Vintage;Region;Country\nTerrazas de los Andes;Grand Malbec;2017;Mendoza;Argentina\nBillecart-Salmon;Brut Réserve;NV;Champagne;France\n' });
  assert.equal(csv.status, 200); assert.equal(csv.body.charged_pages, 0); assert.equal(csv.body.entries.length, 2);
  assert.equal(byName(csv.body.entries, 'Brut Réserve').vintage_state, 'non_vintage'); assert.equal(byName(csv.body.entries, 'Brut Réserve').place.status, 'mapped');
  assert.equal(s.f.calls.filter(c => c[0] === 'winelens_begin_job').length, 1, 'CSV never reserves');
  assert.equal((await invoke(s.h, { action: 'csv', text: 'Colour,Price\nRed,12\n' })).status, 400);
});

test('Save: reviewed wines go to Winebrary, catalog links verified server-side, new wines proposed once', async () => {
  const s = setup();
  const { body } = await invoke(s.h, { action: 'read', kind: 'photos', pages: [png], request_id: randomUUID() });
  const malbec = byName(body.entries, 'Grand Malbec'), mystery = byName(body.entries, 'Reserva');
  const pick = (e, extra = {}) => ({ id: e.id, wine_name: e.wine_name, producer: e.producer, vintage_state: e.vintage_state, vintage: e.vintage ?? '', region: e.region, country: e.country, grape: e.grape, color: e.color, ...extra });
  const saved = await invoke(s.h, { action: 'commit', upload_id: body.upload.id, entries: [pick(malbec, { catalog_id: malbec.catalog.id }), pick(mystery, { catalog_id: malbec.catalog.id, region: 'Mendoza (Argentina)' })] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.deepEqual([saved.body.saved, saved.body.proposed, saved.body.skipped], [2, 1, 1]);
  const rows = s.udb.tables.user_collection.filter(r => r.metadata?.source === 'wine_list');
  assert.equal(rows.find(r => r.wine_name === 'Grand Malbec').wine_id, malbec.catalog.id);
  const myst = rows.find(r => r.wine_name === 'Reserva');
  assert.equal(myst.wine_id, null, 'a forged catalog link is ignored'); assert.equal(myst.region, 'Mendoza, Argentina', 'the Atlas region, not the typed text'); assert.equal(myst.metadata.region_source, 'Mendoza (Argentina)');
  assert.equal(myst.metadata.country, 'Argentina'); assert.equal(myst.metadata.place_status, 'mapped', 'edited place re-resolved');
  assert.equal(s.f.calls.filter(c => c[0] === 'winelens_propose_wine').length, 1);
  assert.deepEqual(s.service.tables.winelens_list_entries.map(e => e.decision).sort(), ['saved', 'saved', 'skipped']);
  assert.equal((await invoke(s.h, { action: 'commit', upload_id: body.upload.id, entries: [pick(malbec)] })).status, 409, 'no double save');
  assert.equal((await invoke(s.h, { action: 'commit', upload_id: randomUUID(), entries: [pick(malbec)] })).status, 404, 'only your own lists');
  assert.equal((await invoke(s.h, { action: 'upload', upload_id: body.upload.id })).body.entries.length, 3);
});
