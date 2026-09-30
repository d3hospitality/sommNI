const { getAdmin, rpc, HttpError, UNAVAILABLE } = require('./service.cjs');
const { stripeClient, prices, validatePrice } = require('./billing.cjs');
const card = require('../shared/rate-card.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readRaw(req) {
  // Do not invoke a platform's lazy req.body JSON parser before reading bytes.
  const supplied = Object.getOwnPropertyDescriptor(req, 'body')?.value;
  if (Buffer.isBuffer(supplied)) { if (supplied.length > 1048576) throw new HttpError(413, 'Webhook too large.'); return supplied; }
  const chunks = []; let size = 0;
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > 1048576) throw new HttpError(413, 'Webhook too large.'); chunks.push(b); }
  return Buffer.concat(chunks);
}
function createWebhookHandler({ getDb = getAdmin, env = process.env, getStripe = () => stripeClient(env) } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return res.status(503).json({ error: UNAVAILABLE });
    try {
      const stripe = getStripe(); let event;
      try { event = stripe.webhooks.constructEvent(await readRaw(req), req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET); }
      catch { throw new HttpError(400, 'Invalid webhook signature.'); }
      const obj = event.data.object;
      if (obj.metadata?.app !== 'winelens') return res.status(200).json({ ignored: true });
      if (event.livemode !== env.STRIPE_SECRET_KEY.startsWith('sk_live_')) throw new HttpError(400, 'Webhook mode mismatch.');
      const user = obj.metadata.user_id;
      if (!UUID.test(user)) throw new HttpError(400, 'Invalid account metadata.');
      const db = getDb();
      if (['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
        if (obj.mode === 'payment' && obj.payment_status === 'paid') {
          const pack = Object.hasOwn(card.packs, obj.metadata.pack || '') ? card.packs[obj.metadata.pack] : null;
          if (!pack || obj.amount_total !== pack.amount || obj.currency !== card.currency || obj.client_reference_id !== user) throw new HttpError(400, 'Token payment does not match the pack.');
          await rpc(db, 'winelens_grant_tokens', { p_user: user, p_stripe_session: obj.id, p_pack: obj.metadata.pack, p_units: pack.units });
        }
        const closed = await db.from('winelens_checkout_attempts').update({ expires_at: new Date().toISOString() }).eq('user_id', user).eq('session_id', obj.id);
        if (closed.error) throw new Error('Could not close checkout');
      } else if (['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) {
        // Read current state for out-of-order updates, use deletion tombstone directly.
        const sub = event.type.endsWith('.deleted') ? obj : await stripe.subscriptions.retrieve(obj.id);
        if (sub.metadata?.app !== 'winelens' || sub.metadata.user_id !== user || sub.livemode !== event.livemode) throw new HttpError(400, 'Subscription metadata mismatch.');
        const item = sub.items?.data?.[0];
        if (sub.items?.data?.length !== 1 || !Object.values(prices(env)).filter(Boolean).includes(item?.price?.id) || item.quantity !== 1) throw new HttpError(400, 'Unexpected subscription price.');
        const plan = Object.keys(prices(env)).find(plan => prices(env)[plan] === item.price.id);
        const price = await stripe.prices.retrieve(item.price.id);
        // Retired prices must still be able to deliver a cancellation tombstone.
        validatePrice(sub.status === 'canceled' ? { ...price, active: true } : price, plan, env);
        const start = item.current_period_start || sub.current_period_start, end = item.current_period_end || sub.current_period_end;
        if (!start || !end || start >= end) throw new HttpError(400, 'Invalid subscription period.');
        await rpc(db, 'winelens_sync_subscription', { p_user: user, p_event_created: event.created, p_event_id: event.id,
          p_subscription: { id: sub.id, status: sub.status, price: item.price.id, customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id, created: sub.created, start: new Date(start*1000).toISOString(), end: new Date(end*1000).toISOString(), cancel_at_period_end: !!sub.cancel_at_period_end } });
      }
      return res.status(200).json({ received: true });
    } catch (e) { return res.status(e instanceof HttpError ? e.status : 503).json({ error: e instanceof HttpError ? e.message : 'Webhook processing unavailable. Retry delivery.' }); }
  };
}
module.exports = { createWebhookHandler, readRaw };
