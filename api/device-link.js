const { createClient } = require('@supabase/supabase-js');
const { createHandler } = require('../server/device-link.cjs');
const defaults = require('../shared/accounts.json');
module.exports = createHandler({ getClients() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Fail closed: this deployment must never operate on d3-shared.
  if (url !== defaults.supabaseUrl || !key) throw new Error('Accounts not configured');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  return { admin: createClient(url, key, options), auth: createClient(url, defaults.publishableKey, options) };
} });
