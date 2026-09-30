const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, normalize, codeHash, allowedOrigin, networkHash } = require('../server/device-link.cjs');
const uid='11111111-1111-4111-8111-111111111111', sid='22222222-2222-4222-8222-222222222222', did='33333333-3333-4333-8333-333333333333';
const token='header.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.test';
function fixture(overrides={}) {
 const calls=[];
 const admin={
  rpc:async(name,args)=>{ calls.push([name,args]); if(overrides.rpc)return overrides.rpc(name,args);return {data: name==='wl_claim_code'?{status:'claimed',id:did,user_id:uid}:name==='wl_issue_code'?{status:'pending',id:did,expires_at:'2026-10-01T00:10:00Z'}:{status:'active'}}; },
  auth:{getUser:async()=>({data:{user:{id:uid,email:'local@example.test'}}}),admin:{getUserById:async()=>({data:{user:{id:uid,email:'local@example.test'}}}),generateLink:async()=>({data:{properties:{hashed_token:'mock-hash'}}}),signOut:async(...args)=>{calls.push(['signOut',...args]);return {};},deleteUser:async(id)=>{calls.push(['deleteUser',id]);return {};}}},
  from:()=>({select:()=>({eq:()=>({is:()=>({not:()=>({order:async()=>({data:[{id:did,label:'Even G2'}]})})})})})}),
  storage:{from:(bucket)=>{calls.push(['bucket',bucket]);return {list:async()=>({data:[]}),remove:async()=>({})};}},
 };
 const auth={auth:{verifyOtp:async(args)=>{calls.push(['verifyOtp',args]);return {data:{session:{access_token:token,refresh_token:'mock-refresh',expires_in:3600,user:{id:uid,email:'local@example.test'}}}};}}};
 if(overrides.configure)overrides.configure(admin,auth);
 const handler=createHandler({getClients:()=>({admin,auth}),secret:()=> 'mock-network-secret', beforeDelete:overrides.beforeDelete});
 async function request(body, extra={}) {
  const headers={}; const res={setHeader:(k,v)=>headers[k]=v,status(n){this.code=n;return this},json(value){this.body=value;return this},end(){return this}};
  await handler({method:'POST',headers:{origin:'https://sommni-beige.vercel.app',authorization:'Bearer '+token},body,socket:{remoteAddress:'192.0.2.1'},...extra},res);
  return {...res,headers};
 }
 return {request,calls};
}
test('normalization, exact alphabet, keyed network hashes and CORS',()=>{
 assert.equal(normalize(' abcd - 2345 '),'ABCD2345'); assert.match(codeHash('ABCD2345'),/^[a-f0-9]{64}$/);
 assert(allowedOrigin('null'));assert(allowedOrigin('http://127.0.0.1:47392'));assert(allowedOrigin('https://appassets.androidplatform.net'));
 assert(!allowedOrigin('https://evil.example'));assert(!allowedOrigin('https://sommni-beige.vercel.app.evil.test'));
 const req={headers:{'x-forwarded-for':'spoof'},socket:{remoteAddress:'real'}};
 assert.equal(networkHash(req,'key'),networkHash({...req,headers:{}},'key'));assert.notEqual(networkHash(req,'key'),networkHash(req,'other-key'));
});
test('preflight and rejected requests perform no backend work',async()=>{const f=fixture();assert.equal((await f.request({}, {method:'OPTIONS'})).code,204);assert.equal((await f.request({}, {method:'GET'})).code,405);assert.equal((await f.request({}, {headers:{origin:'https://evil.test'}})).code,403);assert.equal((await f.request({action:'list'},{headers:{}})).code,401);assert.equal(f.calls.length,0);});
test('issue returns a formatted random code, sends only hash to database',async()=>{const f=fixture();const r=await f.request({action:'issue'});assert.equal(r.code,200);assert.match(r.body.code,/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);assert.equal(f.calls.find(c=>c[0]==='wl_issue_code')[1].p_code_hash,codeHash(normalize(r.body.code)));assert(!JSON.stringify(f.calls).includes(r.body.code));assert.equal(r.headers['Cache-Control'],'no-store');});
test('redeem has no bearer requirement and binds a fresh session to reservation',async()=>{const f=fixture();const r=await f.request({action:'redeem',code:'abcd-2345'},{headers:{origin:'null'}});assert.equal(r.code,200);assert.equal(r.body.device_id,did);assert.equal(r.body.session.refresh_token,'mock-refresh');assert.deepEqual(f.calls.find(c=>c[0]==='wl_finish_link')[1],{p_id:did,p_session_id:sid});assert.equal(f.calls.find(c=>c[0]==='wl_claim_code')[1].p_code_hash,codeHash('ABCD2345'));});
for(const [state,http] of [['invalid',404],['expired',410],['rate_limited',429],['limit_reached',409]])test('redeem '+state,async()=>{const f=fixture({rpc:async()=>({data:{status:state}})});const r=await f.request({action:'redeem',code:'ABCD2345'});assert.equal(r.code,http);assert(!r.body.session);if(http===429)assert.equal(r.headers['Retry-After'],'600');});
test('invalid alphabet still counts an attempt, and errors fail closed',async()=>{const f=fixture({rpc:async()=>({error:{message:'sensitive backend value'}})});const r=await f.request({action:'redeem',code:'OOOO1111'});assert.equal(r.code,503);assert(!JSON.stringify(r.body).includes('sensitive'));assert.equal(f.calls[0][1].p_code_hash,codeHash(''));});
test('failed finalization revokes minted session and aborts reservation',async()=>{const f=fixture({rpc:async(name)=>name==='wl_claim_code'?{data:{id:did,user_id:uid}}:{error:{message:'failed'}}});const r=await f.request({action:'redeem',code:'ABCD2345'});assert.equal(r.code,503);assert(f.calls.some(c=>c[0]==='signOut'&&c[2]==='local'));assert(f.calls.some(c=>c[0]==='wl_abort_link'));assert(!r.body.session);});
test('list, status and revoke bind all queries to verified owner',async()=>{const f=fixture();assert.equal((await f.request({action:'list'})).body.devices[0].id,did);await f.request({action:'issued-status',id:did});await f.request({action:'revoke',id:did,user_id:'attacker'});assert.equal(f.calls.find(c=>c[0]==='wl_revoke_device')[1].p_user_id,uid);assert.equal((await f.request({action:'revoke',id:'bad'})).code,400);});
test('account deletion requires explicit confirmation and removes storage before auth user',async()=>{const f=fixture();assert.equal((await f.request({action:'delete-account'})).code,400);assert(!f.calls.some(c=>c[0]==='deleteUser'));assert.equal((await f.request({action:'delete-account',confirm:'DELETE'})).body.deleted,true);assert(f.calls.findIndex(c=>c[0]==='wl_prepare_deletion')<f.calls.findIndex(c=>c[0]==='bucket'));assert(f.calls.findIndex(c=>c[0]==='bucket')<f.calls.findIndex(c=>c[0]==='deleteUser'));});
test('storage deletion failure keeps account retriable and never exposes provider error',async()=>{const f=fixture({configure(admin){admin.storage.from=()=>({list:async()=>({error:{message:'secret'}})});}});const r=await f.request({action:'delete-account',confirm:'DELETE'});assert.equal(r.code,503);assert(!f.calls.some(c=>c[0]==='deleteUser'));assert(!r.body.error.includes('secret'));});
test('unverified or revoked sessions cannot mint codes',async()=>{const f=fixture({configure(admin){admin.auth.getUser=async()=>({error:{message:'invalid'}})}});assert.equal((await f.request({action:'issue'})).code,401);const g=fixture({rpc:async()=>({data:{status:'revoked'}})});assert.equal((await g.request({action:'issue'})).code,401);});
test('concurrent handler redemptions release only one session when atomic claim rejects replay',async()=>{let claimed=false;const f=fixture({rpc:async(name)=>{if(name==='wl_claim_code'){if(claimed)return {data:{status:'invalid'}};claimed=true;return {data:{id:did,user_id:uid}};}return {data:{status:'linked'}};}});const result=await Promise.all([f.request({action:'redeem',code:'ABCD2345'}),f.request({action:'redeem',code:'ABCD2345'})]);assert.deepEqual(result.map(r=>r.code).sort(),[200,404]);assert.equal(f.calls.filter(c=>c[0]==='verifyOtp').length,1);});
test('expired polling status is a normal response, while expired redeem is an error',async()=>{const f=fixture({rpc:async(name)=>({data:{status:name==='wl_code_status'?'expired':'active'}})});const r=await f.request({action:'issued-status',id:did});assert.equal(r.code,200);assert.equal(r.body.status,'expired');});
test('cleanup accepts real PostgREST-style thenables without .catch',async()=>{const f=fixture({configure(admin){admin.rpc=(name)=>({then(resolve,reject){return Promise.resolve(name==='wl_claim_code'?{data:{id:did,user_id:uid}}:name==='wl_finish_link'?{error:{message:'failed'}}:{data:{status:'aborted'}}).then(resolve,reject);}});}});assert.equal((await f.request({action:'redeem',code:'ABCD2345'})).code,503);});

test('billing deletion guard runs before sessions or private files are removed',async()=>{
 const {LinkError}=require('../server/device-link.cjs');
 const f=fixture({beforeDelete:async()=>{throw new LinkError(409,'Manage billing first.');}});
 assert.equal((await f.request({action:'delete-account',confirm:'DELETE'})).code,409);
 assert(!f.calls.some(c=>['wl_prepare_deletion','bucket','deleteUser'].includes(c[0])));
});
