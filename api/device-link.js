const { createClient } = require('@supabase/supabase-js');
const { createHandler, LinkError } = require('../server/device-link.cjs');
const defaults = require('../shared/accounts.json');
module.exports = createHandler({ getClients() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail closed: this deployment must never operate on d3-shared.
  if (url !== defaults.supabaseUrl || !key) throw new Error('Accounts not configured');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  return { admin: createClient(url, key, options), auth: createClient(url, defaults.publishableKey, options) };
}, async beforeDelete(admin, userId) {
  const { data, error } = await admin.from('winelens_entitlements').select('subscription_id,status').eq('user_id', userId).maybeSingle();
  if (error) throw new LinkError(503, 'Could not check billing before deletion. Please try again.');
  if (data?.subscription_id && !['canceled','incomplete_expired'].includes(data.status)) throw new LinkError(409, 'Manage billing first. Account deletion is available after your subscription ends.');
} });
