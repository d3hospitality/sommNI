import {createResearchService} from '../supabase/functions/winelens-research/service.ts';
import {review,photo,grounding,narration} from '../supabase/functions/winelens-research/domain.ts';
const assert=(condition:unknown,message='assertion failed')=>{if(!condition)throw new Error(message)};
const rejects=async(fn:()=>unknown)=>{let failed=false;try{await fn()}catch{failed=true}assert(failed,'expected rejection')};
Deno.test('domain preserves unknown vintage, sources only from provider metadata and rejects invalid input',async()=>{
 await rejects(()=>review({wine_name:'Wine',vintage_state:'year',vintage:9999}));await rejects(()=>photo('data:image/jpeg;base64,c2VjcmV0'));await rejects(()=>photo('https://internal/secret'));
 const wine=review({wine_name:'Wine',vintage_state:'unknown',vintage:2015});assert(wine.vintage===null);
 const refs=grounding({groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)',title:'bad'}},{web:{uri:'https://producer.example/wine',title:'Producer'}}],groundingSupports:[{segment:{text:'Fact'},groundingChunkIndices:[1,22]}]}});assert(refs.sources.length===1);assert(refs.supports[0].sources.length===1);
 assert(narration({wine_name:'Wine',metadata:{tasting_notes:'Reference'},notes:'Personal'}).includes('Reference'));await rejects(()=>narration({wine_name:'Wine'}));
});
function fixture(){
 const rows:Record<string,any[]>={wl_account_deletions:[],wl_wine_research:[],wl_research_jobs:[],wl_wine_audio:[],user_collection:[]};const uploads:any[]=[],calls:any[]=[];let mode='valid';
 const user='11111111-1111-4111-8111-111111111111';
 const candidate={wine_name:'Estate red',producer:'Estate',vintage:2020,vintage_state:'year',region:'Region',country:'France',grape:'Cabernet',color:'Red',tasting_notes:'Producer describes cassis.',uncertainty:'Check the release.'};
 const db={from(table:string){let filters:any[]=[],op='select',value:any;const chain:any={select(){return chain},eq(k:string,v:any){filters.push([k,v]);return chain},is(k:string,v:any){filters.push([k,v]);return chain},order(){return chain},limit(){return chain},insert(v:any){op='insert';value=v;return chain},update(v:any){op='update';value=v;return chain},upsert(v:any){op='upsert';value=v;return chain},maybeSingle(){return Promise.resolve({data:rows[table].find(row=>filters.every(([k,v])=>row[k]===v))??null,error:null})},then(resolve:any){if(op==='insert'||op==='upsert'){rows[table].push(value);return resolve({data:value,error:null})}const found=rows[table].filter(row=>filters.every(([k,v])=>row[k]===v));if(op==='update')found.forEach(row=>Object.assign(row,value));return resolve({data:found,error:null})}};return chain},async rpc(name:string,args:any){calls.push({rpc:name,args});if(name==='wl_research_begin'){const row=rows.wl_research_jobs.find(x=>x.id===args.p_id);if(row)return {data:row};rows.wl_research_jobs.push({id:args.p_id,user_id:args.p_user,status:'running'});return {data:{status:'new'}}}throw new Error('unexpected RPC')},storage:{from(bucket:string){return {async upload(path:string,data:any,options:any){uploads.push({bucket,path,data,options});return {data:{path},error:null}},async createSignedUrl(path:string){return {data:{signedUrl:'https://mcmtasetompygfktzhpr.supabase.co/storage/v1/object/sign/'+bucket+'/'+path}}},async remove(){return {data:[]}}}}}};
 const env=(k:string)=>({GEMINI_API_KEY:'test-google-secret',ELEVENLABS_API_KEY:'test-voice-secret',ELEVENLABS_VOICE_ID:'voice'}[k]);
 const fetcher=async(url:any,init:any)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});if(String(url).includes('elevenlabs'))return new Response(new Uint8Array([73,68,51,1]),{headers:{'Content-Type':'audio/mpeg'}});const body=JSON.parse(init.body),search=!!body.tools;if(mode==='failure')return new Response('{}',{status:503});return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:search?'Producer report for exact wine.':JSON.stringify(candidate)}]},...(search&&mode!=='unsourced'?{groundingMetadata:{groundingChunks:[{web:{title:'Producer',uri:'https://producer.example/wine'}}],searchEntryPoint:{renderedContent:'<div>Google</div>'}}}:{})}]}));};
 return {rows,uploads,calls,user,candidate,setMode:(m:string)=>mode=m,service:createResearchService({db,env,fetch:fetcher as typeof fetch})};
}
Deno.test('research is a draft, source provenance preserved, replay does not call provider, failure never saves',async()=>{
 const f=fixture(),id=crypto.randomUUID(),request={action:'research',query:'Estate 2020',request_id:id};const result=await f.service(f.user,request);
 assert(result.draft.result.vintage===2020);assert(f.rows.user_collection.length===0);assert(f.rows.wl_wine_research.length===1);assert(result.draft.evidence.sources[0].url==='https://producer.example/wine');
 const count=f.calls.filter(x=>x.url).length;await f.service(f.user,request);assert(f.calls.filter(x=>x.url).length===count);
 f.setMode('unsourced');await rejects(()=>f.service(f.user,{...request,request_id:crypto.randomUUID()}));assert(f.rows.wl_wine_research.length===1);
 f.setMode('failure');await rejects(()=>f.service(f.user,{...request,request_id:crypto.randomUUID()}));assert(f.rows.wl_wine_research.length===1);
 await rejects(()=>f.service(f.user,{action:'confirm',confirmed:false}));
});
Deno.test('audio uses own saved notes, persists privately, reuses cached audio and rejects another account',async()=>{
 const f=fixture(),wine={id:crypto.randomUUID(),user_id:f.user,wine_name:'Estate',vintage:2020,notes:'',metadata:{tasting_notes:'Cassis from producer.'}};f.rows.user_collection.push(wine);
 await rejects(()=>f.service('22222222-2222-4222-8222-222222222222',{action:'audio',collection_id:wine.id,request_id:crypto.randomUUID()}));assert(f.calls.length===0);
 const result=await f.service(f.user,{action:'audio',collection_id:wine.id,request_id:crypto.randomUUID()});assert(result.script.includes('Cassis'));assert(f.uploads[0].bucket==='winelens-audio');assert(f.uploads[0].path.startsWith(f.user+'/'));
 const count=f.calls.filter(x=>x.url).length;await f.service(f.user,{action:'audio',collection_id:wine.id,request_id:crypto.randomUUID()});assert(f.calls.filter(x=>x.url).length===count);
 assert(!JSON.stringify(result).includes('test-voice-secret'));
});
