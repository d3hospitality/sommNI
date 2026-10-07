// Winebrary, study, tasting-notes and Studio handlers against an in-memory caller-JWT client.
const { test } = require('node:test'); const assert = require('node:assert/strict'); const { randomUUID } = require('node:crypto');
const { createWinebraryHandler } = require('../server/winebrary.cjs');
const { createStudyHandler } = require('../server/study.cjs');
const { createNotesHandler, createRenderHandler } = require('../server/ai-jobs.cjs');
const { formatNotes } = require('../prompts/winelens-ai.cjs');
const { env, invoke, fixture, user } = require('./billing-helpers.cjs');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

/** Minimal PostgREST/Storage stand-in. Rows are filtered by user_id like RLS would. */
function userStore() {
  const tables = { user_collection: [], study_review_events: [] }, files = new Map();
  function from(table) {
    let op = 'select', value, filters = [], opts = {}, limit = Infinity, head = false;
    const rows = () => tables[table].filter(r => r.user_id === user.id && filters.every(([k, v, cmp]) => cmp === 'gte' ? r[k] >= v : r[k] === v));
    const run = () => {
      if (op === 'insert') { const row = { id: randomUUID(), created_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(value)) }; tables[table].push(row); return [row]; }
      if (op === 'upsert') { const fresh = value.filter(v => !tables[table].some(r => r.user_id === v.user_id && r.event_id === v.event_id)); tables[table].push(...fresh); return fresh; }
      if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(value)))); return hit; }
      if (op === 'delete') { const hit = rows(); tables[table] = tables[table].filter(r => !hit.includes(r)); return hit; }
      return rows().slice(0, limit);
    };
    const copy = rows => JSON.parse(JSON.stringify(rows)); // PostgREST returns copies, never live rows
    const q = {
      select(_c, o = {}) { head = !!o.head; return q; }, eq(k, v) { filters.push([k, v]); return q; }, gte(k, v) { filters.push([k, v, 'gte']); return q; },
      order() { return q; }, limit(n) { limit = n; return q; }, insert(v) { op = 'insert'; value = v; return q; }, update(v) { op = 'update'; value = v; return q; },
      delete() { op = 'delete'; return q; }, upsert(v, o) { op = 'upsert'; value = v; opts = o; return q; },
      maybeSingle: async () => ({ data: copy(run())[0] || null, error: null }), single: async () => { const r = copy(run()); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'no row' } }; },
      then(resolve) { const data = copy(run()); resolve(head ? { count: data.length, error: null } : { data, error: null }); },
    };
    return q;
  }
  const storage = { from: () => ({
    upload: async (path, bytes) => { files.set(path, Buffer.from(bytes)); return { error: null }; },
    createSignedUrl: async path => ({ data: files.has(path) ? { signedUrl: `https://signed.test/${path}` } : null, error: files.has(path) ? null : { message: 'missing' } }),
    createSignedUrls: async paths => ({ data: paths.map(p => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }),
    download: async path => files.has(path) ? { data: new Blob([files.get(path)], { type: 'image/png' }), error: null } : { data: null, error: { message: 'missing' } },
    list: async folder => ({ data: [...files.keys()].filter(p => p.startsWith(folder + '/')).map(p => ({ id: p, name: p.slice(folder.length + 1) })) }),
    remove: async paths => { paths.forEach(p => files.delete(p)); return { error: null }; },
  }) };
  return { db: { from, storage }, tables, files };
}
/** Service-role fake for begin/finish job with replay semantics. */
function jobs(f, { reason } = {}) {
  const store = new Map(), old = f.db.rpc;
  f.db.rpc = async (name, args) => {
    if (name === 'winelens_begin_job') {
      f.calls.push([name, args]);
      const prev = store.get(args.p_request_id);
      if (prev) return { data: prev.fingerprint !== args.p_fingerprint ? { allowed: false, reason: 'request_mismatch' } : { replayed: true, result: prev.result, status: prev.status } };
      if (reason) return { data: { allowed: false, reason } };
      const hold = { allowed: true, reservation_id: randomUUID(), source: 'allowance' };
      store.set(args.p_request_id, { fingerprint: args.p_fingerprint, result: null, status: 'reserved' }); return { data: hold };
    }
    if (name === 'winelens_finish_job') { f.calls.push([name, args]); const j = store.get(args.p_request_id); j.result = args.p_result; j.status = args.p_result ? 'committed' : 'released'; return { data: { status: j.status } }; }
    return old(name, args);
  };
  return store;
}
const setup = () => { const f = fixture(), u = userStore(); return { f, u, wb: createWinebraryHandler({ getDb: () => f.db, getUserDb: () => u.db }) }; };

test('Winebrary: add, list, notes, photo, identity change detaches photo, remove cleans storage', async () => {
  const { f, u, wb } = setup();
  const add = await invoke(wb, { action: 'add', wine_id: 'wl_test_malbec', wine_name: 'Grand Malbec', producer: 'Terrazas', vintage_state: 'year', vintage: '2017', region: 'Mendoza', country: 'Argentina', grape: 'Malbec', color: 'Red', notes: '' });
  assert.equal(add.status, 200); const id = add.body.item.id;
  assert.equal(add.body.item.vintage, 2017); assert.equal(add.body.item.wine_id, 'wl_test_malbec'); assert.equal(add.body.item.user_id, user.id); assert.equal(add.body.item.metadata.notes_source, undefined);
  assert.equal((await invoke(wb, { action: 'add', wine_name: 'X', vintage_state: 'year', vintage: '17' })).status, 400);
  assert.equal((await invoke(wb, { action: 'add', wine_name: 'X', user_id: 'someone-else' })).status, 400, 'unexpected fields refused');
  assert.equal((await invoke(wb, { action: 'list' })).body.count, 1);
  const notes = await invoke(wb, { action: 'set-notes', id, notes: 'NOSE  Plum.', notes_source: 'generated' });
  assert.equal(notes.body.item.notes, 'NOSE  Plum.'); assert.equal(notes.body.item.metadata.notes_source, 'generated');
  const up = await invoke(wb, { action: 'upload-photo', id, photo: png });
  assert.equal(up.status, 200); assert.match(up.body.draft.path, new RegExp(`^${user.id}/${id}/[0-9a-f-]+\\.png$`)); assert.equal(u.files.size, 1);
  assert.equal((await invoke(wb, { action: 'upload-photo', id, photo: 'data:image/png;base64,YmFk' })).status, 400, 'magic number checked');
  const attached = await invoke(wb, { action: 'attach-image', id, image_path: up.body.draft.path, image_source: 'photograph' });
  assert.equal(attached.body.item.metadata.image_source, 'photograph'); assert.match(attached.body.item.image_url, /^https:\/\/signed\.test\//);
  assert.equal((await invoke(wb, { action: 'attach-image', id, image_path: `someone/${id}/x.png`, image_source: 'photograph' })).status, 400);
  const same = await invoke(wb, { action: 'update', id, wine_name: 'Grand Malbec', producer: 'Terrazas', vintage_state: 'year', vintage: '2017', region: 'Mendoza, Luján', country: 'Argentina', grape: 'Malbec', color: 'Red', notes: 'NOSE  Plum.' });
  assert.equal(same.body.item.metadata.image_path, up.body.draft.path, 'region edit keeps photo'); assert.equal(same.body.item.metadata.notes_source, 'generated', 'unchanged notes keep their source');
  const changed = await invoke(wb, { action: 'update', id, wine_name: 'Grand Malbec', producer: 'Terrazas', vintage_state: 'year', vintage: '2018', color: 'Red', notes: 'Mine now.' });
  assert.equal(changed.body.image_detached, true); assert.equal(changed.body.item.metadata.image_path, undefined); assert.equal(changed.body.item.metadata.notes_source, 'user');
  assert.equal((await invoke(wb, { action: 'remove', id: randomUUID() })).status, 404);
  assert.equal((await invoke(wb, { action: 'remove', id })).status, 200); assert.equal(u.files.size, 0); assert.equal(u.tables.user_collection.length, 0);
  assert.equal((await invoke(wb, { action: 'nope' })).status, 400);
  assert.equal((await invoke(wb, { action: 'list' }, { headers: {} })).status, 401);
  assert.ok(f.calls.every(c => c[0] === 'wl_check_session'), 'Winebrary never touches billing');
});

test('Tasting notes: allowance → model → commit; replay is free; failures and refusals never reach or keep a charge', async () => {
  const { f, u, wb } = setup(); const store = jobs(f); let calls = 0, fail = false;
  const notes = { appearance: 'Deep ruby.', nose: 'Plum, violet, cocoa, graphite.', palate: 'Full Body, Ripe Tannins. Dark fruit with lift.', finish: 'Long, spiced and fresh.', story: '', confidence: 0.7 };
  const openai = { chat: { completions: { create: async req => { calls++; assert.match(req.messages[1].content, /Grand Malbec/); if (fail) throw Error('down'); return { choices: [{ message: { content: JSON.stringify(notes) } }] }; } } } };
  const h = createNotesHandler({ getDb: () => f.db, getUserDb: () => u.db, env, getOpenAI: () => openai });
  const id = (await invoke(wb, { action: 'add', wine_name: 'Grand Malbec', color: 'Red' })).body.item.id;
  const body = { collection_id: id, request_id: randomUUID() };
  const first = await invoke(h, body);
  assert.equal(first.status, 200); assert.equal(first.body.review_required, true); assert.equal(first.body.draft.text, formatNotes(notes)); assert.doesNotMatch(first.body.draft.text, /STORY/, 'empty story omitted');
  const again = await invoke(h, body); assert.equal(again.body.replayed, true); assert.equal(calls, 1);
  assert.equal(u.tables.user_collection[0].notes, null, 'notes are a draft until the user saves them');
  fail = true; const failing = { collection_id: id, request_id: randomUUID() };
  assert.equal((await invoke(h, failing)).status, 502); assert.equal(store.get(failing.request_id).status, 'released');
  assert.equal((await invoke(h, failing)).status, 409, 'failed request is not retried on replay'); assert.equal(calls, 2);
  for (const reason of ['pro_required', 'consent_required', 'token_limit']) {
    const g = fixture(); jobs(g, { reason });
    const denied = await invoke(createNotesHandler({ getDb: () => g.db, getUserDb: () => u.db, env, getOpenAI: () => openai }), { collection_id: id, request_id: randomUUID(), spend_consent: true });
    assert.equal(denied.status, 402);
  }
  assert.equal(calls, 2, 'no provider call when refused');
  assert.equal((await invoke(h, { collection_id: randomUUID(), request_id: randomUUID() })).status, 404);
  assert.equal((await invoke(createNotesHandler({ getDb: () => f.db, getUserDb: () => u.db, env: {} }), body)).status, 503);
});

test('Studio rendering: owned reference only, stored draft, refund on failure, replay re-signs without a second render', async () => {
  const { f, u, wb } = setup(); const store = jobs(f); let renders = 0, ok = true;
  const fetchImpl = async (url, init) => { renders++; assert.equal(url, 'https://api.openai.com/v1/images/edits'); assert.ok(init.body.get('image')); return { ok, json: async () => ({ data: [{ b64_json: png.split(',')[1] }] }) }; };
  const h = createRenderHandler({ getDb: () => f.db, getUserDb: () => u.db, env, fetchImpl });
  const id = (await invoke(wb, { action: 'add', wine_name: 'Grand Malbec', color: 'Red' })).body.item.id;
  const ref = (await invoke(wb, { action: 'upload-photo', id, photo: png })).body.draft.path;
  assert.equal((await invoke(h, { collection_id: id, reference_path: `${user.id}/${randomUUID()}/x.png`, request_id: randomUUID() })).status, 400);
  const body = { collection_id: id, reference_path: ref, request_id: randomUUID(), spend_consent: false };
  const res = await invoke(h, body);
  assert.equal(res.status, 200); assert.equal(res.body.draft.source, 'generated'); assert.notEqual(res.body.draft.path, ref); assert.equal(u.files.size, 2);
  const again = await invoke(h, body); assert.equal(again.body.draft.path, res.body.draft.path); assert.equal(renders, 1);
  ok = false; const failing = { ...body, request_id: randomUUID() };
  assert.equal((await invoke(h, failing)).status, 502); assert.equal(store.get(failing.request_id).status, 'released'); assert.equal(u.files.size, 2);
  const free = fixture(); jobs(free, { reason: 'pro_required' });
  const denied = await invoke(createRenderHandler({ getDb: () => free.db, getUserDb: () => u.db, env, fetchImpl }), { ...body, request_id: randomUUID() });
  assert.equal(denied.status, 402); assert.match(denied.body.error, /Pro/); assert.equal(renders, 2);
});

test('Study sync: push dedupes and rejects bad events; pull returns own events', async () => {
  const f = fixture(), u = userStore(), h = createStudyHandler({ getDb: () => f.db, getUserDb: () => u.db });
  const ev = { event_id: randomUUID(), card_id: 'grape.malbec', card_version: 1, mode: 'recall', rating: 'good', occurred_at: new Date().toISOString(), tz_offset_min: -240, duration_ms: 1200, device: 'g2', scheduler_version: 'wl-steps-v1' };
  const pushed = await invoke(h, { action: 'push', events: [ev, ev, { ...ev, event_id: 'bad' }, { ...ev, event_id: randomUUID(), user_id: 'other' }] });
  assert.deepEqual(pushed.body.accepted, [ev.event_id]); assert.equal(pushed.body.rejected.length, 2);
  assert.deepEqual((await invoke(h, { action: 'push', events: [ev] })).body.duplicates, [ev.event_id]);
  assert.equal((await invoke(h, { action: 'pull' })).body.events.length, 1);
  assert.equal((await invoke(h, { action: 'push', events: [] })).status, 400);
});
