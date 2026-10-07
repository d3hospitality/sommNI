// Catalog review (owner only). POST /api/catalog-review with an action:
//   list    {}                                        pending wine suggestions + places not on the globe yet
//   decide  {wine_key, decision, wine?}               approve (optionally corrected) into public.wines, or reject
// Suggestions come from wine-list saves (wine facts only). Approved wines become catalog rows with
// provenance; bundling them into the app catalog is a separate, reviewed release step.
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const { resolvePlace, norm } = require('./wine-identity.cjs');
const COLORS = ['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert', 'Unknown'];
const KEY = /^[0-9a-f]{64}$/;
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const slug = v => norm(v).replace(/ /g, '-');

async function requireOwner(db, user) {
  const { data, error } = await db.from('winelens_entitlements').select('plan').eq('user_id', user.id).maybeSingle();
  if (error) throw new HttpError(503, UNAVAILABLE);
  if (data?.plan !== 'owner') throw new HttpError(403, 'Catalog review is for the wineLENS owner.');
}
/** Catalog ID: readable, stable for the same wine (key suffix), within the app's wl_ ID pattern. */
function catalogId(wine, key) {
  const base = slug(`${wine.wine_name} ${wine.producer}`).slice(0, 68).replace(/-+$/, '');
  return `wl_${base || 'wine'}-${key.slice(0, 8)}`;
}
function placeLabel(place) {
  const status = place?.status || 'unknown';
  return { status, region: place?.region || '', country: place?.country || null, original: place?.original || '' };
}

function createCatalogReviewHandler({ getDb } = {}) {
  return endpoint(async ({ body, db, user }) => {
    await requireOwner(db, user);
    switch (body.action) {
      case 'list': {
        only(body, ['action']);
        const { data, error } = await db.from('winelens_catalog_proposals').select('wine_key,wine,place,seen,created_at').eq('status', 'pending')
          .order('seen', { ascending: false }).order('created_at', { ascending: true }).limit(200);
        if (error) throw new HttpError(503, UNAVAILABLE);
        const proposals = (data || []).map(p => ({ wine_key: p.wine_key, wine: p.wine, place: placeLabel(p.place), seen: p.seen, created_at: p.created_at }));
        // Places the resolver could not put on the globe: each one is a missing alias (shared/region-aliases.json).
        const places = new Map();
        for (const p of proposals) {
          if (p.place.status !== 'unknown' || !p.place.region) continue;
          const id = `${norm(p.place.region)}|${p.place.country || ''}`;
          const entry = places.get(id) || { region: p.place.region, country: p.place.country, wines: 0, seen: 0 };
          entry.wines++; entry.seen += p.seen; places.set(id, entry);
        }
        return { proposals, unknown_places: [...places.values()].sort((a, b) => b.seen - a.seen) };
      }
      case 'decide': {
        only(body, ['action', 'wine_key', 'decision', 'wine']);
        if (!KEY.test(String(body.wine_key || '')) || !['approved', 'rejected'].includes(body.decision)) throw new HttpError(400, 'Invalid request.');
        let row = null;
        if (body.decision === 'approved') {
          const { data: p } = await db.from('winelens_catalog_proposals').select('wine,place,status').eq('wine_key', body.wine_key).maybeSingle();
          if (!p) throw new HttpError(404, 'That suggestion no longer exists.');
          const edit = body.wine && typeof body.wine === 'object' ? body.wine : {};
          const wine = { ...p.wine, ...Object.fromEntries(Object.entries({ wine_name: str(edit.wine_name, 300), producer: str(edit.producer, 200), region: str(edit.region, 200),
            country: str(edit.country, 100), grape: str(edit.grape, 200), color: COLORS.includes(edit.color) ? edit.color : '' }).filter(([, v]) => v)) };
          if (!str(wine.wine_name, 300) || !str(wine.producer, 200)) throw new HttpError(400, 'A catalog wine needs a name and a producer.');
          const place = resolvePlace(wine.region || '', wine.country || '');
          row = { id: catalogId(wine, body.wine_key), name: str(wine.wine_name, 300), producer: str(wine.producer, 200),
            region: place.region || str(wine.region, 200), country: place.country?.name || str(wine.country, 100), grape: str(wine.grape, 200),
            color: COLORS.includes(wine.color) && wine.color !== 'Unknown' ? wine.color.toLowerCase() : '', // catalog colours are lowercase
            metadata: { place_status: place.status } };
        }
        const result = await rpc(db, 'winelens_decide_proposal', { p_key: body.wine_key, p_decision: body.decision, p_row: row });
        return { status: result.status, catalog_id: result.catalog_id ?? null, replayed: !!result.replayed };
      }
      default: throw new HttpError(400, 'Unknown review action.');
    }
  }, { getDb, maxBytes: 8192 });
}
module.exports = { createCatalogReviewHandler, catalogId };
