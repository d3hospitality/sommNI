import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY, LINK_API_URL } from './account-config';
import { companionStore } from './sync';
export const ACCOUNT_STORAGE_KEY = 'winelens_account_session_v1';
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function normalizeLinkCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}
export function formatLinkCode(raw: string): string {
  const code = normalizeLinkCode(raw);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
let client: SupabaseClient | undefined;
export function accountClient(): SupabaseClient {
  // Created only after initSync chooses browser or host storage. Never mirror host credentials in localStorage.
  return client ??= createClient(ACCOUNT_URL, ACCOUNT_PUBLIC_KEY, { auth: {
    storageKey: ACCOUNT_STORAGE_KEY, detectSessionInUrl: false,
    storage: {
      getItem: key => companionStore().get(key),
      setItem: (key, value) => companionStore().set(key, value),
      removeItem: key => companionStore().remove(key),
    },
  } });
}
export class DeviceLinkError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function linkRequest(action: string, values: Record<string, unknown> = {}, token?: string): Promise<any> {
  const response = await fetch(`${LINK_API_URL}/api/device-link`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...values }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new DeviceLinkError(result.error || 'Could not link your account. Try again.', response.status);
  return result;
}
export async function redeemLinkCode(raw: string): Promise<void> {
  const code = normalizeLinkCode(raw);
  if (!/^[2-9A-HJKMNP-Z]{8}$/.test(code)) throw new Error('Enter the eight-character code from the website. Codes do not use 0, 1, I, L or O.');
  const result = await linkRequest('redeem', { code });
  if (!result.session?.access_token || !result.session?.refresh_token) throw new Error('Linking did not return a session. Get a new code.');
  try {
    const { error } = await accountClient().auth.setSession(result.session);
    if (error) throw error;
  } catch {
    // A refused host write must not leave a usable session in memory.
    await linkRequest('unlink', {}, result.session.access_token).catch(() => {});
    await accountClient().auth.signOut({ scope: 'local' }).catch(() => {});
    throw new Error('Could not save this link on your device. Please try again.');
  }
}
export async function checkDeviceSession(session: Session): Promise<boolean> {
  try { await linkRequest('device-status', {}, session.access_token); return true; }
  catch (error) {
    if (error instanceof DeviceLinkError && error.status === 401) await accountClient().auth.signOut({ scope: 'local' });
    return false;
  }
}
/** The stored (auto-refreshed) access token. The server checks the linked session on every call. */
export async function sessionToken(): Promise<string | null> {
  const { data: { session } } = await accountClient().auth.getSession();
  return session?.access_token ?? null;
}
export async function linkedAccessToken(): Promise<string | null> {
  const { data: { session } } = await accountClient().auth.getSession();
  return session && await checkDeviceSession(session) ? session.access_token : null;
}
export async function unlinkDevice(): Promise<string> {
  const auth = accountClient().auth;
  const { data: { session } } = await auth.getSession();
  let warning = '';
  if (session) {
    try { await linkRequest('unlink', {}, session.access_token); }
    catch { warning = 'Removed from this device. Revoke its link on the website when you are online.'; }
  }
  // Local cleanup is required even if the server is offline.
  await auth.signOut({ scope: 'local' });
  await companionStore().remove(ACCOUNT_STORAGE_KEY);
  return warning;
}
