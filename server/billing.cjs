const Stripe = require('stripe');
const card = require('../shared/rate-card.json');
const { canonicalOrigin } = require('../shared/accounts.json');
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);
const own = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const prices = env => ({ monthly: env.STRIPE_PRICE_PRO_MONTHLY, annual: env.STRIPE_PRICE_PRO_ANNUAL });
const configured = env => env.WINELENS_BILLING_ENABLED === 'true' && /^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || '') && Object.values(prices(env)).every(Boolean) && !!env.STRIPE_WEBHOOK_SECRET;
function stripeClient(env) { return new Stripe(env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 1 }); }
function validatePrice(price, plan, env) {
  const spec = card.plans[plan];
  if (!spec || price.id !== prices(env)[plan] || price.active !== true || price.livemode !== env.STRIPE_SECRET_KEY.startsWith('sk_live_') || price.type !== 'recurring' || price.currency !== card.currency || price.unit_amount !== spec.amount || price.billing_scheme !== 'per_unit' || price.recurring?.interval !== spec.interval || price.recurring?.interval_count !== 1 || price.transform_quantity) throw new HttpError(503, UNAVAILABLE);
  return price;
}
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
    const keys = { status: ['action'], 'checkout-plan': ['action','plan'], 'checkout-tokens': ['action','pack'], portal: ['action'], 'auto-spend': ['action','enabled'] };
    if (!own(keys, body.action)) throw new HttpError(400, 'Unknown billing action.'); only(body, keys[body.action]);
    const state = await rpc(db, 'winelens_billing_status', { p_user: user.id });
    if (body.action === 'status') return { ...state, billing_available: configured(env), management_available: /^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || ''), scan_available: !!env.OPENAI_API_KEY, test_mode: /^sk_test_/.test(env.STRIPE_SECRET_KEY || '') };
    if (body.action === 'auto-spend') {
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Choose on or off.');
      if (body.enabled && !state.pro) throw new HttpError(403, 'Pro is required to spend tokens.');
      await rpc(db, 'winelens_auto_spend', { p_user: user.id, p_enabled: body.enabled }); return { auto_spend: body.enabled };
    }
    if (body.action === 'portal' ? !/^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY || '') : !configured(env)) throw new HttpError(503, UNAVAILABLE);
    const stripe = getStripe(), current = await entitlement(db, user.id);
    if (body.action === 'portal') {
      if (!current?.customer_id) throw new HttpError(409, 'No billing account to manage yet.');
      const portal = await stripe.billingPortal.sessions.create({ customer: current.customer_id, return_url: canonicalOrigin + '/link' }); return { url: portal.url };
    }
    const planCheckout = body.action === 'checkout-plan';
    if (planCheckout ? !own(card.plans, body.plan) : !own(card.packs, body.pack)) throw new HttpError(400, 'Choose a valid plan or token pack.');
    if (!user.email_confirmed_at) throw new HttpError(403, 'Verify your email before checkout.');
    if (!planCheckout && !state.pro) throw new HttpError(403, 'Tokens add to wineLENS Pro. Start a plan first.');
    if (planCheckout && (state.pro || LIVE_STATUSES.has(current?.status))) throw new HttpError(409, 'You already have a subscription. Use Manage billing.');
    if (planCheckout) await Promise.all(Object.keys(card.plans).map(async plan => validatePrice(await stripe.prices.retrieve(prices(env)[plan]), plan, env)));
    const customer = await customerFor(db, stripe, user, current);
    if (planCheckout) {
      // Paginate all history. No trial is offered, so cancellation cannot restart one.
      for await (const sub of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
        if ((sub.metadata?.app === 'winelens' || sub.items?.data?.some(item => Object.values(prices(env)).includes(item.price?.id))) && LIVE_STATUSES.has(sub.status)) throw new HttpError(409, 'You already have a subscription. Use Manage billing.');
      }
    }
    const choice = planCheckout ? body.plan : body.pack;
    const attempt = await rpc(db, 'winelens_reserve_checkout', { p_user: user.id, p_choice: choice });
    if (attempt.choice !== choice) throw new HttpError(409, 'A different checkout is already open. Finish it or wait for it to expire.');
    if (attempt.session_id) {
      const existing = await stripe.checkout.sessions.retrieve(attempt.session_id);
      if (existing.status === 'open' && existing.url) return { url: existing.url, reused: true };
      throw new HttpError(409, 'Checkout has finished. Refresh your account before starting another.');
    }
    if (Date.parse(attempt.expires_at) < Date.now() + 31 * 60000) throw new HttpError(409, 'The pending checkout is expiring. Try again after it expires.');
    const metadata = { app: 'winelens', user_id: user.id, ...(planCheckout ? {} : { pack: choice }) };
    const pack = card.packs[choice];
    const session = await stripe.checkout.sessions.create({
      mode: planCheckout ? 'subscription' : 'payment', customer, client_reference_id: user.id, metadata,
      line_items: [{ quantity: 1, ...(planCheckout ? { price: prices(env)[choice] } : { price_data: { currency: card.currency, unit_amount: pack.amount, product_data: { name: `wineLENS · ${pack.units} tokens`, description: 'Use after Pro allowances, with consent. Tokens never expire.' } } }) }],
      ...(planCheckout ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      expires_at: Math.floor(Date.parse(attempt.expires_at) / 1000),
      success_url: canonicalOrigin + '/link?checkout=returned', cancel_url: canonicalOrigin + '/link?checkout=canceled',
    }, { idempotencyKey: `winelens-checkout:${attempt.id}` });
    const saved = await db.from('winelens_checkout_attempts').update({ session_id: session.id, url: session.url }).eq('user_id', user.id).eq('id', attempt.id);
    if (saved.error) throw new HttpError(503, UNAVAILABLE);
    return { url: session.url };
  }, { getDb });
}
module.exports = { createBillingHandler, validatePrice, LIVE_STATUSES, stripeClient, prices, configured };
