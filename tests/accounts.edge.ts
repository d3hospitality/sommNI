import assert from 'node:assert/strict';
import { serve as link } from '../supabase/functions/winelens-link/handler.ts';
import { serve as billing } from '../supabase/functions/winelens-billing/handler.ts';
const user = { id:'11111111-1111-4111-8111-111111111111', email:'owner@example.test', email_confirmed_at:'2026-01-01', aud:'authenticated' };
const origin = 'https://wine.example.test';
const env = { SUPABASE_URL:'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-service-only', WINELENS_ALLOWED_ORIGINS:origin,
 WINELENS_ACCOUNT_URL:origin+'/account.html', STRIPE_SECRET_KEY:'sk_test_test-only', STRIPE_PRICE_MONTHLY:'price_month', STRIPE_PRICE_ANNUAL:'price_year', WINELENS_CHECKOUT_ENABLED:'true', WINELENS_TRIAL_DAYS:'7' };
for (const [k,v] of Object.entries(env)) Deno.env.set(k,v);
const originalFetch = globalThis.fetch;
let available = true, allowRate = true, userExists = true, used = false, customer: string|null='cus_owner', subscriptions: any[]=[], calls: {url: URL, body: any, headers: Headers}[]=[];
const json = (value:unknown,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch = async (input: string|URL|Request, init?: RequestInit) => {
 const url = new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const headers = new Headers(init?.headers); const raw = String(init?.body||'');
 let body:any;try{body=JSON.parse(raw)}catch{body=new URLSearchParams(raw)}
 calls.push({url,body,headers});
 if (url.hostname==='project.supabase.co') {
  if(url.pathname==='/auth/v1/user') return headers.get('Authorization')==='Bearer valid-user' ? json(user) : json({message:'Invalid token'},401);
  if(url.pathname===`/auth/v1/admin/users/${user.id}`) return userExists?json(user):json({message:'Not found'},404);
  if(url.pathname==='/auth/v1/admin/generate_link') return json({...user,hashed_token:'one-use-exchange',action_link:'https://unused.test',email_otp:'123456',verification_type:'magiclink'});
  if(url.pathname==='/rest/v1/rpc/winelens_take_rate') return available?json(allowRate):json({message:'DB down'},500);
  if(url.pathname==='/rest/v1/rpc/winelens_mint_link') return json(new Date(Date.now()+600000).toISOString());
  if(url.pathname==='/rest/v1/rpc/winelens_claim_link'){const value=used?null:user.id;used=true;return json(value);}
  if(url.pathname==='/rest/v1/winelens_billing_customers') {
   if(init?.method==='POST'){customer=body.customer_id;return json(null,201)}
   return json(customer?{customer_id:customer}:null);
  }
  if(url.pathname==='/rest/v1/rpc/winelens_reserve_checkout') return json({attempt_id:'attempt-one',plan:'monthly',expires_at:new Date(Date.now()+1860000).toISOString()});
 }
 if (url.hostname==='api.stripe.com') {
  if(url.pathname==='/v1/subscriptions') return json({object:'list',data:subscriptions,has_more:false,url:'/v1/subscriptions'});
  if(url.pathname.startsWith('/v1/prices/')) return json({id:url.pathname.split('/').pop(),object:'price',active:true,livemode:false,type:'recurring',billing_scheme:'per_unit',unit_amount:url.pathname.endsWith('price_month')?499:3999,currency:'usd',recurring:{interval:url.pathname.endsWith('price_month')?'month':'year',interval_count:1}});
  if(url.pathname==='/v1/checkout/sessions') return json({id:'cs_test',object:'checkout.session',status:'open',url:'https://checkout.stripe.com/pay/test'});
  if(url.pathname==='/v1/billing_portal/sessions') return json({url:'https://billing.stripe.com/test'});
  if(url.pathname==='/v1/customers') return json({id:'cus_owner',object:'customer'});
 }
 throw new Error('Unexpected request '+url.href);
};
function req(body:unknown,token:string|null='valid-user',requestOrigin=origin) { return new Request('https://edge.example.test',{method:'POST',headers:{'Content-Type':'application/json','Origin':requestOrigin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}); }
Deno.test('pairing validates accounts, fails closed, consumes once, and rejects other origins',async()=>{
 assert.equal((await link(req({action:'mint'},null))).status,401);
 const minted=await link(req({action:'mint'}));assert.equal(minted.status,200);assert.match((await minted.json()).code,/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
 const mintCall=calls.find(c=>c.url.pathname.endsWith('winelens_mint_link'))!;assert.equal(mintCall.body.p_user,user.id);assert.match(mintCall.body.p_hash,/^[a-f0-9]{64}$/);
 calls=[];available=false;assert.equal((await link(req({action:'claim',code:'ABCD1234'},null))).status,503);assert.equal(calls.some(c=>c.url.pathname.endsWith('winelens_claim_link')),false);
 available=true;allowRate=false;assert.equal((await link(req({action:'claim',code:'ABCD1234'},null))).status,429);allowRate=true;
 used=false;const first=await link(req({action:'claim',code:'abcd-1234'},null));assert.equal(first.status,200);assert.equal((await first.json()).token_hash,'one-use-exchange');
 assert.equal((await link(req({action:'claim',code:'ABCD1234'},null))).status,400);
 assert.equal((await link(req({action:'claim',code:'ABCD1234'},null,'https://evil.example.test'))).status,403);
 used=false;userExists=false;assert.equal((await link(req({action:'claim',code:'ABCD1234'},null))).status,400);userExists=true;
});
Deno.test('billing requires real user, server prices and owner; canceled/past-due access denied',async()=>{
 calls=[];assert.equal((await billing(req({action:'checkout',plan:'monthly'},'forged-user'))).status,401);assert.equal(calls.some(c=>c.url.hostname==='api.stripe.com'),false);
 assert.equal((await billing(req({action:'checkout',plan:'lifetime'}))).status,400);
 const response=await billing(req({action:'checkout',plan:'monthly',user_id:'attacker',customer:'cus_attacker',price:'price_free',trial_days:999,success_url:'https://evil.test'}));
 assert.equal(response.status,200); const checkout=calls.find(c=>c.url.pathname==='/v1/checkout/sessions')!;
 assert.equal(checkout.body.get('customer'),'cus_owner');assert.equal(checkout.body.get('line_items[0][price]'),'price_month');assert.equal(checkout.body.get('client_reference_id'),user.id);
 assert.equal(checkout.body.get('subscription_data[trial_period_days]'),'7');assert.equal(checkout.headers.get('Idempotency-Key'),'winelens-checkout:attempt-one');
 assert.equal(new URL(checkout.body.get('success_url')).origin,origin);
 const sub={id:'sub_test',status:'active',livemode:false,cancel_at_period_end:false,items:{data:[{price:{id:'price_month'},current_period_end:Math.floor(Date.now()/1000)+3600}]}};
 subscriptions=[sub];assert.equal((await billing(req({action:'require_pro'}))).status,200);
 assert.equal((await billing(req({action:'checkout',plan:'monthly'}))).status,409);
 for(const status of ['past_due','unpaid','canceled']){subscriptions=[{...sub,status}];assert.equal((await billing(req({action:'require_pro'}))).status,402);}
 subscriptions=[{...sub,status:'canceled'}];calls=[];await billing(req({action:'checkout',plan:'monthly'}));assert.equal(calls.find(c=>c.url.pathname==='/v1/checkout/sessions')!.body.has('subscription_data[trial_period_days]'),false);
 Deno.env.set('WINELENS_CHECKOUT_ENABLED','false');calls=[];assert.equal((await billing(req({action:'checkout',plan:'monthly'}))).status,503);assert.equal(calls.some(c=>c.url.hostname==='api.stripe.com'),false);
 const pausedStatus=await billing(req({action:'status'}));assert.equal(pausedStatus.status,200);assert.equal((await pausedStatus.json()).checkout_available,false);
 assert.equal((await billing(req({action:'portal'}))).status,200);
 Deno.env.set('WINELENS_CHECKOUT_ENABLED','true');
});
Deno.test('unconfigured account origin and methods are blocked',async()=>{
 assert.equal((await link(new Request('https://edge.test'))).status,405);
 const response=await link(new Request('https://edge.test',{method:'OPTIONS',headers:{Origin:origin}}));assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 globalThis.fetch=originalFetch;
});
