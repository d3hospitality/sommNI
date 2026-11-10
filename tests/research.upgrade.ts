import { createWineProvider, alignPhotoCandidate } from '../supabase/functions/winelens-research/provider.ts';
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
 const parsed=await provider.structured('structure',result.answer);assert(parsed.vintage===2020);assert(!calls[1].tools);assert(calls[1].text.format.type==='json_schema'&&calls[1].text.format.strict===true);assert(/json/i.test(calls[1].input[0].content[0].text));
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
Deno.test('photo identification uses vision, tolerates provider formatting and keeps missing facts unknown',async()=>{
 const calls:any[]=[];
 const provider=createWineProvider(k=>k==='OPENAI_API_KEY'||k==='GEMINI_API_KEY'?'test':undefined,async(url,init)=>{
  const b=JSON.parse(String(init?.body));calls.push({url,b});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...wine,wine_name:'Irrosso',producer:'Casanova di Neri',color:'red',vintage:'2022',bottle_outline:{top:.02,bottom:.95,left:Array(12).fill(.3),right:Array(12).fill(.7)}})}]}]});
 });
 const result=await provider.structured('identify','Read label','/9j/AA==','/9j/AQ==');
 assert(result.wine_name==='Irrosso'&&result.color==='Red'&&result.vintage===2022);
 assert(result.tasting_notes==='');assert(result.bottle_outline?.left.length===12);
 assert(calls[0].b.model==='gpt-6.1-sol');assert(calls[0].b.input[0].content.length===3);assert(calls[0].b.input[0].content[0].text.includes('catalog_name_hints'));assert(calls[0].b.input[0].content[1].detail==='high');assert(calls[0].b.text.format.strict===true);
});
Deno.test('unreadable labels and malformed responses are different errors; invalid geometry is discarded',async()=>{
 const make=(answer:string)=>createWineProvider(k=>k==='OPENAI_API_KEY'?'test':undefined,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:answer}]}]}));
 for(const [answer,status] of [['not JSON',502],[JSON.stringify({...wine,wine_name:''}),422]] as const){let error:any;try{await make(answer).structured('identify','Read label','/9j/AA==')}catch(e){error=e}assert(error?.status===status);}
 const r=await make(JSON.stringify({...wine,vintage:'n/a',vintage_state:'unknown',bottle_outline:{top:-.5,bottom:1,left:[],right:[]}})).structured('identify','Read label','/9j/AA==');
 assert(r.vintage===null&&r.bottle_outline===null);
});

Deno.test('web research cannot replace a photographed producer or guess its vintage',()=>{
 const label={...wine,wine_name:'Irrosso',producer:'Casanova di Neri',vintage:null,vintage_state:'unknown'};
 const result=alignPhotoCandidate({...label,vintage:2023,vintage_state:'year'},label);assert(result.vintage===null&&result.vintage_state==='unknown');
 let rejected=false;try{alignPhotoCandidate({...label,producer:'Castello di Gabbiano'},label)}catch{rejected=true}assert(rejected);
});

Deno.test('distinctive artwork can suggest a wine without readable lettering; no inferred vintage',async()=>{
 const make=(data:any)=>createWineProvider(k=>k==='OPENAI_API_KEY'?'test':undefined,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]}));
 const art={...wine,wine_name:'Palermo',producer:'Orin Swift',recognition_basis:'artwork',visual_evidence:'Sepia portrait of a dressed skeletal figure on an aged paper label.',vintage:2020,vintage_state:'year',vintage_evidence:''};
 const r=await make(art).structured('identify','Match label artwork','/9j/AA==');assert(r.wine_name==='Palermo'&&r.recognition_basis==='artwork');assert(r.vintage===null&&r.vintage_state==='unknown');assert(r.uncertainty.startsWith('Artwork-based suggestion'));
 for(const data of [{...art,recognition_basis:'unknown'},{...art,visual_evidence:''},{...art,producer:''}]){let rejected=false;try{await make(data).structured('identify','Art','/9j/AA==')}catch(e){rejected=(e as any).status===422}assert(rejected);}
});
Deno.test('artwork basis and warning survive shared research and its evidence record',async()=>{
 const art={...wine,recognition_basis:'artwork',visual_evidence:'Distinctive illustrated scene',vintage_evidence:'',vintage:null,vintage_state:'unknown'};
 const action=createBetaService({env:k=>k==='GEMINI_API_KEY'?'test':undefined,reserve:async()=>true,fetch:async(_url,init)=>{const b=JSON.parse(String(init?.body));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:b.tools?'Sourced report':JSON.stringify(art)}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://example.com',title:'Source'}}]}}]});}});
 const r=await action({action:'research',photo:'data:image/jpeg;base64,/9j/AA=='});assert(r.draft.result.recognition_basis==='artwork');assert(r.draft.result.uncertainty.startsWith('Artwork-based suggestion'));assert(r.draft.evidence.label.visual_evidence===art.visual_evidence);
});
