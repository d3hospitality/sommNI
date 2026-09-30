export const LINK_ERROR = 'That code is invalid or expired. Get a new code on the wineLENS website.';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/[-\s]/g, '').toUpperCase() : '';
}
export function validCode(code: string): boolean { return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code); }
export function randomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => ALPHABET[byte & 31]).join('');
}
export async function privateHash(value: string, secret: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, bytes.encode(value));
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
export type Subscription = {
  id: string; status: string; livemode: boolean; cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string }; current_period_end: number }> };
};
/** Paid access is derived from Stripe, never from profile metadata or a redirect. */
export function subscriptionAccess(subscriptions: Subscription[], prices: string[], live: boolean, now = Date.now() / 1000) {
  const matching = subscriptions.filter(s => s.livemode === live && s.items.data.some(i => prices.includes(i.price.id)));
  const current = matching.find(s => ['active', 'trialing'].includes(s.status) && s.items.data.some(i => prices.includes(i.price.id) && i.current_period_end > now));
  const until = current ? Math.max(...current.items.data.filter(i => prices.includes(i.price.id)).map(i => i.current_period_end)) : null;
  return { pro: !!current, status: current?.status ?? matching[0]?.status ?? 'free', access_until: until,
    cancel_at_period_end: current?.cancel_at_period_end ?? false };
}
