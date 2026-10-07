// Wine identity: the same bottle always resolves to the same catalog wine, globe place and notes key.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { resolvePlace, resolveCountry, matchCatalog, resolveEntry, bottleKey, wineKey } = require('../server/wine-identity.cjs');
const place = (r, c = '') => { const p = resolvePlace(r, c); return [p.status, p.region, p.country?.code ?? null]; };

test('Places: every spelling lands on one point of the globe, unknown places are never guessed', () => {
  assert.deepEqual(place('Maipo Valley', 'Chile'), ['mapped', 'Valle del Maipo', 'CHL']);
  assert.deepEqual(place('Napa, CA'), ['mapped', 'Napa Valley, US', 'USA'], 'CA on a wine list is California');
  assert.deepEqual(place('Napa, CA', 'Canada'), ['mapped', 'Napa Valley, US', 'USA'], 'the place’s own country wins');
  assert.deepEqual(place('Russian River Valley AVA', 'USA'), ['mapped', 'Russian River, US', 'USA']);
  assert.deepEqual(place('Mendoza (Argentina)'), place('Mendoza, Argentina'));
  assert.deepEqual(place('Mendoza, Argentina', 'France'), ['mapped', 'Mendoza, Argentina', 'ARG'], 'a stale country field does not move the place');
  assert.equal(place("Hawkes Bay", 'New Zealand')[0], 'mapped');
  assert.equal(place('Bourgogne', 'France')[1], 'Burgundy, FR');
  assert.deepEqual(place('Valle de Uco', 'Argentina'), ['unknown', 'Valle de Uco', 'ARG']);
  assert.deepEqual(place('Somewhere Nice', 'France'), ['unknown', 'Somewhere Nice', 'FRA']);
  assert.deepEqual(place('Italia'), ['country', '', 'ITA']);
  assert.equal(resolveCountry('España').code, 'ESP'); assert.equal(resolveCountry('NZ').code, 'NZL'); assert.equal(resolveCountry('Atlantis'), null);
});

test('Catalog: exact identity, close spellings, never a different producer', () => {
  assert.equal(matchCatalog({ wine_name: 'Grand Malbec', producer: 'Terrazas de los Andes' }).kind, 'exact');
  const typo = matchCatalog({ wine_name: 'Grand Malbec', producer: 'Terazas de los Andes' });
  assert.equal(typo.kind, 'match'); assert.equal(typo.id, 'wl_grand-malbec-terrazas-de-los-andes');
  assert.equal(matchCatalog({ wine_name: 'Grand Malbec', producer: 'Some Other Winery' }), null);
});

test('Single-column lists: a known producer is peeled off either end only when it lands on its catalog wine', () => {
  for (const name of ['Terrazas de los Andes Grand Malbec', 'Grand Malbec, Terrazas de los Andes']) {
    const e = resolveEntry({ wine_name: name, producer: '', vintage: 2017 });
    assert.deepEqual([e.producer, e.wine_name, e.catalog.kind, e.region, e.place.status], ['Terrazas de los Andes', 'Grand Malbec', 'exact', 'Mendoza, Argentina', 'mapped'], name);
  }
  const other = resolveEntry({ wine_name: 'Storm Point Shiraz', producer: '', vintage: 2020 });
  assert.equal(other.producer, '', 'no producer invented'); assert.equal(other.wine_name, 'Storm Point Shiraz');
});

test('Keys: one shared-notes key per producer + wine + vintage, however it is written', () => {
  const a = bottleKey({ wine_name: 'Grand Malbec', producer: 'Terrazas de los Andes', vintage: 2017 }).key;
  assert.equal(resolveEntry({ wine_name: 'Terrazas de los Andes Grand Malbec', vintage: 2017 }).keys.bottle, a);
  assert.equal(bottleKey({ wine_name: 'GRAND MALBEC', producer: 'Terrazas de los Andes', vintage: 2017 }).key, a);
  assert.notEqual(bottleKey({ wine_name: 'Grand Malbec', producer: 'Terrazas de los Andes', vintage: 2018 }).key, a);
  assert.notEqual(bottleKey({ wine_name: 'Grand Malbec', producer: 'Terrazas de los Andes', vintage_state: 'non_vintage' }).key, a);
  assert.equal(bottleKey({ wine_name: 'Reserva', producer: '' }), null, 'no producer: too ambiguous to share');
  assert.equal(wineKey({ wine_name: 'Grand Malbec', producer: 'Terrazas de los Andes' }), wineKey({ wine_name: 'Grand Malbec', producer: 'terrazas de los andes', vintage: 1999 }));
});
