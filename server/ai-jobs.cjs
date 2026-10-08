// Paid AI help for Winebrary wines: tasting notes and Studio bottle renderings.
// Both follow the label-scan money rules: allowance first, then Pro tokens with consent;
// the charge and the stored result commit together; any failure returns the allowance/tokens;
// a replayed request ID returns the stored result and never calls the provider again.
const { createHash, randomUUID } = require('node:crypto');
const OpenAI = require('openai');
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const { userDb, ownWine, ownedImagePath, signedUrl, signImages, saveRow, BUCKET, UUID } = require('./winebrary.cjs');
const { NOTES_SYSTEM, NOTES_SCHEMA, NOTE_LIMITS, formatNotes, bottlePrompt, cardPrompt, wineContext,
  SOMMELIER_SYSTEM, SOMMELIER_SCHEMA, SOMMELIER_FIELDS, SOMMELIER_COLORS, sommelierContext } = require('../prompts/winelens-ai.cjs');
const { bottleKey } = require('./wine-identity.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const REFUSALS = {
  wine_list_page: { pro_required: 'This list needs more photo pages than you have free this month. Add tokens, or paste or upload the list as text.', label: 'wine list' },
  wine_list_text: { pro_required: 'You have used this month’s free text pages. Add tokens to keep going.', label: 'wine list' },
  tasting_notes: { pro_required: 'You have used this month’s free tasting notes. Add tokens to keep going.', label: 'tasting notes' },
  studio_render: { pro_required: 'New bottle images use tokens. Add tokens from $5.', label: 'rendering' },
  wine_card: { pro_required: 'Wine cards use tokens. Add tokens from $5.', label: 'wine card' },
  sommelier: { pro_required: 'You have used this month’s free sommelier picks. Add tokens to keep going.', label: 'sommelier picks' },
};
function refuse(feature, hold) {
  const messages = { ...REFUSALS[feature], consent_required: 'Confirm token use first.', token_limit: 'Not enough tokens (or over your monthly spending limit). Add tokens from $5.',
    request_mismatch: 'This request ID was used for something else. Try again.', deleting: 'Account deletion is in progress.' };
  const status = hold.reason === 'request_mismatch' || hold.reason === 'deleting' ? 409 : 402;
  return new HttpError(status, messages[hold.reason] || UNAVAILABLE);
}
function checkRequest(body, env) {
  only(body, ['collection_id', 'request_id', 'spend_consent', ...(body.reference_path !== undefined ? ['reference_path'] : [])]);
  if (!env.OPENAI_API_KEY) throw new HttpError(503, UNAVAILABLE);
  if (!UUID.test(String(body.request_id || '')) || (body.spend_consent !== undefined && typeof body.spend_consent !== 'boolean')) throw new HttpError(400, 'Invalid request.');
}
/** Reserve, run the provider, settle. Returns { result, replayed } or throws a refund-safe HttpError. */
async function runJob({ db, user, feature, requestId, fingerprint, consent, work, onReplay, quantity = 1 }) {
  const hold = await rpc(db, 'winelens_begin_job', { p_user: user.id, p_feature: feature, p_request_id: requestId, p_fingerprint: fingerprint, p_consent: consent === true, p_quantity: quantity });
  if (hold.replayed) {
    if (hold.result) return { result: await onReplay(hold.result), replayed: true };
    if (hold.status === 'released') throw Object.assign(new HttpError(409, `That ${REFUSALS[feature].label} did not finish and was not charged. Try again.`), { released: true });
    throw new HttpError(409, `Still working on this ${REFUSALS[feature].label}. Check again in a moment.`);
  }
  if (!hold.allowed) throw Object.assign(refuse(feature, hold), { released: true });
  let result;
  try { result = await work(); }
  catch (e) {
    await rpc(db, 'winelens_finish_job', { p_user: user.id, p_request_id: requestId, p_reservation_id: hold.reservation_id, p_result: null }).catch(() => {});
    throw Object.assign(e instanceof HttpError ? e : new HttpError(502, `The ${REFUSALS[feature].label} did not finish. Your allowance or tokens were returned.`), { released: true });
  }
  // Never release after a provider success: if this response is lost, a retry reads the stored result.
  const settled = await rpc(db, 'winelens_finish_job', { p_user: user.id, p_request_id: requestId, p_reservation_id: hold.reservation_id, p_result: result.stored });
  if (settled.status !== 'committed') { await result.discard?.(); throw Object.assign(new HttpError(409, `The ${REFUSALS[feature].label} took too long. Your allowance or tokens were returned.`), { released: true }); }
  return { result: result.response, replayed: false };
}

// ── Shared notes: one paid draft per bottle + vintage (key from wine-identity.cjs) ──
const NOTE_FIELDS = ['appearance', 'nose', 'palate', 'finish', 'story', 'confidence'];
const pickNotes = n => Object.fromEntries(NOTE_FIELDS.map(k => [k, n[k]]));

function validateNotes(value) {
  if (!value || Object.keys(value).some(k => !NOTES_SCHEMA.required.includes(k))) throw new Error('Invalid notes output');
  for (const [k, max] of Object.entries(NOTE_LIMITS)) if (typeof value[k] !== 'string' || value[k].length > max) throw new Error('Invalid notes output');
  if (!value.nose.trim() || !value.palate.trim() || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('Invalid notes output');
  return { appearance: value.appearance.trim(), nose: value.nose.trim(), palate: value.palate.trim(), finish: value.finish.trim(), story: value.story.trim(), confidence: value.confidence };
}
/** One notes draft from the provider (validated). */
async function draftNotes(openai, model, wine) {
  const answer = await openai.chat.completions.create({ model, max_completion_tokens: 900,
    messages: [{ role: 'system', content: NOTES_SYSTEM }, { role: 'user', content: wineContext(wine) }],
    response_format: { type: 'json_schema', json_schema: { name: 'tasting_notes', strict: true, schema: NOTES_SCHEMA } } });
  return validateNotes(JSON.parse(answer.choices?.[0]?.message?.content || 'null'));
}
function createNotesHandler({ getDb, getUserDb = userDb, env = process.env, getOpenAI = () => new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }) } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    const model = env.WINELENS_NOTES_MODEL || 'gpt-4.1-mini';
    const draft = notes => ({ ...pickNotes(notes), text: formatNotes(notes), model });
    // Free look-up: does wineLENS already have notes for this exact bottle + vintage?
    if (body.check === true) {
      only(body, ['collection_id', 'check']);
      const bottle = bottleKey(await ownWine(getUserDb(req), user.id, body.collection_id));
      if (!bottle) return { available: false };
      const { data, error } = await db.from('winelens_shared_notes').select('status').eq('key', bottle.key).maybeSingle();
      return { available: !error && data?.status === 'ready' };
    }
    checkRequest(body, env);
    const wine = await ownWine(getUserDb(req), user.id, body.collection_id), bottle = bottleKey(wine);
    const share = (name, extra = {}) => rpc(db, name, { p_key: bottle.key, p_user: user.id, p_request_id: body.request_id, ...extra });
    if (bottle) {
      // Already drafted (by anyone, including this person): reuse it, no job, no charge.
      const claim = await share('winelens_share_claim', { p_wine: bottle.wine });
      if (claim.status === 'ready') return { draft: draft(claim.notes), shared: true, charged: false, review_required: true };
      if (claim.status === 'busy') throw new HttpError(409, 'Notes for this exact bottle and vintage are being written right now. Try again in a minute. You were not charged.');
    }
    let outcome;
    try {
      outcome = await runJob({ db, user, feature: 'tasting_notes', requestId: body.request_id, fingerprint: sha(`notes:${wine.id}:${wineContext(wine)}`), consent: body.spend_consent,
        onReplay: stored => draft(stored),
        work: async () => {
          const notes = await draftNotes(getOpenAI(), model, wine);
          return { stored: notes, response: draft(notes) };
        } });
    } catch (e) {
      // Nothing ran for this request: free the bottle so the next person can draft it.
      if (bottle && e.released) await share('winelens_share_release').catch(() => {});
      throw e;
    }
    if (bottle) await share('winelens_share_fill', { p_notes: pickNotes(outcome.result) }).catch(() => {});
    return { draft: outcome.result, replayed: outcome.replayed, shared: false, charged: !outcome.replayed, review_required: true };
  }, { getDb, maxBytes: 2048 });
}

// Studio: reference-led product rendering. The user's own photo is the source of truth; the
// rendering comes back as a private draft they must approve before it is attached to the wine.
function createRenderHandler({ getDb, getUserDb = userDb, env = process.env, fetchImpl = fetch } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    checkRequest(body, env);
    const udb = getUserDb(req), wine = await ownWine(udb, user.id, body.collection_id);
    if (!ownedImagePath(body.reference_path, user.id, wine.id)) throw new HttpError(400, 'Upload a photo of this bottle first.');
    const model = env.WINELENS_IMAGE_MODEL || IMAGE_MODEL;
    const draft = async stored => ({ path: stored.path, source: 'generated', url: await signedUrl(udb, stored.path), model: stored.model });
    const { result, replayed } = await runJob({ db, user, feature: 'studio_render', requestId: body.request_id,
      fingerprint: sha(`render:${wine.id}:${body.reference_path}`), consent: body.spend_consent, onReplay: stored => stored,
      work: async () => {
        const { data: reference, error } = await udb.storage.from(BUCKET).download(body.reference_path);
        if (error || !reference) throw new HttpError(404, 'That photo is no longer available. Upload it again. You were not charged.');
        if (reference.size > 8 * 1024 * 1024) throw new HttpError(413, 'Reference photo is too large. You were not charged.');
        const form = new FormData();
        form.set('model', model); form.set('prompt', bottlePrompt(wine));
        form.set('image', new Blob([await reference.arrayBuffer()], { type: reference.type || 'image/png' }), body.reference_path.split('/').pop());
        form.set('size', '1024x1536'); form.set('quality', 'medium'); form.set('background', 'transparent'); form.set('output_format', 'png');
        const response = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error('provider');
        const b64 = (await response.json())?.data?.[0]?.b64_json;
        if (typeof b64 !== 'string' || !b64) throw new Error('provider');
        const path = `${user.id}/${wine.id}/${randomUUID()}.png`;
        const saved = await udb.storage.from(BUCKET).upload(path, Buffer.from(b64, 'base64'), { contentType: 'image/png', upsert: false });
        if (saved.error) throw new Error('storage');
        const stored = { path, model };
        return { stored, response: stored, discard: () => udb.storage.from(BUCKET).remove([path]).catch(() => {}) };
      } });
    // Signed after the charge commits: if signing fails, a retry with the same request ID replays for free.
    return { draft: await draft(result), replayed, review_required: true };
  }, { getDb, maxBytes: 2048 });
}

// ── Wine cards: 1 token, every time ────────────────────────────────────
// A card is the owner's wine made complete: a 3D-style bottle image, tasting notes and the year,
// placed on the map from its region/country by the app. The bottle image comes from the owner's
// own label photo when there is one (private), else from the wine's details; that generated image
// is stored once per bottle + vintage and copied for every later card. Notes reuse the shared
// notes. Reuse saves the provider cost; the card is still charged (rate card v3).
const IMAGE_MODEL = 'gpt-image-2';
async function openaiImage(fetchImpl, env, url, init) {
  const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
    body: init.json ? JSON.stringify(init.json) : init.form, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('provider');
  const b64 = (await response.json())?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !b64) throw new Error('provider');
  return Buffer.from(b64, 'base64');
}
function createCardHandler({ getDb, getUserDb = userDb, env = process.env, fetchImpl = fetch, getOpenAI = () => new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }) } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    checkRequest(body, env);
    const udb = getUserDb(req), wine = await ownWine(udb, user.id, body.collection_id), bottle = bottleKey(wine);
    const imageModel = env.WINELENS_IMAGE_MODEL || IMAGE_MODEL, notesModel = env.WINELENS_NOTES_MODEL || 'gpt-4.1-mini';
    const photo = wine.metadata?.image_source === 'photograph' && ownedImagePath(wine.metadata?.image_path, user.id, wine.id) ? wine.metadata.image_path : null;
    const ownNotes = !!wine.notes?.trim();
    const claims = [];
    const releaseClaims = () => Promise.all(claims.map(([fn, key]) => rpc(db, fn, { p_key: key, p_user: user.id, p_request_id: body.request_id }).catch(() => {})));
    let outcome;
    try {
      outcome = await runJob({ db, user, feature: 'wine_card', requestId: body.request_id, fingerprint: sha(`card:${wine.id}:${wineContext(wine)}:${photo || ''}`), consent: body.spend_consent,
        onReplay: stored => stored,
        work: async () => {
          const path = `${user.id}/${wine.id}/${randomUUID()}.png`;
          let imageReused = false, sharedPath = null;
          // 1. The bottle.
          if (photo) {
            const { data: reference, error } = await udb.storage.from(BUCKET).download(photo);
            if (error || !reference) throw new HttpError(404, 'That bottle photo is no longer available. Upload it again. You were not charged.');
            const form = new FormData();
            form.set('model', imageModel); form.set('prompt', bottlePrompt(wine)); form.set('size', '1024x1536'); form.set('quality', 'medium'); form.set('background', 'transparent'); form.set('output_format', 'png');
            form.set('image', new Blob([await reference.arrayBuffer()], { type: reference.type || 'image/png' }), photo.split('/').pop());
            const png = await openaiImage(fetchImpl, env, 'https://api.openai.com/v1/images/edits', { form });
            const saved = await udb.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false });
            if (saved.error) throw new Error('storage');
          } else {
            const claim = bottle ? await rpc(db, 'winelens_bottle_claim', { p_key: bottle.key, p_user: user.id, p_request_id: body.request_id, p_wine: bottle.wine }) : null;
            if (claim?.status === 'busy') throw new HttpError(409, 'This bottle is being drawn right now for another card. Try again in a minute. You were not charged.');
            if (claim?.status === 'ready') {
              const copied = await db.storage.from(BUCKET).copy(claim.path, path);
              if (copied.error) throw new Error('storage');
              imageReused = true;
            } else {
              if (claim) claims.push(['winelens_bottle_release', bottle.key]);
              const png = await openaiImage(fetchImpl, env, 'https://api.openai.com/v1/images/generations', { json: { model: imageModel, prompt: cardPrompt(wine), size: '1024x1536', quality: 'medium', background: 'transparent', output_format: 'png', n: 1 } });
              const saved = await udb.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false });
              if (saved.error) throw new Error('storage');
              if (bottle) {
                sharedPath = `shared/${bottle.key}.png`;
                const shared = await db.storage.from(BUCKET).upload(sharedPath, png, { contentType: 'image/png', upsert: true });
                if (shared.error) sharedPath = null;
              }
            }
          }
          // 2. Notes, unless the owner wrote their own: shared when wineLENS has them, else drafted once for everyone.
          let notes = null, notesReused = false;
          if (!ownNotes) {
            const share = bottle ? await rpc(db, 'winelens_share_claim', { p_key: bottle.key, p_user: user.id, p_request_id: body.request_id, p_wine: bottle.wine }) : null;
            if (share?.status === 'ready') { notes = pickNotes(share.notes); notesReused = true; }
            else if (share?.status !== 'busy') {
              if (share) claims.push(['winelens_share_release', bottle.key]);
              notes = pickNotes(await draftNotes(getOpenAI(), notesModel, wine));
            }
          }
          const stored = { path, image_reused: imageReused, shared_path: sharedPath, notes, notes_reused: notesReused, model: imageModel };
          return { stored, response: stored, discard: () => udb.storage.from(BUCKET).remove([path]).catch(() => {}) };
        } });
    } catch (e) { if (e.released) await releaseClaims(); throw e; }
    const stored = outcome.result;
    // Charged: publish what this card drew for the next person, then attach it to the wine (a replay re-attaches).
    if (!outcome.replayed && bottle) {
      if (stored.shared_path) await rpc(db, 'winelens_bottle_fill', { p_key: bottle.key, p_user: user.id, p_request_id: body.request_id, p_path: stored.shared_path, p_model: stored.model }).catch(() => {});
      if (stored.notes && !stored.notes_reused) await rpc(db, 'winelens_share_fill', { p_key: bottle.key, p_user: user.id, p_request_id: body.request_id, p_notes: stored.notes }).catch(() => {});
    }
    const current = await ownWine(udb, user.id, wine.id);
    const keepNotes = !!current.notes?.trim() && current.metadata?.notes_source !== 'generated';
    const notesText = stored.notes && !keepNotes ? formatNotes(stored.notes) : null;
    const metadata = { ...current.metadata, image_path: stored.path, image_source: 'generated', image_reviewed_at: new Date().toISOString(), card_at: new Date().toISOString(),
      ...(notesText ? { notes_source: 'generated' } : {}) };
    const item = await saveRow(udb.from('user_collection').update({ metadata, ...(notesText ? { notes: notesText } : {}) }).eq('id', current.id).eq('user_id', user.id));
    return { item: (await signImages(udb, [item]))[0], image_reused: stored.image_reused, notes_reused: stored.notes_reused, notes_added: !!notesText, replayed: outcome.replayed, charged: !outcome.replayed };
  }, { getDb, maxBytes: 2048 });
}
// ── Find My Wine › beyond the catalog: three real wines for the brief (allowance, then 1 token) ──
const textList = (value, max, len) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || v.length > len)) throw new HttpError(400, 'Invalid request.');
  return value.map(v => v.trim()).filter(Boolean);
};
function validateSuggestions(value) {
  const wines = Array.isArray(value?.wines) ? value.wines.slice(0, 6) : [];
  const clean = wines.map(w => {
    if (!w || typeof w !== 'object' || !SOMMELIER_COLORS.includes(w.color) || !Number.isFinite(w.confidence)) return null;
    const out = { color: w.color, confidence: Math.max(0, Math.min(1, w.confidence)) };
    for (const [k, max] of Object.entries(SOMMELIER_FIELDS)) { if (typeof w[k] !== 'string') return null; out[k] = w[k].trim().slice(0, max); }
    return out.name && out.why ? out : null;
  }).filter(Boolean).slice(0, 3);
  if (!clean.length) throw new Error('Invalid sommelier output');
  return clean;
}
function createSommelierHandler({ getDb, getUserDb = userDb, env = process.env, getOpenAI = () => new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }) } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    only(body, ['request_id', 'spend_consent', 'brief', 'note', 'avoid']);
    if (!env.OPENAI_API_KEY) throw new HttpError(503, UNAVAILABLE);
    if (!UUID.test(String(body.request_id || '')) || (body.spend_consent !== undefined && typeof body.spend_consent !== 'boolean')) throw new HttpError(400, 'Invalid request.');
    if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 280)) throw new HttpError(400, 'Keep the note under 280 characters.');
    const brief = textList(body.brief, 6, 80), avoid = textList(body.avoid, 12, 120), note = (body.note || '').trim();
    if (!brief.length && !note) throw new HttpError(400, 'Answer a question or tell the sommelier what you would like.');
    // What they already keep, so the sommelier suggests something new (read with their own session).
    const { data } = await getUserDb(req).from('user_collection').select('wine_name,producer,vintage').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
    const library = (data || []).map(w => [w.producer, w.wine_name, w.vintage].filter(Boolean).join(' ').slice(0, 120));
    const model = env.WINELENS_SOMMELIER_MODEL || 'gpt-4.1-mini';
    const outcome = await runJob({ db, user, feature: 'sommelier', requestId: body.request_id, fingerprint: sha(`sommelier:${JSON.stringify({ brief, note, avoid })}`), consent: body.spend_consent,
      onReplay: stored => ({ wines: stored.wines }),
      work: async () => {
        const answer = await getOpenAI().chat.completions.create({ model, max_completion_tokens: 1200,
          messages: [{ role: 'system', content: SOMMELIER_SYSTEM }, { role: 'user', content: sommelierContext({ brief, note, avoid, library }) }],
          response_format: { type: 'json_schema', json_schema: { name: 'sommelier_picks', strict: true, schema: SOMMELIER_SCHEMA } } });
        const wines = validateSuggestions(JSON.parse(answer.choices?.[0]?.message?.content || 'null'));
        return { stored: { wines, model }, response: { wines } };
      } });
    return { wines: outcome.result.wines, replayed: outcome.replayed, charged: !outcome.replayed };
  }, { getDb, maxBytes: 4096 });
}

module.exports = { createSommelierHandler, validateSuggestions, createNotesHandler, createRenderHandler, createCardHandler, runJob, validateNotes, bottleKey, IMAGE_MODEL };
