const Stripe = require('stripe');
const card = require('../shared/rate-card.json');
const { CANONICAL_ORIGIN: canonicalOrigin } = require('./device-link.cjs');
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
// One-time purchases only: the app (owned for life, with starter tokens) and token packs. No subscriptions.
const own = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const configured = env => env.WINELENS_BILLING_ENABLED === 'true' && /^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || '') && !!env.STRIPE_WEBHOOK_SECRET;
function stripeClient(env) { return new Stripe(env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 1 }); }
async function entitlement(db, user) {
  const { data, error } = await db.from('winelens_entitlements').select('*').eq('user_id', user).maybeSingle();
  if (error) throw new HttpError(503, UNAVAILABLE); return data;
}
async function customerFor(db, stripe, user, current) {
  if (current?.customer_id) return current.customer_id;
  const customer = await stripe.customers.create({ email: user.email, metadata: { app: 'winelens', user_id: user.id } }, { idempotencyKey: `winelens-customer:${user.id}` });
  // An existing entitlement must never be downgraded by customer creation.
  const created = await db.from('winelens_entitlements').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (created.error) throw new HttpError(503, UNAVAILABLE);
  const saved = await db.from('winelens_entitlements').update({ customer_id: customer.id }).eq('user_id', user.id).is('customer_id', null);
  if (saved.error) throw new HttpError(503, UNAVAILABLE);
  const next = await entitlement(db, user.id);
  if (!next?.customer_id) throw new HttpError(503, UNAVAILABLE); return next.customer_id;
}
function createBillingHandler({ getDb, env = process.env, getStripe = () => stripeClient(env) } = {}) {
  return endpoint(async ({ body, db, user }) => {
    const keys = { status: ['action'], 'checkout-app': ['action'], 'checkout-tokens': ['action','pack'], portal: ['action'], 'auto-spend': ['action','enabled'] };
    if (!own(keys, body.action)) throw new HttpError(400, 'Unknown billing action.'); only(body, keys[body.action]);
    const state = await rpc(db, 'winelens_billing_status', { p_user: user.id });
    if (body.action === 'status') return { ...state, app: card.app, billing_available: configured(env), management_available: /^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || ''), scan_available: !!env.OPENAI_API_KEY, test_mode: /^sk_test_/.test(env.STRIPE_SECRET_KEY || '') };
    if (body.action === 'auto-spend') {
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Choose on or off.');
      if (body.enabled && !state.pro) throw new HttpError(403, 'Tokens work once you own wineLENS.');
      await rpc(db, 'winelens_auto_spend', { p_user: user.id, p_enabled: body.enabled }); return { auto_spend: body.enabled };
    }
    if (body.action === 'portal' ? !/^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || '') : !configured(env)) throw new HttpError(503, UNAVAILABLE);
    const stripe = getStripe(), current = await entitlement(db, user.id);
    if (body.action === 'portal') {
      if (!current?.customer_id) throw new HttpError(409, 'No billing account to manage yet.');
      const portal = await stripe.billingPortal.sessions.create({ customer: current.customer_id, return_url: canonicalOrigin + '/link' }); return { url: portal.url };
    }
    const app = body.action === 'checkout-app';
    if (!app && !own(card.packs, body.pack)) throw new HttpError(400, 'Choose a valid token pack.');
    if (!user.email_confirmed_at) throw new HttpError(403, 'Verify your email before checkout.');
    if (app && state.pro) throw new HttpError(409, 'You already own wineLENS. Add tokens any time.');
    if (!app && !state.pro) throw new HttpError(403, 'Tokens work once you own wineLENS. Get the app first.');
    const choice = app ? 'app' : body.pack;
    const attempt = await rpc(db, 'winelens_reserve_checkout', { p_user: user.id, p_choice: choice });
    if (attempt.choice !== choice) throw new HttpError(409, 'A different checkout is already open. Finish it or wait for it to expire.');
    if (attempt.session_id) {
      const existing = await stripe.checkout.sessions.retrieve(attempt.session_id);
      if (existing.status === 'open' && existing.url) return { url: existing.url, reused: true };
      throw new HttpError(409, 'Checkout has finished. Refresh your account before starting another.');
    }
    if (Date.parse(attempt.expires_at) < Date.now() + 31 * 60000) throw new HttpError(409, 'The pending checkout is expiring. Try again after it expires.');
    const customer = await customerFor(db, stripe, user, current);
    const metadata = { app: 'winelens', user_id: user.id, ...(app ? { purchase: 'app' } : { pack: choice }) };
    const pack = app ? null : card.packs[choice];
    const product = app
      ? { name: `wineLENS · the app + ${card.app.tokens} tokens`, description: 'Yours for life. No subscription. Tokens never expire.' }
      : { name: `wineLENS · ${pack.units} tokens`, description: '1 token = 1 wine card (bottle image, tasting notes, year and map pin). Tokens never expire.' };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer, client_reference_id: user.id, metadata,
      line_items: [{ quantity: 1, price_data: { currency: card.currency, unit_amount: app ? card.app.amount : pack.amount, product_data: product } }],
      payment_intent_data: { metadata },
      expires_at: Math.floor(Date.parse(attempt.expires_at) / 1000),
      success_url: canonicalOrigin + '/link?checkout=returned', cancel_url: canonicalOrigin + '/link?checkout=canceled',
    }, { idempotencyKey: `winelens-checkout:${attempt.id}` });
    const saved = await db.from('winelens_checkout_attempts').update({ session_id: session.id, url: session.url }).eq('user_id', user.id).eq('id', attempt.id);
    if (saved.error) throw new HttpError(503, UNAVAILABLE);
    return { url: session.url };
  }, { getDb });
}
module.exports = { createBillingHandler, stripeClient, configured };
