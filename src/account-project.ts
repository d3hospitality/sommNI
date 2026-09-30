/** wineLENS owns this project. Never silently fall back to a shared D3 backend. */
export const WINELENS_PROJECT_REF = 'mcmtasetompygfktzhpr';
export const WINELENS_PROJECT_URL = `https://${WINELENS_PROJECT_REF}.supabase.co`;
export const WINELENS_PUBLISHABLE_KEY = 'sb_publishable_Fh03U5Iy3cMmnqTC48mPog_xKhh8pmR';
export function resolveAccountProject(url = WINELENS_PROJECT_URL, key = WINELENS_PUBLISHABLE_KEY) {
  if (url.replace(/\/$/, '') !== WINELENS_PROJECT_URL)
    throw new Error('wineLENS must use its dedicated Supabase project. Check VITE_WL_SUPABASE_URL.');
  if (!key.startsWith('sb_publishable_'))
    throw new Error('wineLENS requires a public publishable key. Never put a server secret in VITE_WL_SUPABASE_KEY.');
  return { url: WINELENS_PROJECT_URL, key };
}
