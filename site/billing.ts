import type { Session } from '@supabase/supabase-js';
import { API_BASE } from './site-auth';
import rateCard from '../shared/rate-card.json';
const el = (id: string) => document.getElementById(id)!;
export function accountBilling(getSession: () => Promise<Session | null>) {
  let revision = 0, savedAutoSpend = false;
  async function request(action: string, values: Record<string, unknown> = {}) {
    const session = await getSession();
    if (!session) throw new Error('Sign in to continue.');
    const response = await fetch(`${API_BASE}/api/billing`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Not available yet, you have not been charged.');
    return result;
  }
  async function refresh() {
    const rev = ++revision;
    try {
      const state = await request('status'); if (rev !== revision) return;
      el('billing-message').textContent = state.billing_available ? '' : 'Not available yet, you have not been charged.';
      el('plan-name').textContent = state.pro ? 'wineLENS Pro' : 'Free';
      el('billing-test').hidden = !state.test_mode;
      el('plan-period').textContent = state.period_end && state.pro ? `${state.cancel_at_period_end ? 'Ends' : 'Renews'} ${new Date(state.period_end).toLocaleDateString()}` : 'Your wine essentials, always free.';
      el('plan-upgrades').hidden = !!state.pro;
      el('manage-billing').hidden = !state.can_manage;
      el('token-panel').hidden = !state.pro;
      el('token-balance').textContent = `${state.tokens} tokens`;
      savedAutoSpend = !!state.auto_spend;
      (el('auto-spend') as HTMLInputElement).checked = savedAutoSpend;
      el('allowance-period').textContent = `Resets ${new Date(state.end).toLocaleDateString()}`;
      el('allowance-list').replaceChildren();
      const card = state.rate_card || rateCard;
      el('billing-home').querySelectorAll<HTMLButtonElement>('[data-plan]').forEach(b => { const plan = b.dataset.plan as keyof typeof rateCard.plans; const spec = card.plans[plan]; b.textContent = `Pro · $${spec.amount / 100}/${spec.interval}`; });
      for (const [key, feature] of Object.entries(card.features) as [string, { label: string }][]) {
        const row = document.createElement('li'); row.textContent = `${feature.label}: ${state.allowances[key].remaining} of ${state.allowances[key].limit} left`; el('allowance-list').append(row);
      }
      el('token-packs').replaceChildren();
      for (const [pack, spec] of Object.entries(state.packs || card.packs) as [string, { amount: number; units: number }][]) {
        const b = document.createElement('button'); b.className = 'button outline'; b.textContent = `$${spec.amount / 100} · ${spec.units} tokens`; b.disabled = !state.billing_available; b.addEventListener('click', () => void action('checkout-tokens', { pack })); el('token-packs').append(b);
      }
      el('token-rates').textContent = Object.values(card.features as typeof rateCard.features).map(f => `${f.label}: ${f.tokens} ${f.tokens === 1 ? 'token' : 'tokens'}`).join(' · ');
      el('billing-activity').replaceChildren();
      for (const entry of state.ledger) { const li = document.createElement('li'); li.textContent = `${new Date(entry.created_at).toLocaleDateString()} · ${entry.event} · ${entry.feature.replaceAll('_', ' ')} · ${entry.units} tokens${entry.allowance ? ` · ${entry.allowance} included` : ''}`; el('billing-activity').append(li); }
      if (!state.ledger.length) { const li = document.createElement('li'); li.textContent = 'No activity yet.'; el('billing-activity').append(li); }
      el('billing-home').querySelectorAll<HTMLButtonElement>('[data-plan]').forEach(b => b.disabled = !state.billing_available);
      (el('manage-billing') as HTMLButtonElement).disabled = !state.management_available;
      el('usage-block').hidden = false; el('activity-block').hidden = false;
    } catch (e) { if (rev === revision) { el('usage-block').hidden = true; el('activity-block').hidden = true; } if (rev === revision) el('billing-message').textContent = e instanceof Error ? e.message : 'Account usage unavailable.'; }
  }
  let busy = false;
  async function action(name: string, values = {}) {
    if (busy) return; busy = true;
    const actionRevision = revision;
    el('billing-message').textContent = 'Please wait…';
    try {
      const result = await request(name, values);
      if (actionRevision !== revision) return;
      if (result.url) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || !['checkout.stripe.com','billing.stripe.com'].includes(url.hostname)) throw new Error('Invalid billing destination.');
        location.assign(url.href);
      } else await refresh();
    } catch (e) { (el('auto-spend') as HTMLInputElement).checked = savedAutoSpend; el('billing-message').textContent = e instanceof Error ? e.message : 'Billing unavailable.'; }
    finally { busy = false; }
  }
  el('billing-home').querySelectorAll<HTMLButtonElement>('[data-plan]').forEach(b => b.addEventListener('click', () => void action('checkout-plan', { plan: b.dataset.plan })));
  el('manage-billing').addEventListener('click', () => void action('portal'));
  el('refresh-billing').addEventListener('click', () => void refresh());
  el('auto-spend').addEventListener('change', () => { const input = el('auto-spend') as HTMLInputElement; void action('auto-spend', { enabled: input.checked }); });
  return { refresh, clear() { revision++; el('token-panel').hidden = true; el('usage-block').hidden = true; el('activity-block').hidden = true; el('billing-activity').replaceChildren(); el('token-balance').textContent = ''; el('plan-name').textContent = ''; } };
}
