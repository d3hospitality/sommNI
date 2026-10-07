import defaults from '../shared/accounts.json';
export const ACCOUNT_URL = import.meta.env.VITE_SUPABASE_URL || defaults.supabaseUrl;
export const ACCOUNT_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaults.publishableKey;
export const SITE_URL: string = import.meta.env.VITE_CANONICAL_ORIGIN || defaults.canonicalOrigin;
// The ONE wineLENS backend (an origin, not an /api path): linking, Winebrary, study, plan/tokens and AI help.
export const LINK_API_URL = String(import.meta.env.VITE_API_BASE_URL || SITE_URL).replace(/\/$/, '');
