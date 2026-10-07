// Study review sync on the wineLENS project (ported from sommni-api /api/study/reviews).
// POST {action:'push', events:[≤200]} → {accepted, duplicates, rejected}
// POST {action:'pull', since?}       → {events} (caller's own, oldest first, ≤1000)
// Ownership comes from the verified session and is enforced again by RLS (caller JWT).
const { endpoint, only, HttpError } = require('./service.cjs');
const { userDb } = require('./winebrary.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CARD = /^[a-z0-9_.-]{1,120}$/i;
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const MAX_BATCH = 200, MAX_FUTURE_MS = 10 * 60_000, MAX_AGE_MS = 400 * 86_400_000;
const COLUMNS = 'event_id,user_id,card_id,card_version,mode,rating,correct,occurred_at,tz_offset_min,duration_ms,device,scheduler_version';

function reviewRow(event, userId, now = Date.now()) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { error: 'not an object' };
  if (!UUID.test(event.event_id || '')) return { error: 'event_id must be a UUID' };
  if (event.user_id != null && event.user_id !== userId) return { error: 'event belongs to another account' };
  if (!CARD.test(event.card_id || '')) return { error: 'invalid card_id' };
  if (!Number.isInteger(event.card_version) || event.card_version < 1) return { error: 'invalid card_version' };
  if (!['recall', 'recognition'].includes(event.mode)) return { error: 'invalid mode' };
  const rating = event.mode === 'recall' ? event.rating : null;
  if (event.mode === 'recall' && !RATINGS.has(rating)) return { error: 'recall requires a rating' };
  if (event.mode === 'recognition' && event.rating != null) return { error: 'recognition has no rating' };
  if (event.correct != null && typeof event.correct !== 'boolean') return { error: 'invalid correct' };
  const at = Date.parse(event.occurred_at);
  if (!Number.isFinite(at) || at > now + MAX_FUTURE_MS || at < now - MAX_AGE_MS) return { error: 'occurred_at out of range' };
  if (!Number.isInteger(event.tz_offset_min) || Math.abs(event.tz_offset_min) > 840) return { error: 'invalid tz_offset_min' };
  const duration = Number.isInteger(event.duration_ms) ? event.duration_ms : 0;
  if (duration < 0 || duration > 86_400_000) return { error: 'invalid duration_ms' };
  if (!['phone', 'g2'].includes(event.device)) return { error: 'invalid device' };
  if (typeof event.scheduler_version !== 'string' || !event.scheduler_version || event.scheduler_version.length > 40) return { error: 'invalid scheduler_version' };
  return { row: { user_id: userId, event_id: event.event_id.toLowerCase(), card_id: event.card_id, card_version: event.card_version,
    mode: event.mode, rating, correct: event.correct ?? null, occurred_at: new Date(at).toISOString(),
    tz_offset_min: event.tz_offset_min, duration_ms: duration, device: event.device, scheduler_version: event.scheduler_version } };
}

function createStudyHandler({ getDb, getUserDb = userDb } = {}) {
  return endpoint(async ({ req, body, user }) => {
    const db = getUserDb(req);
    if (body.action === 'pull') {
      only(body, ['action', 'since']);
      let query = db.from('study_review_events').select(COLUMNS).eq('user_id', user.id);
      if (body.since != null) {
        if (!Number.isFinite(Date.parse(body.since))) throw new HttpError(400, 'Invalid since.');
        query = query.gte('occurred_at', new Date(body.since).toISOString());
      }
      const { data, error } = await query.order('occurred_at', { ascending: true }).order('event_id', { ascending: true }).limit(1000);
      if (error) throw new HttpError(503, 'Study service unavailable. Your reviews stay on this device.');
      return { events: data || [] };
    }
    if (body.action !== 'push') throw new HttpError(400, 'Unknown study action.');
    only(body, ['action', 'events']);
    if (!Array.isArray(body.events) || !body.events.length) throw new HttpError(400, 'events must be a non-empty array');
    if (body.events.length > MAX_BATCH) throw new HttpError(413, `Send at most ${MAX_BATCH} events per request.`);
    const rows = [], rejected = [], seen = new Set();
    for (const event of body.events) {
      const { row, error } = reviewRow(event, user.id);
      if (error) { rejected.push({ event_id: typeof event?.event_id === 'string' ? event.event_id : null, error }); continue; }
      if (!seen.has(row.event_id)) { seen.add(row.event_id); rows.push(row); }
    }
    let inserted = [];
    if (rows.length) {
      const { data, error } = await db.from('study_review_events').upsert(rows, { onConflict: 'user_id,event_id', ignoreDuplicates: true }).select('event_id');
      if (error) throw new HttpError(503, 'Study service unavailable. Your reviews stay on this device.');
      inserted = data || [];
    }
    const fresh = new Set(inserted.map(r => r.event_id));
    return { accepted: [...fresh], duplicates: rows.map(r => r.event_id).filter(id => !fresh.has(id)), rejected };
  }, { getDb, maxBytes: 256 * 1024 });
}
module.exports = { createStudyHandler, reviewRow, MAX_BATCH };
