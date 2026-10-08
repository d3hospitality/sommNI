// Winebrary: the signed-in user's private wines and bottle photos, on the wineLENS project.
// Replaces sommni-api's /api/collection + /api/bottle-image (which targeted d3-shared).
// Every query and storage call runs with the CALLER's JWT, so RLS enforces ownership;
// the service role is only used by endpoint() to verify the linked session.
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const defaults = require('../shared/accounts.json');
const { endpoint, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const BUCKET = 'winelens-bottles';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = ['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert', 'Unknown'];
const NOTE_SOURCES = ['user', 'scan', 'generated'];
const CATALOG_ID = /^(wl_[a-z0-9_-]{1,80}|w\d{1,4})$/; // canonical catalog ID (or a frozen legacy one)
const MAX_WINES = 2000, MAX_PHOTO = 2 * 1024 * 1024, SIGNED_SECONDS = 3600;

function bearer(req) { return String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1] || ''; }
function userDb(req) {
  return createClient(defaults.supabaseUrl, defaults.publishableKey, {
    global: { headers: { Authorization: `Bearer ${bearer(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
const text = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
function vintageFields(body) {
  const state = body.vintage_state ?? (body.vintage == null || body.vintage === '' ? 'unknown' : 'year');
  if (!['year', 'non_vintage', 'unknown'].includes(state)) throw new HttpError(400, 'Choose a vintage state.');
  if (state !== 'year') return { vintage: null, vintage_state: state };
  const raw = String(body.vintage ?? ''), year = Number(raw);
  if (!/^\d{4}$/.test(raw) || year < 1800 || year > new Date().getUTCFullYear() + 1) throw new HttpError(400, 'Enter a valid four-digit vintage year.');
  return { vintage: year, vintage_state: state };
}
function wineFields(body) {
  if (typeof body.wine_name !== 'string' || !body.wine_name.trim()) throw new HttpError(400, 'Wine name is required.');
  const v = vintageFields(body);
  const color = COLORS.includes(body.color) ? body.color : 'Unknown';
  if (body.notes_source !== undefined && !NOTE_SOURCES.includes(body.notes_source)) throw new HttpError(400, 'Invalid notes source.');
  return {
    wine_name: text(body.wine_name, 300), producer: text(body.producer, 200), vintage: v.vintage,
    region: text(body.region, 200), notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
    metadata: { vintage_state: v.vintage_state, country: text(body.country, 100), grape: text(body.grape, 200), color,
      ...(body.notes_source ? { notes_source: body.notes_source } : {}) },
  };
}
const WINE_KEYS = ['wine_name', 'producer', 'vintage_state', 'vintage', 'region', 'country', 'grape', 'color', 'notes', 'notes_source'];
function ownedImagePath(path, userId, collectionId) {
  return typeof path === 'string' && path.length < 200 && path.startsWith(`${userId}/${collectionId}/`) &&
    /^[a-zA-Z0-9/-]+\.(png|jpg|webp)$/.test(path) && !path.includes('..');
}
/** data:image/...;base64 → bytes, verified by magic number (never trust the declared type). */
function decodeImage(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new HttpError(400, 'Choose a PNG, JPEG or WebP photo under 2 MB.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PHOTO) throw new HttpError(413, 'Photo must be under 2 MB.');
  let ext, mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) [ext, mime] = ['png', 'image/png'];
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) [ext, mime] = ['jpg', 'image/jpeg'];
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') [ext, mime] = ['webp', 'image/webp'];
  else throw new HttpError(400, 'Photo content does not match its type.');
  return { bytes, ext, mime };
}

async function signImages(db, items) {
  const paths = items.filter(w => ownedImagePath(w.metadata?.image_path, w.user_id, w.id)).map(w => w.metadata.image_path);
  if (!paths.length) return items;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
  if (error) return items.map(w => ({ ...w, image_unavailable: Boolean(w.metadata?.image_path) }));
  const signed = new Map((data || []).filter(x => x.signedUrl && !x.error).map(x => [x.path, x.signedUrl]));
  return items.map(w => signed.has(w.metadata?.image_path) ? { ...w, image_url: signed.get(w.metadata.image_path) } : w);
}
async function signedUrl(db, path) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  if (error || !data?.signedUrl) throw new HttpError(503, 'Bottle storage is unavailable. Your wine is still saved.');
  return data.signedUrl;
}
async function ownWine(db, userId, id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'Choose a wine from your Winebrary.');
  const { data, error } = await db.from('user_collection').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw new HttpError(503, UNAVAILABLE);
  if (!data) throw new HttpError(404, 'That wine is not in your Winebrary.');
  return data;
}
async function saveRow(query) {
  const { data, error } = await query.select('*').single();
  if (error) throw new HttpError(503, 'Could not save. Your Winebrary was not changed.');
  return data;
}
const IMAGE_KEYS = ['image_path', 'image_source', 'image_reviewed_at'];
const withoutImage = metadata => Object.fromEntries(Object.entries(metadata || {}).filter(([k]) => !IMAGE_KEYS.includes(k)));

function createWinebraryHandler({ getDb, getUserDb = userDb } = {}) {
  return endpoint(async ({ req, body, user }) => {
    const db = getUserDb(req);
    switch (body.action) {
      case 'list': {
        only(body, ['action']);
        const { data, error } = await db.from('user_collection').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500);
        if (error) throw new HttpError(503, 'Could not load your Winebrary. Try again.');
        const items = await signImages(db, data || []);
        return { items, count: items.length };
      }
      case 'add': {
        only(body, ['action', 'wine_id', ...WINE_KEYS]);
        const { count, error } = await db.from('user_collection').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        if (error) throw new HttpError(503, UNAVAILABLE);
        if ((count || 0) >= MAX_WINES) throw new HttpError(409, `Your Winebrary holds up to ${MAX_WINES} wines. Remove one to add another.`);
        const wine = wineFields(body);
        const row = { user_id: user.id, wine_id: typeof body.wine_id === 'string' && CATALOG_ID.test(body.wine_id) ? body.wine_id : null, ...wine,
          metadata: { ...wine.metadata, notes_source: wine.notes ? wine.metadata.notes_source || 'user' : undefined } };
        return { item: await saveRow(db.from('user_collection').insert(row)) };
      }
      case 'update': {
        only(body, ['action', 'id', ...WINE_KEYS]);
        const old = await ownWine(db, user.id, body.id), next = wineFields(body);
        const identityChanged = ['wine_name', 'producer', 'vintage'].some(k => (old[k] ?? null) !== next[k]) ||
          (old.metadata?.vintage_state || (old.vintage ? 'year' : 'unknown')) !== next.metadata.vintage_state;
        // A new name/producer/year no longer matches the reviewed label photo: detach it.
        const base = identityChanged ? withoutImage(old.metadata) : { ...old.metadata };
        const metadata = { ...base, ...next.metadata, notes_source: next.notes ? next.metadata.notes_source || (next.notes === old.notes ? old.metadata?.notes_source : 'user') || 'user' : undefined };
        const item = await saveRow(db.from('user_collection').update({ ...next, metadata }).eq('id', old.id).eq('user_id', user.id));
        return { item: (await signImages(db, [item]))[0], image_detached: identityChanged && !!old.metadata?.image_path };
      }
      case 'set-notes': {
        only(body, ['action', 'id', 'notes', 'notes_source']);
        if (typeof body.notes !== 'string' || body.notes.length > 2000 || !NOTE_SOURCES.includes(body.notes_source)) throw new HttpError(400, 'Notes must be under 2,000 characters.');
        const old = await ownWine(db, user.id, body.id), notes = body.notes.trim() || null;
        const metadata = { ...old.metadata, notes_source: notes ? body.notes_source : undefined, notes_updated_at: new Date().toISOString() };
        const item = await saveRow(db.from('user_collection').update({ notes, metadata }).eq('id', old.id).eq('user_id', user.id));
        return { item: (await signImages(db, [item]))[0] };
      }
      case 'attach-image': {
        only(body, ['action', 'id', 'image_path', 'image_source']);
        const old = await ownWine(db, user.id, body.id);
        if (!ownedImagePath(body.image_path, user.id, old.id) || !['photograph', 'generated'].includes(body.image_source)) throw new HttpError(400, 'Invalid bottle image.');
        const metadata = { ...old.metadata, image_path: body.image_path, image_source: body.image_source, image_reviewed_at: new Date().toISOString() };
        const item = await saveRow(db.from('user_collection').update({ metadata }).eq('id', old.id).eq('user_id', user.id));
        return { item: (await signImages(db, [item]))[0] };
      }
      case 'upload-photo': {
        only(body, ['action', 'id', 'photo']);
        const wine = await ownWine(db, user.id, body.id), image = decodeImage(body.photo);
        const path = `${user.id}/${wine.id}/${randomUUID()}.${image.ext}`;
        const { error } = await db.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: false });
        if (error) throw new HttpError(503, 'Could not upload the photo. Your wine is still saved.');
        return { draft: { path, source: 'photograph', url: await signedUrl(db, path) } };
      }
      case 'remove': {
        only(body, ['action', 'id']);
        const wine = await ownWine(db, user.id, body.id);
        const { error } = await db.from('user_collection').delete().eq('id', wine.id).eq('user_id', user.id);
        if (error) throw new HttpError(503, 'Could not remove this wine. Try again.');
        // Photos and drafts for this row only; best effort (the wine is already gone).
        const folder = `${user.id}/${wine.id}`;
        const listed = await db.storage.from(BUCKET).list(folder, { limit: 100 }).catch(() => ({ data: [] }));
        const files = (listed.data || []).filter(f => f.id).map(f => `${folder}/${f.name}`);
        if (files.length) await db.storage.from(BUCKET).remove(files).catch(() => {});
        return { deleted: 1, id: wine.id };
      }
      default: throw new HttpError(400, 'Unknown Winebrary action.');
    }
  }, { getDb, maxBytes: Math.ceil(MAX_PHOTO * 4 / 3) + 4096 });
}
module.exports = { createWinebraryHandler, userDb, ownWine, ownedImagePath, decodeImage, signedUrl, signImages, saveRow, wineFields, vintageFields, BUCKET, UUID };
