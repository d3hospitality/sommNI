const { createClient } = require('@supabase/supabase-js');
const { allowedOrigin, sessionId } = require('./device-link.cjs');
const defaults = require('../shared/accounts.json');
const UNAVAILABLE = 'Not available yet, you have not been charged.';
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function getAdmin() {
  if (process.env.SUPABASE_URL !== defaults.supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(503, UNAVAILABLE);
  return createClient(defaults.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new HttpError(503, UNAVAILABLE);
  return data;
}
async function authenticate(req, db) {
  const token = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.id || !sessionId(token)) throw new HttpError(401, 'Sign in again to continue.');
  const state = await rpc(db, 'wl_check_session', { p_user_id: data.user.id, p_session_id: sessionId(token) });
  if (state?.status !== 'active') throw new HttpError(401, 'This session has been unlinked.');
  return data.user;
}
function endpoint(work, { getDb = getAdmin, maxBytes = 4096 } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Origin');
    if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > maxBytes) throw new HttpError(400, 'Invalid request.');
      const db = getDb(), user = await authenticate(req, db);
      return res.status(200).json(await work({ req, body, db, user }));
    } catch (e) { return res.status(e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 503).json({ error: e instanceof HttpError ? e.message : UNAVAILABLE }); }
  };
}
function only(body, keys) { if (Object.keys(body).some(k => !keys.includes(k))) throw new HttpError(400, 'Unexpected request field.'); }
module.exports = { getAdmin, rpc, authenticate, endpoint, only, HttpError, UNAVAILABLE };
