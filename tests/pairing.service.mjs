import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['supabase/functions/winelens-link/service.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {createLinkService,validCode,normalizeCode}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const tables={sommni_pair_requests:[],wl_linked_devices:[],wl_link_codes:[]};let generated=0,quota=true;
const db={from(name){const filters=[];let action='select',payload,options;const q={
 select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},gt(k,v){filters.push(r=>r[k]>v);return q},order(){return q},insert(v){action='insert';payload=v;return q},update(v){action='update';payload=v;return q},upsert(v,o){action='upsert';payload=v;options=o;return q},
 single(){return run(true)},maybeSingle(){return run(true)},then(resolve,reject){return run(false).then(resolve,reject)}
 };async function run(single){let rows=tables[name].filter(r=>filters.every(f=>f(r)));
 if(action==='insert'||action==='upsert'){if(name==='wl_linked_devices')assert(tables.wl_link_codes.some(c=>c.id===payload.code_id));const old=tables[name].find(r=>r.id===payload.id);if(old&&options?.ignoreDuplicates)rows=[];else{const row={id:crypto.randomUUID(),expires_at:new Date(Date.now()+1800000).toISOString(),...payload};tables[name].push(row);rows=[row];}}
 if(action==='update')for(const row of rows)Object.assign(row,payload);
 return {data:structuredClone(single?rows[0]||null:rows),error:null};}return q;},
 async rpc(name,args){if(name==='sommni_request_allow')return {data:quota};if(name==='sommni_revoke_device'){const d=tables.wl_linked_devices.find(d=>d.id===args.p_id&&d.user_id===args.p_user);if(d)d.revoked_at=new Date().toISOString();return {data:!!d};}throw Error(name)},
 auth:{admin:{async getUserById(id){return {data:{user:{id,email:id+'@example.com',email_confirmed_at:new Date().toISOString()}}}},async generateLink(){generated++;return {data:{properties:{hashed_token:'token-'+generated}}}}}}
};
const run=createLinkService(db,'fixture-secret');
const guest={network:'test'},web={network:'test',user:{id:'owner'},sessionId:'website'},app={...web,sessionId:'companion'},other={...web,user:{id:'other'}};
const start=()=>run({action:'start'},guest),approve=p=>run({action:'approve',code:p.code},web),poll=p=>run({action:'poll',id:p.id,proof:p.proof},guest),register=(p,context=app)=>run({action:'register',id:p.id,proof:p.proof},context);
const p=await start();assert(validCode(normalizeCode(p.code)));assert.equal(p.proof.length,64);assert(!JSON.stringify(tables).includes(p.proof));assert(!JSON.stringify(tables).includes(normalizeCode(p.code)));
assert.equal((await poll(p)).status,'pending');
await assert.rejects(run({action:'poll',id:p.id,proof:'a'.repeat(64)},guest),e=>e.status===410);
await assert.rejects(run({action:'approve',code:p.code},guest),e=>e.status===401);
await approve(p);await assert.rejects(approve(p),e=>e.status===404);
await assert.rejects(register(p,other),e=>e.status===403);
await assert.rejects(register(p),e=>e.status===409);
assert.equal((await poll(p)).status,'approved');assert.equal((await poll(p)).token_hash,'token-1');assert.equal(generated,1);
assert.equal((await register(p)).status,'linked');assert.equal((await register(p)).status,'linked');
await assert.rejects(register(p,web),e=>e.status===403);
assert.equal((await poll(p)).status,'linked');assert.equal(tables.sommni_pair_requests[0].exchange_hash,null);
assert.equal((await run({action:'list'},other)).devices.length,0);
await assert.rejects(run({action:'revoke',id:p.id},other),e=>e.status===404);
assert.equal((await run({action:'status'},app)).status,'linked');
await run({action:'revoke',id:p.id},web);
await assert.rejects(run({action:'status'},app),e=>e.status===401);
await assert.rejects(register(p),e=>e.status===403);
assert.equal((await run({action:'status'},web)).status,'linked');
const expired=await start();tables.sommni_pair_requests.find(r=>r.id===expired.id).expires_at=new Date(0).toISOString();await assert.rejects(poll(expired),e=>e.status===410);await assert.rejects(approve(expired),e=>e.status===404);
const crashed=await start();await approve(crashed);tables.sommni_pair_requests.find(r=>r.id===crashed.id).exchange_started_at=new Date(Date.now()-120000).toISOString();assert.equal((await poll(crashed)).status,'approved');assert.equal(generated,2);
quota=false;await assert.rejects(start(),e=>e.status===429);
console.log('PASS: hashed code/proof; pending/approve/exchange/register; wrong proof/account; replay and session mismatch; expiry; stale exchange recovery; device revoke; website unaffected; abuse gate.');
