// Paid AI help for Winebrary wines: tasting notes and Studio bottle renderings.
// Both follow the label-scan money rules: allowance first, then Pro tokens with consent;
// the charge and the stored result commit together; any failure returns the allowance/tokens;
// a replayed request ID returns the stored result and never calls the provider again.
const { createHash, randomUUID } = require('node:crypto');
const OpenAI = require('openai');
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const { userDb, ownWine, ownedImagePath, signedUrl, BUCKET, UUID } = require('./winebrary.cjs');
const { NOTES_SYSTEM, NOTES_SCHEMA, NOTE_LIMITS, formatNotes, bottlePrompt, wineContext } = require('../prompts/winelens-ai.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const REFUSALS = {
  tasting_notes: { pro_required: 'You have used this month’s free tasting notes. Upgrade to Pro for more.', label: 'tasting notes' },
  studio_render: { pro_required: 'Studio renderings are part of wineLENS Pro.', label: 'rendering' },
};
function refuse(feature, hold) {
  const messages = { ...REFUSALS[feature], consent_required: 'Confirm token use first.', token_limit: 'Your token balance or monthly spending limit is too low.',
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
async function runJob({ db, user, feature, requestId, fingerprint, consent, work, onReplay }) {
  const hold = await rpc(db, 'winelens_begin_job', { p_user: user.id, p_feature: feature, p_request_id: requestId, p_fingerprint: fingerprint, p_consent: consent === true });
  if (hold.replayed) {
    if (hold.result) return { result: await onReplay(hold.result), replayed: true };
    if (hold.status === 'released') throw new HttpError(409, `That ${REFUSALS[feature].label} did not finish and was not charged. Try again.`);
    throw new HttpError(409, `Still working on this ${REFUSALS[feature].label}. Check again in a moment.`);
  }
  if (!hold.allowed) throw refuse(feature, hold);
  let result;
  try { result = await work(); }
  catch (e) {
    await rpc(db, 'winelens_finish_job', { p_user: user.id, p_request_id: requestId, p_reservation_id: hold.reservation_id, p_result: null }).catch(() => {});
    throw e instanceof HttpError ? e : new HttpError(502, `The ${REFUSALS[feature].label} did not finish. Your allowance or tokens were returned.`);
  }
  // Never release after a provider success: if this response is lost, a retry reads the stored result.
  const settled = await rpc(db, 'winelens_finish_job', { p_user: user.id, p_request_id: requestId, p_reservation_id: hold.reservation_id, p_result: result.stored });
  if (settled.status !== 'committed') { await result.discard?.(); throw new HttpError(409, `The ${REFUSALS[feature].label} took too long. Your allowance or tokens were returned.`); }
  return { result: result.response, replayed: false };
}

function validateNotes(value) {
  if (!value || Object.keys(value).some(k => !NOTES_SCHEMA.required.includes(k))) throw new Error('Invalid notes output');
  for (const [k, max] of Object.entries(NOTE_LIMITS)) if (typeof value[k] !== 'string' || value[k].length > max) throw new Error('Invalid notes output');
  if (!value.nose.trim() || !value.palate.trim() || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error('Invalid notes output');
  return { appearance: value.appearance.trim(), nose: value.nose.trim(), palate: value.palate.trim(), finish: value.finish.trim(), story: value.story.trim(), confidence: value.confidence };
}
function createNotesHandler({ getDb, getUserDb = userDb, env = process.env, getOpenAI = () => new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 }) } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    checkRequest(body, env);
    const wine = await ownWine(getUserDb(req), user.id, body.collection_id);
    const context = wineContext(wine), model = env.WINELENS_NOTES_MODEL || 'gpt-4.1-mini';
    const draft = notes => ({ ...notes, text: formatNotes(notes), model });
    const { result, replayed } = await runJob({ db, user, feature: 'tasting_notes', requestId: body.request_id, fingerprint: sha(`notes:${wine.id}:${context}`), consent: body.spend_consent,
      onReplay: stored => draft(stored),
      work: async () => {
        const answer = await getOpenAI().chat.completions.create({ model, max_completion_tokens: 900,
          messages: [{ role: 'system', content: NOTES_SYSTEM }, { role: 'user', content: context }],
          response_format: { type: 'json_schema', json_schema: { name: 'tasting_notes', strict: true, schema: NOTES_SCHEMA } } });
        const notes = validateNotes(JSON.parse(answer.choices?.[0]?.message?.content || 'null'));
        return { stored: notes, response: draft(notes) };
      } });
    return { draft: result, replayed, review_required: true };
  }, { getDb, maxBytes: 2048 });
}

// Studio: reference-led product rendering. The user's own photo is the source of truth; the
// rendering comes back as a private draft they must approve before it is attached to the wine.
function createRenderHandler({ getDb, getUserDb = userDb, env = process.env, fetchImpl = fetch } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    checkRequest(body, env);
    const udb = getUserDb(req), wine = await ownWine(udb, user.id, body.collection_id);
    if (!ownedImagePath(body.reference_path, user.id, wine.id)) throw new HttpError(400, 'Upload a photo of this bottle first.');
    const model = env.WINELENS_IMAGE_MODEL || 'gpt-image-2.5-flare';
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
module.exports = { createNotesHandler, createRenderHandler, runJob, validateNotes };
