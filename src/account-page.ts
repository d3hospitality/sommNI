import './account-page.css';
import { account, accountAction, embeddedHost } from './account-client';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from './account-config';
import type { Session } from '@supabase/supabase-js';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let userId: string | null = null;
let revision = 0;
let expiresAt = 0;
let working = false;
function feedback(message: string) { el('feedback').textContent = message; }
async function run(button: HTMLButtonElement, task: () => Promise<void>) {
  if (working) return;
  const epoch = revision; working = true; button.disabled = true;
  feedback('');
  try { await task(); } catch (e) { if (epoch === revision) feedback(e instanceof Error ? e.message : 'Please try again.'); }
  finally { working = false; if (button.isConnected) button.disabled = false; }
}
function clearCode() { expiresAt = 0; el('code').textContent = '— — — —'; el('expiry').textContent = 'Your code will appear here.'; }
function clearBilling() { el('plan-badge').textContent = 'CHECKING'; el('billing-status').textContent = 'Checking your membership…'; el('plans').replaceChildren(); el('manage').hidden = true; el('trial').textContent = ''; }
interface BillingState { checkout_available: boolean; pro: boolean; status: string; access_until: number | null; cancel_at_period_end: boolean; trial_days: number; test_mode: boolean; can_manage: boolean; plans: {plan: string; amount: number; currency: string; interval: string}[] }
async function refreshBilling() {
  const epoch = revision; clearBilling();
  try {
    const state = await accountAction<BillingState>('billing', { action: 'status' });
    if (epoch !== revision) return;
    el('plan-badge').textContent = state.test_mode ? 'TEST MODE' : state.pro ? 'PRO' : 'FREE';
    const through = state.access_until ? new Date(state.access_until * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    el('billing-status').textContent = state.test_mode ? 'Billing is in test mode. No real payment will be taken.' : state.pro ? `Pro ${state.status === 'trialing' ? 'trial' : 'access'} ${state.cancel_at_period_end ? 'ends' : 'renews'} ${through}.` : ['past_due', 'unpaid', 'incomplete', 'paused'].includes(state.status) ? 'Your subscription needs attention. Manage billing to restore Pro.' : 'Your free account is ready. Choose a plan when you want to go further.';
    el('manage').hidden = !state.can_manage;
    if (!state.pro && !state.checkout_available && state.status === 'free') el('billing-status').textContent = 'Your free account is ready. New subscriptions are not available yet.';
    // An existing subscription must be changed through the customer portal.
    if (state.checkout_available && !state.pro && !['past_due', 'unpaid', 'incomplete', 'paused'].includes(state.status)) {
      for (const plan of state.plans) {
        const button = document.createElement('button'); button.className = 'plan-option'; button.dataset.plan = plan.plan;
        const label = document.createElement('span'); label.textContent = plan.plan === 'annual' ? 'BILLED YEARLY ↗' : 'BILLED MONTHLY ↗';
        const amount = document.createElement('strong'); amount.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.amount / 100);
        const interval = document.createElement('small'); interval.textContent = ' / ' + plan.interval;
        button.append(label, amount, interval); el('plans').append(button);
        button.addEventListener('click', () => run(button, async () => {
          const { url } = await accountAction<{url: string}>('billing', { action: 'checkout', plan: plan.plan });
          if (epoch === revision) stripeRedirect(url, 'checkout.stripe.com');
        }));
      }
      el('trial').textContent = state.trial_days ? `${state.trial_days} days free for eligible new subscribers. A payment method is required; the selected plan renews automatically after the trial unless canceled.` : 'Subscriptions renew automatically. Cancel through Manage billing.';
    }
  } catch (e) {
    if (epoch !== revision) return;
    el('plan-badge').textContent = 'UNAVAILABLE'; el('billing-status').textContent = e instanceof Error ? e.message : 'Could not check your membership. Please try again.';
  }
}
function stripeRedirect(value: string, hostname: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== hostname) throw new Error('Could not open secure billing. Please try again.');
  location.assign(url.href);
}
function updateSession(session: Session | null) {
  const next = session?.user.id || null;
  if (next === userId) return;
  revision++; userId = next; feedback(''); clearCode(); clearBilling();
  el('signin').hidden = !!next; el('dashboard').hidden = !next; el('signout').hidden = !next;
  el('identity').textContent = session?.user.email || '';
  if (next) setTimeout(() => void refreshBilling(), 0); // Never await auth within its callback.
}
el<HTMLButtonElement>('google').addEventListener('click', e => run(e.currentTarget as HTMLButtonElement, async () => {
  if (embeddedHost()) throw new Error('Open this page in Safari or Chrome to sign in with Google.');
  const { error } = await account.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL('account.html', location.href).href } });
  if (error) throw error;
}));
el<HTMLFormElement>('email-form').addEventListener('submit', e => {
  e.preventDefault(); void run(el('email-form').querySelector('button')!, async () => {
    const { error } = await account.auth.signInWithOtp({ email: el<HTMLInputElement>('email').value.trim(), options: { emailRedirectTo: new URL('account.html', location.href).href } });
    if (error) throw error; feedback('Check your email. Open the sign-in link in this browser to finish.');
  });
});
el<HTMLButtonElement>('mint').addEventListener('click', e => run(e.currentTarget as HTMLButtonElement, async () => {
  const epoch = revision; clearCode();
  const result = await accountAction<{code: string; expires_at: string}>('link', { action: 'mint' });
  if (epoch !== revision) return;
  expiresAt = Date.parse(result.expires_at); el('code').textContent = result.code; el('mint').textContent = 'Get a new code ↗'; tick();
}));
el<HTMLButtonElement>('manage').addEventListener('click', e => run(e.currentTarget as HTMLButtonElement, async () => {
  const epoch = revision; const { url } = await accountAction<{url: string}>('billing', { action: 'portal' });
  if (epoch === revision) stripeRedirect(url, 'billing.stripe.com');
}));
el<HTMLButtonElement>('refresh-billing').addEventListener('click', e => run(e.currentTarget as HTMLButtonElement, refreshBilling));
el<HTMLButtonElement>('signout').addEventListener('click', e => run(e.currentTarget as HTMLButtonElement, async () => {
  const { error } = await account.auth.signOut({ scope: 'local' }); if (error) throw error;
}));
function tick() {
  if (!expiresAt) return;
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  if (!seconds) { clearCode(); el('expiry').textContent = 'Code expired. Get a new code to continue.'; return; }
  el('expiry').textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} · One use`;
}
setInterval(tick, 1000);
account.auth.onAuthStateChange((_event, session) => updateSession(session));
void account.auth.getSession().then(({ data: { session }, error }) => { if (error) feedback('Could not restore your session. Please sign in again.'); else updateSession(session); });
void fetch(`${ACCOUNT_URL}/auth/v1/settings`, { headers: { apikey: ACCOUNT_PUBLIC_KEY } }).then(async response => {
  if (!response.ok) throw new Error(); const settings = await response.json();
  el<HTMLButtonElement>('google').disabled = !settings.external?.google || embeddedHost();
  el('provider-status').textContent = embeddedHost() ? 'Open this page in Safari or Chrome to sign in, then pair from Even Hub.' : settings.external?.google ? 'Use your Google account or a verified email link.' : 'Google sign-in is not available yet. Use a verified email link.';
}).catch(() => { el('provider-status').textContent = 'Sign-in options could not be checked. Please refresh and try again.'; });
// Checkout query strings are navigation hints, never evidence of paid access.
if (new URL(location.href).searchParams.has('checkout')) history.replaceState({}, '', new URL('account.html', location.href));
