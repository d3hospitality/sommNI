/** sommNI owns this project. Never silently fall back to a shared D3 backend. */
export const SOMMNI_PROJECT_REF = 'mcmtasetompygfktzhpr';
export const SOMMNI_PROJECT_URL = 'https://mcmtasetompygfktzhpr.supabase.co';
export const SOMMNI_PUBLISHABLE_KEY = 'sb_publishable_Fh03U5Iy3cMmnqTC48mPog_xKhh8pmR';
export function resolveAccountProject(url = SOMMNI_PROJECT_URL, key = SOMMNI_PUBLISHABLE_KEY) {
  if (url.replace(/\/$/, '') !== SOMMNI_PROJECT_URL)
    throw new Error('sommNI must use its dedicated Supabase project. Check VITE_WL_SUPABASE_URL.');
  if (!key.startsWith('sb_publishable_'))
    throw new Error('sommNI requires a public publishable key. Never put a server secret in VITE_WL_SUPABASE_KEY.');
  return { url: SOMMNI_PROJECT_URL, key };
}
