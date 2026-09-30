const { createHash, createHmac, randomInt } = require('node:crypto');
const defaults = require('../shared/accounts.json');
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class LinkError extends Error { constructor(status, message) { super(message); this.status = status; } }
const digest = value => createHash('sha256').update(value).digest('hex');
const normalize = value => typeof value === 'string' && value.length <= 32 ? value.toUpperCase().replace(/[\s-]/g, '') : '';
const codeHash = code => digest(`winelens:code:${code}`);
function sessionId(token) {
  try { const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id; return UUID.test(id) ? id : null; } catch { return null; }
}
function allowedOrigin(origin) {
  if (!origin) return true; // native clients are authenticated by their credential, not CORS
  if ([defaults.canonicalOrigin, 'https://d3hospitality.github.io', 'https://hub.evenrealities.com', 'null', 'https://appassets.androidplatform.net', 'http://localhost', 'https://localhost', 'capacitor://localhost'].includes(origin)) return true;
  try { const u = new URL(origin); return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && !!u.port && u.origin === origin; } catch { return false; }
}
function networkHash(req, secret) {
  // Vercel overwrites this header; do not trust caller-supplied X-Forwarded-For.
  const address = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 80);
  return createHmac('sha256', secret).update(`winelens:network:${address}`).digest('hex');
}
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new LinkError(503, 'Account linking is temporarily unavailable. Try again.');
  const errors = { rate_limited: [429, 'Too many attempts. Try again later.'], limit_reached: [409, 'Five devices are already linked. Revoke one first.'], invalid: [404, 'Code invalid or already used. Get a new code.'], expired: [410, 'Code expired. Get a new code.'], revoked: [401, 'This device has been unlinked.'], missing: [404, 'Device or code not found.'], deleting: [409, 'Account deletion is in progress.'] };
  if (errors[data?.status] && !(name === 'wl_code_status' && data.status === 'expired')) throw new LinkError(...errors[data.status]);
  return data;
}
async function removeBottleFiles(client, userId) {
  // Storage must be deleted via its API, before deleting auth.users. Never delete storage.objects in SQL.
  const bucket = client.storage.from('winelens-bottles');
  async function clean(prefix, depth = 0) {
    if (depth > 8) throw new LinkError(503, 'Could not finish photo cleanup. Try deletion again.');
    // Delete while paging from offset zero: deleted entries must not cause skipped pages.
    for (;;) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new LinkError(503, 'Could not delete bottle photos. Try deletion again.');
      if (!data?.length) return;
      const files = data.filter(x => x.id).map(x => `${prefix}/${x.name}`);
      if (files.length) { const removed = await bucket.remove(files); if (removed.error) throw new LinkError(503, 'Could not delete bottle photos. Try deletion again.'); }
      for (const folder of data.filter(x => !x.id)) await clean(`${prefix}/${folder.name}`, depth + 1);
    }
  }
  await clean(userId);
}
function createHandler({ getClients, secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY, beforeDelete = async () => {} }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (!allowedOrigin(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return res.status(405).json({ error: 'POST only.' }); }
    let reservation, minted, clients;
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || JSON.stringify(body).length > 2048) throw new LinkError(400, 'Invalid request.');
      const action = body.action;
      if (!['issue', 'issued-status', 'redeem', 'list', 'revoke', 'unlink', 'device-status', 'delete-account'].includes(action)) throw new LinkError(400, 'Unknown action.');
      clients = getClients(); const { admin, auth } = clients;
      if (action === 'redeem') {
        const code = normalize(body.code);
        // Count ALL attempts, even malformed codes, atomically in PostgreSQL.
        const claim = await rpc(admin, 'wl_claim_code', { p_code_hash: codeHash(/^[2-9A-HJKMNP-Z]{8}$/.test(code) ? code : ''), p_network_hash: networkHash(req, secret()) });
        reservation = claim.id;
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(claim.user_id);
        if (accountError || !account?.user?.email) throw new LinkError(503, 'Could not link this account. Get a new code.');
        const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: account.user.email });
        if (linkError || !link?.properties?.hashed_token) throw new LinkError(503, 'Could not create a session. Get a new code.');
        const { data: verified, error: verifyError } = await auth.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
        minted = verified?.session;
        if (verifyError || !minted || minted.user.id !== claim.user_id || !sessionId(minted.access_token)) throw new LinkError(503, 'Could not create a session. Get a new code.');
        await rpc(admin, 'wl_finish_link', { p_id: claim.id, p_session_id: sessionId(minted.access_token) });
        return res.status(200).json({ status: 'linked', device_id: claim.id, session: { access_token: minted.access_token, refresh_token: minted.refresh_token, expires_in: minted.expires_in, expires_at: minted.expires_at, token_type: 'bearer', user: { id: minted.user.id, email: minted.user.email } } });
      }
      const token = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new LinkError(401, 'Sign in to continue.');
      const { data: verified, error } = await admin.auth.getUser(token);
      if (error || !verified?.user?.id) throw new LinkError(401, 'Sign in again to continue.');
      const user = verified.user, sid = sessionId(token);
      if (!sid) throw new LinkError(401, 'Sign in again to continue.');
      await rpc(admin, 'wl_check_session', { p_user_id: user.id, p_session_id: sid, p_allow_deleting: action === 'delete-account' });
      if (action === 'issue') {
        for (let attempt = 0; attempt < 3; attempt++) {
          const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
          const issued = await rpc(admin, 'wl_issue_code', { p_user_id: user.id, p_code_hash: codeHash(code) });
          if (issued.status === 'collision') continue;
          return res.status(200).json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, id: issued.id, expires_at: issued.expires_at });
        }
        throw new LinkError(503, 'Could not create a code. Try again.');
      }
      if (action === 'issued-status') {
        if (!UUID.test(body.id)) throw new LinkError(400, 'Invalid code identifier.');
        return res.status(200).json(await rpc(admin, 'wl_code_status', { p_user_id: user.id, p_id: body.id }));
      }
      if (action === 'list') {
        const { data, error } = await admin.from('wl_linked_devices').select('id,label,linked_at,last_seen_at').eq('user_id', user.id).is('revoked_at', null).not('linked_at', 'is', null).order('linked_at', { ascending: false });
        if (error) throw new LinkError(503, 'Could not load linked devices.');
        return res.status(200).json({ devices: data });
      }
      if (action === 'revoke' || action === 'unlink') {
        if (action === 'revoke' && !UUID.test(body.id)) throw new LinkError(400, 'Invalid device identifier.');
        await rpc(admin, 'wl_revoke_device', { p_user_id: user.id, p_id: action === 'revoke' ? body.id : null, p_session_id: action === 'unlink' ? sid : null });
        return res.status(200).json({ removed: true });
      }
      if (action === 'device-status') return res.status(200).json(await rpc(admin, 'wl_device_status', { p_user_id: user.id, p_session_id: sid }));
      if (action === 'delete-account') {
        if (body.confirm !== 'DELETE') throw new LinkError(400, 'Confirm account deletion first.');
        await beforeDelete(admin, user.id);
        await rpc(admin, 'wl_prepare_deletion', { p_user_id: user.id, p_keep_session: sid });
        await removeBottleFiles(admin, user.id);
        // Owned rows (including future study/quotas) cascade. Shared wines/ingest sources remain.
        const result = await admin.auth.admin.deleteUser(user.id);
        if (result.error) throw new LinkError(503, 'Account deletion could not finish. Please retry.');
        return res.status(200).json({ deleted: true });
      }
    } catch (error) {
      // Consume-on-claim prevents replay. Roll back newly minted sessions, never return them on failure.
      if (reservation && clients) {
        if (minted?.access_token) await clients.admin.auth.admin.signOut(minted.access_token, 'local').catch(() => {});
        try { await clients.admin.rpc('wl_abort_link', { p_id: reservation, p_session_id: minted ? sessionId(minted.access_token) : null }); } catch { /* DB outage: the reservation expires; no credential was returned. */ }
      }
      const status = error instanceof LinkError ? error.status : error instanceof SyntaxError ? 400 : 503;
      if (status === 429) res.setHeader('Retry-After', '600');
      return res.status(status).json({ error: error instanceof LinkError ? error.message : 'Account linking is temporarily unavailable. Try again.' });
    }
  };
}
module.exports = { LinkError, createHandler, normalize, codeHash, sessionId, allowedOrigin, networkHash };
