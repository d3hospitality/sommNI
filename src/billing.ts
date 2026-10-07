// ═══════════════════════════════════════════════════════════════════
// wineLENS account API (one backend: the wineLENS site's /api).
// Winebrary, study, plan/tokens and paid AI help all go through here.
// ═══════════════════════════════════════════════════════════════════
import { sessionToken, accountClient } from './device-link';
import { LINK_API_URL, SITE_URL } from './account-config';
import defaults from '../shared/rate-card.json';

export type Feature = keyof typeof defaults.features;
export type AccountPath = 'billing' | 'winebrary' | 'study' | 'wine-scan' | 'wine-notes' | 'bottle-render';
export interface BillingStatus {
  pro: boolean; plan: string; tokens: number; auto_spend: boolean; scan_available: boolean;
  allowances: Partial<Record<Feature, { remaining: number; limit: number }>>;
  rate_card: typeof defaults; end?: string;
}
export const ACCOUNT_PAGE = `${SITE_URL}/link`;
const TIMEOUTS: Partial<Record<AccountPath, number>> = { 'wine-scan': 90000, 'wine-notes': 60000, 'bottle-render': 150000, winebrary: 30000 };

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
/** What one more use of a feature costs this user right now, in words. */
export function costOf(state: BillingStatus, feature: Feature): CostState {
  const card = state.rate_card?.features?.[feature] ? state.rate_card : defaults;
  const allowance = state.allowances[feature] ?? { remaining: 0, limit: 0 };
  const tokens = card.features[feature].tokens;
  if (allowance.remaining > 0) return { allowed: true, needsConsent: false, tokens: 0, upgrade: false, short: false,
    line: `${state.pro ? 'Included with Pro' : 'Free'} · ${allowance.remaining} of ${allowance.limit} left this month` };
  if (!state.pro) return { allowed: false, needsConsent: false, tokens, upgrade: true, short: false,
    line: allowance.limit ? `You have used this month’s ${allowance.limit} free ${card.features[feature].label.toLowerCase()}. Pro includes more.` : `${card.features[feature].label} are part of wineLENS Pro.` };
  if (state.tokens < tokens) return { allowed: false, needsConsent: false, tokens, upgrade: false, short: true,
    line: `Pro allowance used. This needs ${tokens} ${tokens === 1 ? 'token' : 'tokens'}; you have ${state.tokens}.` };
  return { allowed: true, needsConsent: !state.auto_spend, tokens, upgrade: false, short: false,
    line: `Pro allowance used · uses ${tokens} ${tokens === 1 ? 'token' : 'tokens'} (${state.tokens} left)` };
}
/** Kept for older call sites: the one-line cost. */
export const usageCost = (state: BillingStatus, feature: Feature) => costOf(state, feature).line;
