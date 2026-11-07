import { resolveAccountProject } from './account-project';

// A mismatched project or server key fails before an auth client is created.
const project = resolveAccountProject(import.meta.env.VITE_WL_SUPABASE_URL || undefined, import.meta.env.VITE_WL_SUPABASE_KEY || undefined);
export const ACCOUNT_URL = project.url;
export const ACCOUNT_PUBLIC_KEY = project.key;
export const API_URL = import.meta.env.VITE_SOMMNI_API_URL || (import.meta.env.DEV ? '' : 'https://sommni-api.vercel.app');
export const ACCOUNT_SITE = 'https://d3hospitality.com/sommNI';
