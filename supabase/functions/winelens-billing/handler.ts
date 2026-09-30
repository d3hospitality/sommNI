import { admin, body, handler, HttpError, rate, setting, userFor } from '../_shared/http.ts';
import { billing, customerFor, priceDetails, subscriptionsFor } from '../_shared/billing.ts';
import { subscriptionAccess } from '../_shared/policy.ts';
export const serve = handler(async req => {
  const db = admin();
  const user = await userFor(req, db);
  await rate(db, 'billing:' + user.id, 30, 60);
  const input = await body(req);
  if (!['status', 'checkout', 'portal', 'require_pro'].includes(input.action)) throw new HttpError(400, 'Unknown billing action.');
  if (input.action === 'checkout' && Deno.env.get('WINELENS_CHECKOUT_ENABLED') !== 'true')
    throw new HttpError(503, 'Subscriptions are not available yet. You have not been charged.');
  const { stripe, prices, live } = billing();
  let customer = await customerFor(db, user.id);
  const subscriptions = await subscriptionsFor(stripe, customer);
  const access = subscriptionAccess(subscriptions, Object.values(prices), live);
  if (input.action === 'require_pro') {
    if (!access.pro) throw new HttpError(402, 'wineLENS Pro is required for Bottle Studio.');
    return { pro: true, access_until: access.access_until };
  }
  const configuredTrial = Deno.env.get('WINELENS_TRIAL_DAYS') === '7' ? 7 : 0;
  const trialDays = subscriptions.length ? 0 : configuredTrial;
  if (input.action === 'status') {
    return { ...access, checkout_available: Deno.env.get('WINELENS_CHECKOUT_ENABLED') === 'true', plans: await priceDetails(stripe, prices, live), trial_days: trialDays, test_mode: !live, can_manage: !!customer };
  }
  const accountUrl = new URL(setting('WINELENS_ACCOUNT_URL'));
  if (accountUrl.protocol !== 'https:' || accountUrl.username || accountUrl.password) throw new HttpError(503, 'The account website is not configured yet.');
  if (input.action === 'portal') {
    if (!customer) throw new HttpError(409, 'There is no billing account to manage yet.');
    const portal = await stripe.billingPortal.sessions.create({ customer, return_url: accountUrl.href });
    return { url: portal.url };
  }
  if (!user.email_confirmed_at) throw new HttpError(403, 'Verify your email before subscribing.');
  if (!['monthly', 'annual'].includes(input.plan)) throw new HttpError(400, 'Choose a monthly or annual plan.');
  if (access.pro || subscriptions.some(s => !['canceled', 'incomplete_expired'].includes(s.status)))
    throw new HttpError(409, 'You already have a subscription. Use Manage billing to change it.');
  // Accept only a plan name. Never use client prices, discounts, customer IDs,
  // trial lengths, success URLs, or user IDs.
  await priceDetails(stripe, prices, live);
  if (!customer) {
    const created = await stripe.customers.create({ email: user.email, metadata: { app: 'winelens', user_id: user.id } }, { idempotencyKey: 'winelens-customer:' + user.id });
    const { error } = await db.from('winelens_billing_customers').upsert({ user_id: user.id, customer_id: created.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw error;
    customer = await customerFor(db, user.id);
    if (!customer) throw new HttpError(503, 'Could not prepare billing. Please try again.');
  }
  const { data: attempt, error } = await db.rpc('winelens_reserve_checkout', { p_user: user.id, p_plan: input.plan });
  if (error || !attempt?.attempt_id) throw new HttpError(503, 'Could not prepare checkout. Please try again.');
  if (attempt.plan !== input.plan) throw new HttpError(409, 'You already opened checkout for the other plan. Finish that checkout, or try again in 31 minutes.');
  const success = new URL(accountUrl); success.searchParams.set('checkout', 'returned');
  const canceled = new URL(accountUrl); canceled.searchParams.set('checkout', 'canceled');
  const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer,
    client_reference_id: user.id, line_items: [{ price: prices[input.plan as keyof typeof prices], quantity: 1 }],
    success_url: success.href, cancel_url: canceled.href, expires_at: Math.floor(Date.parse(attempt.expires_at) / 1000),
    payment_method_collection: 'always',
    subscription_data: { metadata: { app: 'winelens', user_id: user.id }, ...(trialDays ? { trial_period_days: trialDays } : {}) },
    metadata: { app: 'winelens', user_id: user.id },
  }, { idempotencyKey: 'winelens-checkout:' + attempt.attempt_id });
  if (!session.url || session.status !== 'open') throw new HttpError(409, 'This checkout has finished. Refresh your account to check its status.');
  return { url: session.url };
});
