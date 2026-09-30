import type { Session } from '@supabase/supabase-js';
import { API_BASE, CANONICAL_ORIGIN, isCanonicalSite, siteSupabase, googleIsEnabled } from './site-auth';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const status = (message: string) => { el('status').textContent = message; };
type Issued = { id: string; code: string; expires_at: string };
type Device = { id: string; label: string; linked_at: string; last_seen_at: string };
async function main() {
  if (!isCanonicalSite()) {
    status('This is a preview. Google sign-in and account linking are disabled here.');
    el('canonical-hint').hidden = false;
    const link = el<HTMLAnchorElement>('canonical-link'); link.href = `${CANONICAL_ORIGIN}/link`; link.textContent = `${CANONICAL_ORIGIN.replace('https://', '')}/link`;
    return;
  }
  const auth = siteSupabase();
  const ready = await googleIsEnabled();
  button('google').disabled = !ready;
  const signedOutMessage = ready ? 'Continue with Google to get your link code.' : 'Google sign-in is not enabled yet. Account linking will be available when beta setup is complete.';
  status(signedOutMessage);
  let session: Session | null = null, issued: Issued | null = null, epoch = 0, busy = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let countdown: ReturnType<typeof setInterval> | undefined;
  function stop() { clearTimeout(poll); clearInterval(countdown); }
  function clearCode() { stop(); issued = null; el('code').textContent = '—'; el('expiry').textContent = 'Get a new code to link a device.'; button('copy').disabled = true; }
  async function request(action: string, body: Record<string, unknown> = {}) {
    if (!session) throw new Error('Sign in again to continue.');
    const { data } = await auth.auth.getSession();
    if (!data.session || data.session.user.id !== session.user.id) throw new Error('Sign in again to continue.');
    const response = await fetch(`${API_BASE}/api/device-link`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ action, ...body }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { if (response.status === 401) await auth.auth.signOut({ scope: 'local' }); throw new Error(result.error || 'This action could not finish. Please try again.'); }
    return result;
  }
  async function guarded(task: () => Promise<void>) {
    if (busy) return; busy = true;
    const revision = epoch;
    for (const id of ['new-code', 'sign-out', 'delete-account', 'refresh-devices']) button(id).disabled = true;
    try { await task(); } catch (error) { if (revision === epoch) status(error instanceof Error ? error.message : 'Please try again.'); }
    finally { busy = false; for (const id of ['new-code', 'sign-out', 'delete-account', 'refresh-devices']) button(id).disabled = false; }
  }
  async function devices() {
    const revision = epoch; const result = await request('list');
    if (revision !== epoch) return;
    el('devices').replaceChildren(); el('devices-empty').hidden = result.devices.length > 0;
    for (const device of result.devices as Device[]) {
      const li = document.createElement('li'), text = document.createElement('div'), label = document.createElement('strong'), dates = document.createElement('small'), revoke = document.createElement('button');
      label.textContent = device.label; dates.textContent = `Linked ${new Date(device.linked_at).toLocaleDateString()} · Last seen ${new Date(device.last_seen_at).toLocaleDateString()}`;
      text.append(label, dates); revoke.className = 'plain-button'; revoke.textContent = 'Revoke'; revoke.setAttribute('aria-label', `Revoke ${device.label}`);
      revoke.addEventListener('click', () => void guarded(async () => { revoke.disabled = true; try { await request('revoke', { id: device.id }); await devices(); status('Device revoked. It can no longer refresh its session.'); } finally { revoke.disabled = false; } }));
      li.append(text, revoke); el('devices').append(li);
    }
  }
  function tick() {
    if (!issued) return;
    const seconds = Math.max(0, Math.ceil((Date.parse(issued.expires_at) - Date.now()) / 1000));
    el('expiry').textContent = seconds ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Code expired. Get a new code.';
    if (!seconds) { stop(); button('copy').disabled = true; }
  }
  async function pollCode(revision: number, id: string) {
    if (revision !== epoch || issued?.id !== id || document.hidden) { if (revision === epoch && issued?.id === id) poll = setTimeout(() => void pollCode(revision, id), 4000); return; }
    try {
      const result = await request('issued-status', { id });
      if (revision !== epoch || issued?.id !== id) return;
      if (result.status === 'linked') { stop(); button('copy').disabled = true; el('code').textContent = 'LINKED'; el('expiry').textContent = 'This code has been used.'; status('Linked — open wineLENS on your glasses.'); await devices(); return; }
      if (result.status === 'expired' || result.status === 'failed') { clearCode(); status(result.status === 'expired' ? 'Your code expired. Get a new code.' : 'That link did not complete. Get a new code.'); return; }
    } catch (error) { if (revision === epoch) status(error instanceof Error ? error.message : 'Could not check the code.'); }
    if (revision === epoch && issued?.id === id && Date.parse(issued.expires_at) > Date.now()) poll = setTimeout(() => void pollCode(revision, id), 4000);
  }
  async function issue() {
    clearCode(); const revision = epoch;
    const result = await request('issue'); if (revision !== epoch) return;
    issued = result; el('code').textContent = result.code; button('copy').disabled = false;
    status('Enter this code in wineLENS inside the Even app.'); tick(); countdown = setInterval(tick, 1000);
    poll = setTimeout(() => void pollCode(revision, result.id), 4000);
  }
  button('google').addEventListener('click', async () => {
    button('google').disabled = true;
    try { const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${CANONICAL_ORIGIN}/link` } }); if (error) throw error; }
    catch { status('Google sign-in could not start. Please try again.'); button('google').disabled = !ready; }
  });
  button('new-code').addEventListener('click', () => void guarded(issue));
  button('refresh-devices').addEventListener('click', () => void guarded(devices));
  button('copy').addEventListener('click', async () => { if (!issued) return; try { await navigator.clipboard.writeText(issued.code); status('Code copied. Paste it into wineLENS in the Even app.'); } catch { status('Copy is unavailable. Select the code above and copy it, or type it in.'); } });
  button('sign-out').addEventListener('click', () => void guarded(async () => { const { error } = await auth.auth.signOut({ scope: 'local' }); if (error) throw error; }));
  const dialog = el<HTMLDialogElement>('delete-dialog');
  button('delete-account').addEventListener('click', () => { el<HTMLInputElement>('delete-confirm').value = ''; el('delete-status').textContent = ''; dialog.showModal(); });
  button('cancel-delete').addEventListener('click', () => dialog.close());
  el<HTMLFormElement>('delete-form').addEventListener('submit', e => {
    e.preventDefault(); if (el<HTMLInputElement>('delete-confirm').value !== 'DELETE') return;
    void guarded(async () => {
      button('confirm-delete').disabled = true; button('cancel-delete').disabled = true; el('delete-status').textContent = 'Deleting your account and photos…';
      try { await request('delete-account', { confirm: 'DELETE' }); await auth.auth.signOut({ scope: 'local' }); dialog.close(); setTimeout(() => status('Your account and cloud data have been deleted.'), 0); }
      catch (error) { el('delete-status').textContent = error instanceof Error ? error.message : 'Deletion could not finish. Retry here.'; }
      finally { button('confirm-delete').disabled = false; button('cancel-delete').disabled = false; }
    });
  });
  dialog.addEventListener('cancel', e => { if (button('confirm-delete').disabled) e.preventDefault(); });
  auth.auth.onAuthStateChange((_event, next) => {
    setTimeout(() => {
      const changed = session?.user.id !== next?.user.id; session = next;
      if (!changed && next) return;
      epoch++; clearCode(); el('signed-in').hidden = !next; el('signed-out').hidden = !!next; el('account-email').textContent = next?.user.email || ''; el('devices').replaceChildren();
      if (!next) { dialog.close(); status(signedOutMessage); return; }
      void guarded(async () => { await devices(); await issue(); });
    }, 0);
  });
  window.addEventListener('pagehide', stop);
}
void main().catch(() => { document.getElementById('status')!.textContent = 'Accounts are unavailable right now. Please try again later.'; });
