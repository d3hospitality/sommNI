import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { privateHash } from './policy.ts';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function setting(name: string): string { const v = Deno.env.get(name); if (!v) throw new HttpError(503, 'Account service is not configured yet.'); return v; }
export function admin() { return createClient(setting('SUPABASE_URL'), setting('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }); }
export type Admin = ReturnType<typeof admin>;
export async function userFor(req: Request, db: Admin) {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sign in again to continue.');
  return data.user;
}
export async function rate(db: Admin, key: string, limit: number, seconds: number) {
  const { data, error } = await db.rpc('winelens_take_rate', { p_key: key, p_limit: limit, p_seconds: seconds });
  if (error) throw new HttpError(503, 'Account service is temporarily unavailable.');
  if (data !== true) throw new HttpError(429, 'Too many attempts. Please try again later.');
}
export async function claimRate(req: Request, db: Admin) {
  // The global bound still applies if an upstream forwards an untrusted IP header.
  await rate(db, 'link-claim-global', 3000, 600);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  await rate(db, 'link-ip:' + await privateHash(ip, setting('SUPABASE_SERVICE_ROLE_KEY')), 10, 600);
}
export async function body(req: Request) {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Use JSON.');
  const text = await req.text();
  if (text.length > 2048) throw new HttpError(413, 'Request is too large.');
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new HttpError(400, 'Invalid request.'); }
}
export function handler(action: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const allowed = (Deno.env.get('WINELENS_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors: Record<string,string> = { 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: 'This site is not enabled for accounts yet.' }), { status: 403, headers: cors });
    if (origin) cors['Access-Control-Allow-Origin'] = origin;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only.' }), { status: 405, headers: cors });
    try { return new Response(JSON.stringify(await action(req)), { headers: cors }); }
    catch (error) {
      // Never log bearer tokens, codes, magic-link hashes, or Stripe objects.
      const status = error instanceof HttpError ? error.status : 503;
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : 'Account service is temporarily unavailable. Please try again.' }), { status, headers: cors });
    }
  };
}
