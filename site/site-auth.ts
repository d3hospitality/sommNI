import { createClient } from '@supabase/supabase-js';
import defaults from '../shared/accounts.json';
export const CANONICAL_ORIGIN = defaults.canonicalOrigin;
export const API_BASE = String(import.meta.env.VITE_API_BASE_URL || CANONICAL_ORIGIN).replace(/\/$/, '');
const URL = import.meta.env.VITE_SUPABASE_URL || defaults.supabaseUrl;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaults.publishableKey;
export function isCanonicalSite() { return location.origin === CANONICAL_ORIGIN; }
export function siteSupabase() { return createClient(URL, KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'winelens_site_session_v1' } }); }
export async function googleIsEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    return (await response.json()).external?.google === true;
  } catch { return false; }
}
