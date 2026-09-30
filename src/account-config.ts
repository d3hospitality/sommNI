// Public Supabase anon key, shared with the existing wineLENS website. RLS enforces ownership.
export const ACCOUNT_URL = "https://hwqovzizjoelzfulhxem.supabase.co";
export const ACCOUNT_PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3cW92eml6am9lbHpmdWxoeGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MzU5MTQsImV4cCI6MjA5NDIxMTkxNH0.U-4EkTX5FuvRwncQnejAQUaPLCLRyE8yk1uCQfz8XdU';
export const API_URL = import.meta.env.VITE_SOMMNI_API_URL || (import.meta.env.DEV ? "" : "https://sommni-api.vercel.app");
