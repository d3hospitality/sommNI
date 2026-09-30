import assert from 'node:assert/strict';
import { requireBottleStudioPro } from '../integrations/sommni-api/billing.js';
process.env.SUPABASE_URL='https://mcmtasetompygfktzhpr.supabase.co';process.env.SUPABASE_ANON_KEY='test-public-key';
const req={headers:{authorization:'Bearer owner'}};
let code,body;const res={status(v){code=v;return this},json(v){body=v;return this}};
const originalFetch=globalThis.fetch;
try{
 for(const [status,pro,expected] of [[200,true,true],[200,false,false],[200,'true',false],[402,false,false],[503,false,false]]){
  globalThis.fetch=async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer owner');assert.deepEqual(JSON.parse(init.body),{action:'require_pro'});return new Response(JSON.stringify({pro}),{status})};
  assert.equal(await requireBottleStudioPro(req,res),expected);
  if(!expected)assert.equal(code,status===402?402:503);
 }
 globalThis.fetch=async()=>{throw new Error('Network down')};assert.equal(await requireBottleStudioPro(req,res),false);assert.equal(code,503);
 process.env.SUPABASE_URL='https://wrong-project.supabase.co';assert.equal(await requireBottleStudioPro(req,res),false);assert.equal(code,503);
 console.log('PASS: API premium gate denies free, string booleans, Stripe outages, and mismatched projects before paid work.');
}finally{globalThis.fetch=originalFetch}
