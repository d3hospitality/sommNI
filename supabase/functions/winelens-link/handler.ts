import { admin, body, claimRate, handler, HttpError, rate, setting, userFor } from '../_shared/http.ts';
import { LINK_ERROR, normalizeCode, privateHash, randomCode, validCode } from '../_shared/policy.ts';
export const serve = handler(async req => {
  const db = admin();
  const input = await body(req);
  if (input.action === 'mint') {
    const user = await userFor(req, db);
    if (!user.email_confirmed_at) throw new HttpError(403, 'Verify your email before linking your glasses.');
    await rate(db, 'link-mint:' + user.id, 5, 60);
    const code = randomCode();
    const { data, error } = await db.rpc('winelens_mint_link', { p_user: user.id, p_hash: await privateHash('code:' + code, setting('SUPABASE_SERVICE_ROLE_KEY')) });
    if (error) throw error;
    return { code: code.slice(0,4) + '-' + code.slice(4), expires_at: data };
  }
  if (input.action !== 'claim') throw new HttpError(400, 'Unknown account action.');
  await claimRate(req, db);
  const code = normalizeCode(input.code);
  if (!validCode(code)) throw new HttpError(400, LINK_ERROR);
  const { data: userId, error } = await db.rpc('winelens_claim_link', { p_hash: await privateHash('code:' + code, setting('SUPABASE_SERVICE_ROLE_KEY')) });
  if (error) throw error; // DB failure cannot bypass the single-use check.
  if (!userId) throw new HttpError(400, LINK_ERROR);
  const { data: { user }, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError || !user?.email || !user.email_confirmed_at) throw new HttpError(400, LINK_ERROR);
  // Generate, never email, a one-use exchange token. The companion establishes
  // its own refreshable session using verifyOtp; no browser session is copied.
  const { data, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  if (linkError || !data.properties?.hashed_token) throw new HttpError(503, 'Please get a new code and try again.');
  return { token_hash: data.properties.hashed_token, type: 'magiclink' };
});

