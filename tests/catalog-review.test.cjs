// Catalog review: only the owner sees suggestions; approvals are resolved and named consistently.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { createCatalogReviewHandler, catalogId } = require('../server/catalog-review.cjs');
const { invoke, fixture, user } = require('./billing-helpers.cjs');
const { memoryDb } = require('./memory-db.cjs');
const K1 = 'a'.repeat(64), K2 = 'b'.repeat(64), K3 = 'c'.repeat(64);

function setup(plan) {
  const f = fixture(), mem = memoryDb({ tables: {
    winelens_entitlements: [{ user_id: user.id, plan }],
    winelens_catalog_proposals: [
      { wine_key: K1, status: 'pending', seen: 4, created_at: '2026-10-01', wine: { producer: 'Ameztoi', wine_name: 'Txakoli Rosé', region: 'Getariako Txakolina', country: 'Spain', color: 'Rose' }, place: { status: 'unknown', region: 'Getariako Txakolina', country: 'ESP', original: 'Getariako Txakolina' } },
      { wine_key: K2, status: 'pending', seen: 1, created_at: '2026-10-02', wine: { producer: 'Gorka Izagirre', wine_name: 'Txakoli', region: 'Getariako Txakolina', country: 'Spain' }, place: { status: 'unknown', region: 'Getariako Txakolina', country: 'ESP' } },
      { wine_key: K3, status: 'approved', seen: 9, created_at: '2026-09-01', wine: { producer: 'X', wine_name: 'Y' }, place: {} }] } });
  const rpc = f.db.rpc;
  f.db.from = t => mem.from(t);
  f.db.rpc = async (name, args) => { f.calls.push([name, args]); return name === 'winelens_decide_proposal' ? { data: { status: args.p_decision, catalog_id: args.p_row?.id ?? null } } : rpc(name, args); };
  return { f, h: createCatalogReviewHandler({ getDb: () => f.db }) };
}

test('Only the owner can review catalog suggestions', async () => {
  for (const plan of ['free', 'pro']) {
    const { h } = setup(plan);
    const res = await invoke(h, { action: 'list' });
    assert.equal(res.status, 403); assert.match(res.body.error, /owner/);
  }
});

test('List: pending suggestions by popularity, and the places that still need a globe alias', async () => {
  const { h } = setup('owner');
  const res = await invoke(h, { action: 'list' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.proposals.map(p => p.wine_key), [K1, K2], 'approved ones are gone, most-saved first');
  assert.deepEqual(res.body.unknown_places, [{ region: 'Getariako Txakolina', country: 'ESP', wines: 2, seen: 5 }]);
});

test('Decide: approve with corrections (resolved place, catalog colour, stable ID) or reject', async () => {
  const { f, h } = setup('owner');
  const ok = await invoke(h, { action: 'decide', wine_key: K1, decision: 'approved', wine: { region: 'Rioja', country: 'Spain', grape: 'Hondarrabi Zuri' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const row = f.calls.find(c => c[0] === 'winelens_decide_proposal')[1].p_row;
  assert.equal(row.id, catalogId({ wine_name: 'Txakoli Rosé', producer: 'Ameztoi' }, K1)); assert.match(row.id, /^wl_txakoli-rose-ameztoi-aaaaaaaa$/);
  assert.deepEqual([row.name, row.producer, row.color, row.grape, row.country], ['Txakoli Rosé', 'Ameztoi', 'rose', 'Hondarrabi Zuri', 'Spain']);
  assert.match(row.region, /Rioja/); assert.equal(row.metadata.place_status !== 'unknown', true, 'corrected place resolves');
  assert.equal(JSON.stringify(row).includes(user.id), false, 'no account IDs in the public catalog');
  const no = await invoke(h, { action: 'decide', wine_key: K2, decision: 'rejected' });
  assert.deepEqual([no.status, no.body.status, no.body.catalog_id], [200, 'rejected', null]);
  assert.equal(f.calls.at(-1)[1].p_row, null);
  assert.equal((await invoke(h, { action: 'decide', wine_key: 'nope', decision: 'approved' })).status, 400);
  assert.equal((await invoke(h, { action: 'decide', wine_key: K1, decision: 'maybe' })).status, 400);
  assert.equal((await invoke(h, { action: 'decide', wine_key: 'd'.repeat(64), decision: 'approved' })).status, 404);
});
