const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {createScanHandler,photoData}=require('../server/wine-scan.cjs');const {env,invoke,fixture}=require('./billing-helpers.cjs');
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const fields={wine_name:'Test Wine',producer:'Producer',vintage:2020,country:'France',region:'Bordeaux',grape:'Merlot',color:'Red',confidence:.8,draft_tasting_note:'A speculative fruit-led profile.'};
function setup({fail=false,reason,invalid=false}={}){const f=fixture(),requests=new Map();let providerCalls=0;const old=f.db.rpc;
 f.db.rpc=async(name,args)=>{if(name==='wl_check_session')return old(name,args);f.calls.push([name,args]);
 if(name==='winelens_begin_scan'){
  const prev=requests.get(args.p_request_id);if(prev)return {data:{replayed:true,result:prev.result}};
  if(reason)return {data:{allowed:false,reason}};
  const hold={allowed:true,reservation_id:randomUUID()};requests.set(args.p_request_id,hold);return {data:hold};}
 if(name==='winelens_finish_scan'){requests.get(args.p_request_id).result=args.p_result;return {data:{status:args.p_result?'committed':'released'}};}return {data:{}};};
 const client={chat:{completions:{create:async()=>{providerCalls++;if(fail)throw Error('provider failed');return {choices:[{message:{content:JSON.stringify(invalid?{}:fields)}}]};}}}};
 const h=createScanHandler({getDb:()=>f.db,env,getOpenAI:()=>client});return {...f,h,providerCalls:()=>providerCalls};}
test('reserve → OpenAI → commit, draft review required; exact replay cached, no second call',async()=>{
 const f=setup(),body={photo,request_id:randomUUID()};const response=await invoke(f.h,body);assert.equal(response.status,200);assert.equal(response.body.review_required,true);assert.match(response.body.draft_tasting_note,/^Draft —/);
 const again=await invoke(f.h,body);assert.equal(again.body.replayed,true);assert.equal(f.providerCalls(),1);assert.deepEqual(f.calls.map(c=>c[0]),['wl_check_session','winelens_begin_scan','winelens_finish_scan','wl_check_session','winelens_begin_scan']);
});
test('provider failure or malformed output releases, replay does not retry provider',async()=>{
 for(const config of [{fail:true},{invalid:true}]){const f=setup(config),body={photo,request_id:randomUUID()};assert.equal((await invoke(f.h,body)).status,502);assert.equal(f.calls.find(c=>c[0]==='winelens_finish_scan')[1].p_result,null);assert.equal((await invoke(f.h,body)).status,409);assert.equal(f.providerCalls(),1);}
});
test('limits and consent deny before provider; input size/type, missing key/auth',async()=>{
 for(const reason of ['pro_required','consent_required','token_limit']){const f=setup({reason});assert.equal((await invoke(f.h,{photo,request_id:randomUUID()})).status,402);assert.equal(f.providerCalls(),0);}
 assert.throws(()=>photoData('data:image/png;base64,YmFk'));assert.throws(()=>photoData('data:image/png;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')));
 const f=setup();assert.equal((await invoke(f.h,{photo,request_id:randomUUID(),user_id:'evil'})).status,400);
 assert.equal((await invoke(createScanHandler({getDb:()=>f.db,env:{}}),{photo,request_id:randomUUID()})).status,503);
 assert.equal((await invoke(f.h,{photo,request_id:randomUUID()},{headers:{}})).status,401);
});
