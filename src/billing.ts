import { linkedAccessToken } from './device-link';
import { LINK_API_URL } from './account-config';
import defaults from '../shared/rate-card.json';
export type Feature = keyof typeof defaults.features;
export interface BillingStatus {
  pro: boolean; plan: string; tokens: number; auto_spend: boolean; scan_available: boolean;
  allowances: Record<Feature, { remaining: number; limit: number }>;
  rate_card: typeof defaults;
}
export async function accountRequest(path: 'billing' | 'wine-scan', body: Record<string, unknown>) {
  const token = await linkedAccessToken(); if (!token) throw new Error('Link your account to continue.');
  const response = await fetch(`${LINK_API_URL}/api/${path}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(path === 'wine-scan' ? 90000 : 15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Not available yet, you have not been charged.'); return data;
}
export const billingStatus = (): Promise<BillingStatus> => accountRequest('billing', { action: 'status' });
export function usageCost(state: BillingStatus, feature: Feature) {
  const allowance = state.allowances[feature];
  if (allowance.remaining > 0) return `${state.pro ? 'Included' : 'Free'} · ${allowance.remaining} of ${allowance.limit} left this month`;
  if (!state.pro) return 'Upgrade on wineLENS.com ↗';
  const tokens = (state.rate_card || defaults).features[feature].tokens;
  return `Uses ${tokens} ${tokens === 1 ? 'token' : 'tokens'} · ${state.tokens} left`;
}
