import { createWineProvider } from '../supabase/functions/winelens-research/provider.ts';
import { createBetaService } from '../supabase/functions/winelens-beta/service.ts';
import { HeadTilt } from '../src/intelligence/motion.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
const wine={wine_name:'Estate',producer:'Example',vintage:2020,vintage_state:'year',region:'Region',country:'France',grape:'Cabernet',color:'Red',tasting_notes:'PALATE\nCassis, from the producer.',uncertainty:'Check label.'};
Deno.test('OpenAI-only research forces search, preserves real citations, and validates structure',async()=>{
 const calls:any[]=[];
 const provider=createWineProvider(k=>k==='OPENAI_API_KEY'?'test':undefined,async(_url,init)=>{
  const b=JSON.parse(String(init?.body));calls.push(b);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:b.tools?'Producer report. [1]':JSON.stringify(wine),annotations:b.tools?[{type:'url_citation',title:'Estate source',url:'https://example.com/wine',start_index:17,end_index:20},{type:'url_citation',url:'javascript:bad',start_index:0,end_index:1}]:[]}]}]});
 });
 const result=await provider.gemini('research','Estate 2020');assert(result.sources.length===1);assert(result.sources[0].url==='https://example.com/wine');assert(calls[0].tools[0].type==='web_search'&&calls[0].tool_choice==='required');assert(calls[0].store===false);
 const parsed=await provider.structured('structure',result.answer);assert(parsed.vintage===2020);assert(!calls[1].tools);assert(calls[1].text.format.type==='json_object');assert(/json/i.test(calls[1].input[0].content[0].text));
});
Deno.test('OpenAI no-citation and incomplete results fail instead of becoming saved research',async()=>{
 for(const status of ['completed','incomplete']){
  // Select OpenAI explicitly; a key for Google would select that provider.
  const q=createWineProvider(k=>k==='OPENAI_API_KEY'?'test':undefined,async()=>Response.json({status,output:[{type:'message',content:[{type:'output_text',text:'Unverified',annotations:[]}]}]}));
  let failed=false;try{await q.gemini('research','Wine')}catch{failed=true}assert(failed);
 }
});
Deno.test('shared research reuses provider work but never shares photos or draft IDs',async()=>{
 let spends=0,calls=0;const cache=new Map<string,any>();
 const action=createBetaService({env:k=>k==='GEMINI_API_KEY'?'test':undefined,reserve:async()=>{spends++;return true},cacheResearch:async(key,build)=>{if(cache.has(key))return {...cache.get(key),cached:true};const r=await build();cache.set(key,r);return r;},fetch:async(_url,init)=>{calls++;const b=JSON.parse(String(init?.body));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:b.tools?'Sourced report':JSON.stringify(wine)}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://example.com',title:'Source'}}]}}]});}});
 const a=await action({action:'research',query:'Estate 2020'}),b=await action({action:'research',query:'  ESTATE   2020 '});assert(spends===1&&calls===2);assert(b.cached&&a.draft.id!==b.draft.id);
 await action({action:'research',query:'Estate 2020',refresh:true});assert(spends===2&&calls===4);
 await action({action:'research',query:'Estate 2020',photo:'data:image/jpeg;base64,/9j/AA=='});assert(spends===3&&calls===7);assert(cache.size===1);
});
Deno.test('head tilt rejects bad data, filters jolts, is scale independent and resets center',()=>{
 const a=new HeadTilt(),b=new HeadTilt();assert(a.sample({x:NaN,y:0,z:1})===null);assert(a.sample({x:0,y:0,z:0})===null);
 a.sample({x:0,y:0,z:1});b.sample({x:0,y:0,z:9.81});let p:any,q:any;
 for(let i=0;i<15;i++){p=a.sample({x:0,y:Math.sin(.3),z:Math.cos(.3)});q=b.sample({x:0,y:9.81*Math.sin(.3),z:9.81*Math.cos(.3)});}
 assert(p.roll===q.roll&&p.roll>=.25&&p.roll<=.4);assert(a.sample({x:100,y:0,z:0})===null);a.reset();assert(a.sample({x:0,y:Math.sin(.3),z:Math.cos(.3)})?.roll===0);
});
