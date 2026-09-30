import { resolveAccountProject } from './account-project';

// A mismatched project or server key fails before an auth client is created.
const project = resolveAccountProject(import.meta.env.VITE_WL_SUPABASE_URL || undefined, import.meta.env.VITE_WL_SUPABASE_KEY || undefined);
export const ACCOUNT_URL = project.url;
export const ACCOUNT_PUBLIC_KEY = project.key;
export const API_URL = import.meta.env.VITE_SOMMNI_API_URL || (import.meta.env.DEV ? '' : 'https://sommni-api.vercel.app');
export const ACCOUNT_SITE = import.meta.env.VITE_WL_ACCOUNT_URL || (import.meta.env.DEV ? new URL('account.html', new URL(import.meta.env.BASE_URL, location.origin)).href : 'https://sommni-beige.vercel.app/sommNI/account.html');
