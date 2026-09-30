// Public key only. The dedicated wineLENS project owns accounts and Winebrary.
// The API must use this same project before this branch is released.
export const ACCOUNT_URL = import.meta.env.VITE_WL_SUPABASE_URL || 'https://mcmtasetompygfktzhpr.supabase.co';
export const ACCOUNT_PUBLIC_KEY = import.meta.env.VITE_WL_SUPABASE_KEY || 'sb_publishable_Fh03U5Iy3cMmnqTC48mPog_xKhh8pmR';
export const API_URL = import.meta.env.VITE_SOMMNI_API_URL || (import.meta.env.DEV ? '' : 'https://sommni-api.vercel.app');
export const ACCOUNT_SITE = import.meta.env.VITE_WL_ACCOUNT_URL || (import.meta.env.DEV ? new URL('account.html', new URL(import.meta.env.BASE_URL, location.origin)).href : 'https://sommni-beige.vercel.app/sommNI/account.html');
