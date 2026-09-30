import Stripe from 'npm:stripe@22.6.2';
import { type Admin, HttpError, setting } from './http.ts';
export function billing() {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new HttpError(503, 'Subscriptions are not available yet. You have not been charged.');
  if (!/^sk_(test|live)_/.test(key)) throw new HttpError(503, 'Billing is not configured yet.');
  return { stripe: new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 }), live: key.startsWith('sk_live_'),
    prices: { monthly: setting('STRIPE_PRICE_MONTHLY'), annual: setting('STRIPE_PRICE_ANNUAL') } };
}
export async function customerFor(db: Admin, userId: string): Promise<string | null> {
  const { data, error } = await db.from('winelens_billing_customers').select('customer_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.customer_id ?? null;
}
export async function subscriptionsFor(stripe: Stripe, customer: string | null) {
  if (!customer) return [];
  // Pagination includes canceled history, so switching plans cannot restart a trial.
  const results: Stripe.Subscription[] = [];
  for await (const subscription of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) results.push(subscription);
  return results;
}
export async function priceDetails(stripe: Stripe, ids: { monthly: string; annual: string }, live: boolean) {
  const prices = await Promise.all([stripe.prices.retrieve(ids.monthly), stripe.prices.retrieve(ids.annual)]);
  return prices.map((price, index) => {
    const interval = index ? 'year' : 'month';
    if (price.currency !== 'usd' || !price.active || price.livemode !== live || price.type !== 'recurring' || price.recurring?.interval !== interval || price.recurring.interval_count !== 1 || price.unit_amount == null || price.billing_scheme !== 'per_unit')
      throw new HttpError(503, 'Subscriptions are being configured. Please try again later.');
    return { plan: index ? 'annual' : 'monthly', amount: price.unit_amount, currency: price.currency, interval };
  });
}
