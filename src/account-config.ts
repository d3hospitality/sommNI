import defaults from '../shared/accounts.json';
export const ACCOUNT_URL = import.meta.env.VITE_SUPABASE_URL || defaults.supabaseUrl;
export const ACCOUNT_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaults.publishableKey;
export const SITE_URL = defaults.canonicalOrigin;
// This is an origin (not an /api path), shared with the separate showcase build.
export const LINK_API_URL = String(import.meta.env.VITE_API_BASE_URL || SITE_URL).replace(/\/$/, '');
export const API_URL = import.meta.env.VITE_SOMMNI_API_URL || (import.meta.env.DEV ? "" : "https://sommni-api.vercel.app");
