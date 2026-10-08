const { getAdmin, rpc, HttpError, UNAVAILABLE } = require('./service.cjs');
const { stripeClient } = require('./billing.cjs');
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
          if (obj.currency !== card.currency || obj.client_reference_id !== user) throw new HttpError(400, 'Payment does not match the account.');
          if (obj.metadata.purchase === 'app') {
            // The app: owned for life, with its starter tokens (the database checks amount + tokens against the card).
            if (obj.amount_total !== card.app.amount) throw new HttpError(400, 'App payment does not match the price.');
            await rpc(db, 'winelens_grant_app', { p_user: user, p_stripe_session: obj.id, p_amount: card.app.amount, p_tokens: card.app.tokens });
          } else {
            const pack = Object.hasOwn(card.packs, obj.metadata.pack || '') ? card.packs[obj.metadata.pack] : null;
            if (!pack || obj.amount_total !== pack.amount) throw new HttpError(400, 'Token payment does not match the pack.');
            await rpc(db, 'winelens_grant_tokens', { p_user: user, p_stripe_session: obj.id, p_pack: obj.metadata.pack, p_units: pack.units });
          }
        }
        const closed = await db.from('winelens_checkout_attempts').update({ expires_at: new Date().toISOString() }).eq('user_id', user).eq('session_id', obj.id);
        if (closed.error) throw new Error('Could not close checkout');
      }
      // Subscriptions are retired (one-time purchases only): any other event is acknowledged and ignored.
      return res.status(200).json({ received: true });
    } catch (e) { return res.status(e instanceof HttpError ? e.status : 503).json({ error: e instanceof HttpError ? e.message : 'Webhook processing unavailable. Retry delivery.' }); }
  };
}
module.exports = { createWebhookHandler, readRaw };
