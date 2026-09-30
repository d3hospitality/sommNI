import { createClient } from '@supabase/supabase-js';
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from './account-config';
import { deviceAuthStorage } from './account-storage';
// No import from sync: the account website does not need the wine/glasses bundle.
export function embeddedHost() {
  return typeof (window as unknown as { flutter_inappwebview?: { callHandler?: unknown } }).flutter_inappwebview?.callHandler === 'function';
}
const embedded = embeddedHost();
export const account = createClient(ACCOUNT_URL, ACCOUNT_PUBLIC_KEY, { auth: {
  persistSession: true, autoRefreshToken: true, detectSessionInUrl: !embedded,
  ...(embedded ? { storage: deviceAuthStorage(waitForEvenAppBridge) } : {}),
} });
export async function accountAction<T = any>(service: 'link' | 'billing', data: Record<string, unknown>, anonymous = false): Promise<T> {
  const token = anonymous ? null : (await account.auth.getSession()).data.session?.access_token;
  if (!anonymous && !token) throw new Error('Sign in to continue.');
  const response = await fetch(`${ACCOUNT_URL}/functions/v1/winelens-${service}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ACCOUNT_PUBLIC_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The account service is unavailable. Please try again.');
  return result;
}
export async function claimAccountCode(code: string): Promise<void> {
  const result = await accountAction<{ token_hash: string }>('link', { action: 'claim', code }, true);
  const { error } = await account.auth.verifyOtp({ token_hash: result.token_hash, type: 'magiclink' });
  if (error) throw new Error('Please get a new pairing code and try again.');
}
