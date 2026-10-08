// ═══════════════════════════════════════════════════════════════════
// wineLENS account API (one backend: the wineLENS site's /api).
// Winebrary, study, plan/tokens and paid AI help all go through here.
// ═══════════════════════════════════════════════════════════════════
import { sessionToken, accountClient } from './device-link';
import { LINK_API_URL, SITE_URL } from './account-config';
import defaults from '../shared/rate-card.json';

export type Feature = keyof typeof defaults.features;
export type AccountPath = 'billing' | 'winebrary' | 'study' | 'wine-scan' | 'wine-notes' | 'bottle-render' | 'wine-card' | 'wine-list' | 'catalog-review' | 'sommelier';
export interface BillingStatus {
  pro: boolean; plan: string; tokens: number; auto_spend: boolean; scan_available: boolean;
  allowances: Partial<Record<Feature, { remaining: number; limit: number }>>;
  rate_card: typeof defaults; end?: string; welcome?: { tokens: number };
}
export const ACCOUNT_PAGE = `${SITE_URL}/link`;
const TIMEOUTS: Partial<Record<AccountPath, number>> = { 'wine-scan': 90000, 'wine-notes': 60000, 'bottle-render': 150000, 'wine-card': 180000, 'wine-list': 240000, sommelier: 60000, winebrary: 30000, 'catalog-review': 30000 };

/** status is undefined when the response never arrived (offline/timeout): the only case a paid request may be retried with the same ID. */
export class AccountError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
let onSignedOut: () => void = () => {};
export function whenSessionEnds(handler: () => void) { onSignedOut = handler; }

export async function accountRequest(path: AccountPath, body: Record<string, unknown>): Promise<any> {
  const token = await sessionToken();
  if (!token) throw new AccountError('Link your account to continue.', 401);
  let response: Response;
  try {
    response = await fetch(`${LINK_API_URL}/api/${path}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUTS[path] ?? 15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new AccountError('No connection. Nothing was charged; try again when you are online.'); }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { await accountClient().auth.signOut({ scope: 'local' }).catch(() => {}); onSignedOut(); }
  if (!response.ok) throw new AccountError(data.error || 'Not available yet. You have not been charged.', response.status);
  return data;
}
export const billingStatus = (): Promise<BillingStatus> => accountRequest('billing', { action: 'status' });

/** A paid request keeps its ID only while the answer may still be on its way (lost response → free replay). */
export function requestIds() {
  let id = crypto.randomUUID();
  return { get current() { return id; }, settle(error?: unknown) { if (!(error instanceof AccountError) || error.status !== undefined) id = crypto.randomUUID(); } };
}

export interface CostState { allowed: boolean; needsConsent: boolean; tokens: number; line: string; upgrade: boolean; short: boolean }
/** The smallest token pack, e.g. "Tokens from $5 (20 wine cards)". */
export function packOffer(state?: Pick<BillingStatus, 'rate_card'> | null): string {
  const packs = Object.values((state?.rate_card ?? defaults).packs).sort((a, b) => a.amount - b.amount);
  return `Tokens from $${packs[0].amount / 100} (${packs[0].units} wine cards)`;
}
/**
 * What `quantity` uses of a feature (e.g. pages of a wine list) cost this user right now, in words.
 * Mirrors winelens_reserve_usage: the monthly allowance covers what it can, the rest is tokens per
 * use. The app is free; tokens are prepaid, so anyone holding them can spend them, and buying any
 * pack unlocks the larger allowances for life ("pro").
 */
export function costOf(state: BillingStatus, feature: Feature, quantity = 1): CostState {
  const card = state.rate_card?.features?.[feature] ? state.rate_card : defaults;
  const allowance = state.allowances[feature] ?? { remaining: 0, limit: 0 };
  const per = card.features[feature].tokens, label = card.features[feature].label.toLowerCase(), plan = state.pro ? 'Included with wineLENS' : 'Free';
  const included = Math.min(allowance.remaining, quantity), tokens = (quantity - included) * per;
  const word = (n: number) => `${n} ${n === 1 ? 'token' : 'tokens'}`, unit = (n: number) => n === 1 ? label.replace(/s$/, '') : label;
  if (!tokens) return { allowed: true, needsConsent: false, tokens: 0, upgrade: false, short: false,
    line: quantity === 1 ? `${plan} · ${allowance.remaining} of ${allowance.limit} left this month` : `${plan} · uses ${quantity} of your ${allowance.remaining} left this month` };
  const head = included ? `${included} included, then` : allowance.limit ? 'Monthly allowance used ·' : '';
  if (state.tokens < tokens) {
    // Not enough tokens. Before any purchase, say that a pack also unlocks the larger allowances.
    const unlock = state.pro ? '' : ' Any pack also unlocks more free help every month.';
    return { allowed: false, needsConsent: false, tokens, upgrade: !state.pro, short: true,
      line: !allowance.limit && !state.tokens ? `${card.features[feature].label} use 1 token each. ${packOffer(state)}.${unlock}`
        : `${included ? `${included} included; the rest` : allowance.limit ? `This month’s ${allowance.limit} free ${unit(allowance.limit)} are used; this` : 'This'} needs ${word(tokens)}, and you have ${state.tokens}. ${packOffer(state)}.${unlock}` };
  }
  return { allowed: true, needsConsent: !state.auto_spend, tokens, upgrade: false, short: false,
    line: `${head ? head + ' ' : ''}uses ${word(tokens)} (${state.tokens} left)`.replace(/^uses/, 'Uses') };
}
/** Kept for older call sites: the one-line cost. */
export const usageCost = (state: BillingStatus, feature: Feature) => costOf(state, feature).line;
