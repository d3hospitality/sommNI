import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const bundle=await build({entryPoints:['supabase/functions/winelens-beta/request-limit.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {createRequestReserve}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const calls=[],counts=new Map();let fail=false;
const db={async rpc(name,args){assert.equal(name,'sommni_request_allow');calls.push(args);if(fail)return {error:{message:'offline'}};const n=(counts.get(args.p_key)||0)+1;counts.set(args.p_key,n);return {data:n<=args.p_limit}}};
const request=ip=>new Request('https://example.test',{headers:{'x-forwarded-for':ip}});
// An exhausted old global daily budget must never be queried.
for(let i=0;i<60;i++)assert(await createRequestReserve(db,request('1.2.3.4'),'salt','transcribe')(1));
await assert.rejects(createRequestReserve(db,request('1.2.3.4'),'salt','transcribe')(1),e=>e.status===429);
assert(await createRequestReserve(db,request('5.6.7.8'),'salt','transcribe')(1));
assert(await createRequestReserve(db,request('1.2.3.4'),'salt','sommelier')(1));
assert(await createRequestReserve(db,request('1.2.3.4'),'salt','research')(3));
assert(calls.every(c=>c.p_seconds===60&&!c.p_key.includes('1.2.3.4')));
const a=createRequestReserve(db,request('1.2.3.4'),'salt','bottle_candidates'),b=createRequestReserve(db,request('1.2.3.4'),'salt','bottle_lookup');await a(5);await b(5);assert.equal(calls.at(-1).p_key,calls.at(-2).p_key);
fail=true;await assert.rejects(createRequestReserve(db,request('1.2.3.4'),'salt','ask')(1),e=>e.status===503);
const entry=fs.readFileSync('supabase/functions/winelens-beta/index.ts','utf8');assert(!entry.includes('wl_beta_reserve'));assert(entry.includes('createIntelligence({db,env,fetch,reserve})(body)'));assert(entry.includes('publicService(reserve)(body)'));
console.log('PASS: no global daily budget; independent voice/finder/research/users; real burst protection; failed limiter fails closed; both routes request-scoped.');
