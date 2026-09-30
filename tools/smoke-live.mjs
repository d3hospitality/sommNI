#!/usr/bin/env node
// READ ONLY. Run after the ordered go-live checklist; no secret required.
import accounts from '../shared/accounts.json' with {type:'json'};
const origin=accounts.canonicalOrigin;
const checks=[];
async function check(name,run){try{await run();checks.push([name,'PASS']);}catch(e){checks.push([name,'FAIL: '+e.message]);}}
const request=(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(15000)});
const requireThat=(ok,msg)=>{if(!ok)throw Error(msg)};
await check('Google provider',async()=>{const r=await request(accounts.supabaseUrl+'/auth/v1/settings',{headers:{apikey:accounts.publishableKey}});requireThat(r.ok&&((await r.json()).external?.google===true),'Google is not enabled');});
await check('/link 200',async()=>{const r=await request(origin+'/link');requireThat(r.status===200,'link not available')});
await check('canonical CORS',async()=>{const r=await request(origin+'/api/device-link',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});requireThat(r.status===204&&r.headers.get('access-control-allow-origin')===origin,'preflight mismatch');});
// An overlong bad code is rejected by request validation before clients/DB are
// opened. A syntactically valid wrong code would write a rate-limit attempt.
await check('bad-code rejection (read-only)',async()=>{const r=await request(origin+'/api/device-link',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'redeem',code:'INVALID!'.repeat(300)})});const body=await r.json();requireThat(r.status===400&&body.error==='Invalid request.','unexpected malformed-code response');});
await check('billing status answers',async()=>{const r=await request(origin+'/api/billing',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'status'})});const body=await r.json();requireThat(r.status===401&&/sign in/i.test(body.error||''),'expected authenticated status endpoint');});
for(const [name,result] of checks)console.log(`${result} | ${name}`);
if(checks.some(([,r])=>r!=='PASS'))process.exitCode=1;
