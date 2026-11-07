import { validateCommunityArtwork, saveCommunityArtwork } from './community-artwork.ts';
import { STUDY_CONCEPTS } from './data/study-concepts.ts';
import frozen from './data/catalog.json' with { type:'json' };
import { dailyPrompt, sommelierPrompt, translationPrompt } from '../../../prompts/intelligence.ts';
import { Fault, text } from '../winelens-research/domain.ts';
export const LANGUAGES={en:'English',es:'Español',fr:'Français',it:'Italiano',de:'Deutsch',pt:'Português',ja:'日本語',zh:'中文',ko:'한국어'} as const;
export const INTELLIGENCE_VERSION='2';
export const DAILY_VERSION='6';
const catalog=frozen.wines;
type DB=any;
type Deps={db:DB;env:(key:string)=>string|undefined;fetch:typeof fetch;reserve:(weight:number)=>Promise<boolean>};
const str={type:'string'};
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=(items:unknown)=>({type:'array',items});
export function dailySlots(wines:ReturnType<typeof dayWines>){
 return wines.flatMap((wine,i)=>{
  const evidence=evidenceFor(wine);
  const identity=norm(wine.name).includes(norm(wine.grape))?'style':'grape';
  const keys=i<4?[identity,evidence.context?'context':'origin','palate']:['origin',i%2?'aroma':'palate'];
  return keys.map(evidence_key=>({wine,evidence_key}));
 }).map((slot,i)=>({key:`q${i+1}`,...slot}));
}
export function dailySchema(wines:ReturnType<typeof dayWines>,slots=dailySlots(wines)){
 return object({questions:object(Object.fromEntries(slots.map(({key,wine,evidence_key})=>[key,object({
  wine_id:{type:'string',enum:[wine.id]},question:str,options:{...array(str),minItems:4,maxItems:4},
  correct_index:{type:'integer',minimum:0,maximum:3},explanation:str,
  lesson:object({in_the_glass:str,key_detail:object({concept_id:{type:'string',enum:Object.keys(STUDY_CONCEPTS)},term:str,meaning:str}),try_this:str,profile_keys:{type:'array',items:{type:'string',enum:Object.keys(evidenceFor(wine))},minItems:1,maxItems:4}}),
  evidence_key:{type:'string',enum:[evidence_key]},
 })])))});
}
const finderSchema=object({message:str,question:str,suggestions:array(str),matches:array(object({wine_id:str,reason:str,tradeoff:str}))});
const translationsSchema=object({texts:array(str)});
export const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const norm=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function dayWines(day:string){
 const n=Math.floor(Date.parse(day+'T00:00:00Z')/86400000);
 if(!Number.isFinite(n))throw new Fault(400,'Invalid study date.');
 // Coprime stride visits every catalog wine; eight unique wines every day.
 return Array.from({length:8},(_,i)=>catalog[((n*8+i)*37%catalog.length+catalog.length)%catalog.length]);
}
export function evidenceFor(wine:typeof catalog[number]):Record<string,string>{
 const evidence:Record<string,string>={grape: wine.grape,origin: `${wine.region} · ${wine.country}`,style: wine.style,appearance: wine.appearance,aroma: wine.nose,palate: wine.palate,finish:wine.finish};
 if(wine.context && wine.source && !['veneto','maconnais'].includes(wine.context.source))evidence.context=wine.context.cue+' '+wine.context.detail;
 return evidence;
}
export function validateDaily(result:any,wines=dayWines(new Date().toISOString().slice(0,10))){
 if(!Array.isArray(result?.questions)||result.questions.length!==20)throw new Fault(502,'The daily flight was incomplete. Please retry.');
 const counts=new Map<string,number>(),seen=new Set<string>();
 for(const q of result.questions){
  const wine=wines.find(w=>w.id===q.wine_id),evidence=wine?evidenceFor(wine):{};
  if(!wine||!evidence[q.evidence_key]||typeof q.evidence_quote!=='string'||q.evidence_quote.length<3||!evidence[q.evidence_key].includes(q.evidence_quote))throw new Fault(502,'A question could not be traced to its reference. Please retry.');
  for(const [key,max] of [['question',500],['explanation',1300],['evidence_quote',1000]] as const)if(typeof q[key]!=='string'||!q[key].trim()||q[key].length>max)throw new Fault(502,'Invalid question format.');
  if(!Array.isArray(q.options)||q.options.length!==4||q.options.some((v:unknown)=>typeof v!=='string'||!v.trim()||v.length>300)||new Set(q.options.map(norm)).size!==4||!Number.isInteger(q.correct_index)||q.correct_index<0||q.correct_index>3)throw new Fault(502,'Invalid question options.');
  const lesson=q.lesson;
  if(!lesson||!lesson.key_detail||!Object.prototype.hasOwnProperty.call(STUDY_CONCEPTS,lesson.key_detail.concept_id))throw new Fault(502,'The teaching detail is missing its reference. Please retry.');
  for(const [value,max] of [[lesson.in_the_glass,650],[lesson.key_detail.term,80],[lesson.key_detail.meaning,650],[lesson.try_this,350]] as const)if(typeof value!=='string'||!value.trim()||value.length>max)throw new Fault(502,'The tasting lesson was incomplete. Please retry.');
  if(!Array.isArray(lesson.profile_keys)||!lesson.profile_keys.length||lesson.profile_keys.length>4||new Set(lesson.profile_keys).size!==lesson.profile_keys.length||lesson.profile_keys.some((key:unknown)=>typeof key!=='string'||!Object.prototype.hasOwnProperty.call(evidence,key)))throw new Fault(502,'The tasting lesson could not be traced to this wine.');
  if(!lesson.profile_keys.some((key:string)=>['style','appearance','aroma','palate','finish'].includes(key)))throw new Fault(502,'The tasting expectation needs a sensory reference.');
  if(new Set([q.explanation,lesson.in_the_glass,lesson.key_detail.meaning,lesson.try_this].map(norm)).size!==4)throw new Fault(502,'The tasting lesson repeated itself. Please retry.');
  if(seen.has(norm(q.question)))throw new Fault(502,'Repeated question. Please retry.');
  seen.add(norm(q.question));counts.set(wine.id,(counts.get(wine.id)??0)+1);
 }
 if(wines.some((w,i)=>counts.get(w.id)!==(i<4?3:2)))throw new Fault(502,'The daily flight did not cover all eight wines. Please retry.');
 return result.questions.map((q:any,i:number)=>{
  const wine=wines.find(w=>w.id===q.wine_id)!,profile=evidenceFor(wine),catalogSource={publisher:'sommNI catalog',title:'Catalog reference; exact vintage unconfirmed',url:''};
  // Shuffle once before saving; provider answer-position bias must not become a quiz shortcut.
  const choices=q.options.map((value:string,index:number)=>({value,correct:index===q.correct_index}));
  for(let j=choices.length-1;j>0;j--){const other=crypto.getRandomValues(new Uint32Array(1))[0]%(j+1);[choices[j],choices[other]]=[choices[other],choices[j]];}
  return {...q,options:choices.map((c:any)=>c.value),correct_index:choices.findIndex((c:any)=>c.correct),id:`q${i+1}`,subject:wine.name,source:q.evidence_key==='context'?wine.source:(wine as any).field_sources?.[q.evidence_key]??catalogSource,
   lesson:{...q.lesson,key_detail:{...q.lesson.key_detail,source:STUDY_CONCEPTS[q.lesson.key_detail.concept_id].source},references:q.lesson.profile_keys.map((key:string)=>({key,quote:profile[key],source:key==='context'?wine.source:(wine as any).field_sources?.[key]??catalogSource}))}};
 });
}
export function createIntelligence({db,env,fetch:fetcher,reserve}:Deps){
 const spend=async(weight:number)=>{if(!await reserve(weight))throw new Fault(429,'Several requests are running from this connection. Wait one minute and retry.');};
 const ready=()=>!!env('OPENAI_API_KEY');
 async function generate(prompt:string,schema:unknown,tokens=5000,model=env('SOMMNI_TEXT_MODEL')||'gpt-4.1-mini'){
  if(!ready())throw new Fault(503,'Live GPT features need the sommNI server API key. Saved notes and reference practice still work.');
  const response=await fetcher('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${env('OPENAI_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:prompt}],response_format:{type:'json_schema',json_schema:{name:'winelens',strict:true,schema}},max_completion_tokens:tokens,...(model.startsWith('gpt-6')?{reasoning_effort:'low'}:{}),store:false}),signal:AbortSignal.timeout(100000)});
  if(!response.ok)throw new Fault(502,'GPT could not finish this request. Please try again.');
  const data=await response.json();const choice=data.choices?.[0];
  if(choice?.finish_reason!=='stop'||choice.message?.refusal)throw new Fault(502,'GPT did not return a complete answer.');
  try{return JSON.parse(choice.message.content);}catch{throw new Fault(502,'The response was unreadable.');}
 }
 async function cached(key:string,kind:string,locale:string,build:()=>Promise<unknown>){
  const {data,error}=await db.from('wl_beta_content').select('payload').eq('cache_key',key).maybeSingle();
  if(error)throw new Fault(503,'Shared study storage is not ready yet.');
  if(data?.payload)return {...data.payload,cached:true};
  if(!ready())throw new Fault(503,'Live GPT features need the sommNI server API key. Saved notes and reference practice still work.');
  const lease=crypto.randomUUID();const lock=await db.rpc('wl_beta_claim_content',{p_key:key,p_kind:kind,p_locale:locale,p_lease:lease});
  if(lock.error)throw new Fault(503,'Shared study storage is unavailable.');
  if(!lock.data)throw new Fault(409,'This shared edition is being prepared. Try again in a moment.');
  try{
   const payload=await build();const saved=await db.from('wl_beta_content').update({payload,lease_id:null,lease_until:null}).eq('cache_key',key).eq('lease_id',lease).select('cache_key');
   if(saved.error||!saved.data?.length)throw new Fault(503,'The result could not be saved. Please retry.');
   return {...payload as object,cached:false};
  }catch(error){await db.from('wl_beta_content').delete().eq('cache_key',key).eq('lease_id',lease);throw error;}
 }
 return async(body:any):Promise<any>=>{
  const locale=body.locale??'en';if(typeof locale!=='string'||!Object.prototype.hasOwnProperty.call(LANGUAGES,locale))throw new Fault(400,'Choose a supported language.');
  if(body.action==='daily'){
   const today=new Date().toISOString().slice(0,10),day=body.day??today;
   if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>today||day<'2026-10-19')throw new Fault(400,'Choose today or a previous study date.');
   const key=`daily:${DAILY_VERSION}:${frozen.version}:${day}:${locale}`;
   const wines=dayWines(day);
   return cached(key,'daily',locale,async()=>{
    // Old editions are retrievable, but a caller cannot generate an unlimited archive.
    if(day!==today)throw new Fault(404,'No saved edition exists for that day and language.');
    await spend(5);
    const slots=dailySlots(wines);
    // Small, bounded batches keep the richer flight within the edge request deadline.
    const batches=Array.from({length:4},(_,i)=>slots.slice(i*5,i*5+5));
    const replies=await Promise.all(batches.map(async batch=>{
     const reply=await generate(dailyPrompt({language:LANGUAGES[locale as keyof typeof LANGUAGES],day,wines:wines.map(w=>({wine_id:w.id,name:w.name,profile:evidenceFor(w)})),teaching_concepts:STUDY_CONCEPTS,slots:batch.map(({key,wine,evidence_key})=>({key,wine_id:wine.id,evidence_key,reference:evidenceFor(wine)[evidence_key]}))}),dailySchema(wines,batch),7000,env('SOMMNI_STUDY_MODEL')||'gpt-6.1-sol');
     if(!reply?.questions||Object.keys(reply.questions).length!==batch.length||batch.some(({key})=>!reply.questions[key]))throw new Fault(502,'A study lesson batch was incomplete. Please retry.');
     return reply.questions;
    }));
    const result={questions:Object.assign({},...replies)};
    if(!result?.questions||Array.isArray(result.questions)||Object.keys(result.questions).length!==20||slots.some(({key,wine,evidence_key})=>result.questions[key]?.wine_id!==wine.id||result.questions[key]?.evidence_key!==evidence_key))throw new Fault(502,'The daily flight was incomplete. Please retry.');
    // Attach the selected source verbatim; a model must never rewrite its citation.
    const questions=validateDaily({questions:slots.map(({key,wine})=>({...result.questions[key],evidence_quote:evidenceFor(wine)[result.questions[key].evidence_key]}))},wines);
    return {id:key,day,locale,version:DAILY_VERSION,catalog_version:frozen.version,wines:wines.map(w=>({id:w.id,name:w.name})),questions,created_at:new Date().toISOString()};
   });
  }
  if(body.action==='daily_archive'){
   const {data,error}=await db.from('wl_beta_content').select('cache_key,created_at,payload').eq('kind','daily').eq('locale',locale).not('payload','is',null).order('created_at',{ascending:false}).limit(35);
   if(error)throw new Fault(503,'The study archive is unavailable.');
   // Keep older days available across prompt revisions; show the newest edition for each day.
   const days=new Set<string>();
   return {editions:(data??[]).filter((r:any)=>{if(days.has(r.payload.day))return false;days.add(r.payload.day);return true;}).map((r:any)=>({id:r.cache_key,day:r.payload.day,locale:r.payload.locale,wines:r.payload.wines}))};
  }
  if(body.action==='daily_saved'){
   const id=text(body.id,160,true);if(!id.startsWith('daily:'))throw new Fault(400,'Invalid edition.');
   const {data,error}=await db.from('wl_beta_content').select('payload').eq('cache_key',id).eq('kind','daily').maybeSingle();
   if(error||!data?.payload)throw new Fault(404,'Saved study not found.');return {...data.payload,cached:true};
  }
  if(body.action==='translate'){
   if(!Array.isArray(body.texts)||!body.texts.length||body.texts.length>60)throw new Fault(400,'Choose a shorter set of notes.');
   const texts=body.texts.map((s:unknown)=>text(s,5000));if(texts.join('').length>24000)throw new Fault(413,'These notes are too long to translate together.');
   if(locale==='en')return {texts,locale};
   const key=`translation:${INTELLIGENCE_VERSION}:${locale}:${await hash(JSON.stringify(texts))}`;
   return cached(key,'translation',locale,async()=>{await spend(2);const result=await generate(translationPrompt({language:LANGUAGES[locale as keyof typeof LANGUAGES],texts}),translationsSchema,10000);
    if(!Array.isArray(result.texts)||result.texts.length!==texts.length||result.texts.some((s:unknown)=>typeof s!=='string'||s.length>9000))throw new Fault(502,'The translation was incomplete.');return {texts:result.texts,locale};});
  }
  if(body.action==='sommelier'){
   if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>24)throw new Fault(400,'Start a new conversation.');
   const messages=body.messages.map((m:any)=>({role:m.role==='assistant'?'assistant':'user',content:text(m.content,1600,true)}));
   if(!ready())throw new Fault(503,'Your sommelier needs the sommNI server API key. Browse Wine by Grape meanwhile.');
   await spend(1);
   const result=await generate(sommelierPrompt({language:LANGUAGES[locale as keyof typeof LANGUAGES],messages,catalog:catalog.map(w=>({id:w.id,name:w.name,type:w.type,grape:w.grape,region:w.region,country:w.country,style:w.style,nose:w.nose,palate:w.palate})),prices_available:false,stock_available:false}),finderSchema,3500);
   if(typeof result.message!=='string'||result.message.length>2400||typeof result.question!=='string'||result.question.length>600||!Array.isArray(result.suggestions)||result.suggestions.length>5||result.suggestions.some((s:unknown)=>typeof s!=='string'||s.length>180)||!Array.isArray(result.matches)||result.matches.length>3)throw new Fault(502,'The sommelier response was incomplete.');
   const seen=new Set<string>();for(const match of result.matches){if(!catalog.some(w=>w.id===match.wine_id)||seen.has(match.wine_id)||typeof match.reason!=='string'||match.reason.length>1200||typeof match.tradeoff!=='string'||match.tradeoff.length>700)throw new Fault(502,'A suggested wine could not be matched to the catalog.');seen.add(match.wine_id);}
   return result;
  }
  if(body.action==='contribute'){
   if(body.consent!==true)throw new Fault(400,'Please agree to share this wine for review.');
   const receipt=text(body.receipt,64,true);if(!/^[a-f0-9]{64}$/.test(receipt))throw new Fault(400,'Invalid submission receipt.');
   const token_hash=await hash(receipt),prior=await db.from('wl_community_receipts').select('wine_id').eq('token_hash',token_hash).maybeSingle();
   if(prior.error)throw new Fault(503,'The community review queue is not ready yet.');
   if(prior.data)return {id:prior.data.wine_id,received:true,duplicate:true};
   const wine_name=text(body.wine_name,200,true),producer=text(body.producer??'',160)||'Unknown producer',vintage=text(body.vintage,8,true);
   if(!/^(NV|unknown|\d{4})$/.test(vintage)||(/^\d/.test(vintage)&&(Number(vintage)<1800||Number(vintage)>new Date().getUTCFullYear()+1)))throw new Fault(400,'Choose a vintage year, NV, or unknown.');
   if(wine_name.length<2||producer.length<2)throw new Fault(400,'Enter the wine and producer names.');
   const details=text(body.details??'',1800),reference_url=text(body.reference_url??'',600);
   if(reference_url){try{const url=new URL(reference_url);if(url.protocol!=='https:'||url.username||url.password)throw 0;}catch{throw new Fault(400,'Use an https reference link.');}}
   const artwork=await validateCommunityArtwork(body.artwork);
   const fields={wine_name,producer,vintage,country:text(body.country??'',100),region:text(body.region??'',150),grape:text(body.grape??'',150),reference_url,details,beverage_metadata:Object.fromEntries(['sake_classification','sake_style','rice_variety'].map(k=>[k,text(body[k]??'',200)]).filter(([,v])=>v)),color:text(body.color??'',30),tasting_notes:text(body.tasting_notes??'',12000)};
   const identity_key=await hash([wine_name,producer,vintage,fields.country].map(norm).join('|'));
   const match=catalog.find(w=>norm(w.name)===norm(wine_name+' – '+producer)||norm(w.name)===norm(wine_name));
   await spend(artwork?4:1);
   const insert=await db.from('wl_community_wines').upsert({...fields,status:producer==='Unknown producer'?'needs_details':'pending',identity_key,catalog_match:match?.id??null},{onConflict:'identity_key',ignoreDuplicates:true});
   if(insert.error)throw new Fault(503,'We could not save this suggestion. Retry with the same receipt.');
   const row=await db.from('wl_community_wines').select('id,status').eq('identity_key',identity_key).single();if(row.error)throw new Fault(503,'We could not retrieve your receipt.');
   // Later artwork submissions can fill missing public reference notes without overwriting earlier evidence.
   const enrichment=await db.from('wl_community_wines').update({...(fields.color.toLowerCase()==='sake'?{beverage_metadata:fields.beverage_metadata}:{}),...(fields.color?{color:fields.color}:{}),...(fields.tasting_notes?{tasting_notes:fields.tasting_notes}:{})}).eq('id',row.data.id);if(enrichment.error)throw new Fault(503,'Wine details could not be completed. Retry the same submission.');
   await saveCommunityArtwork(db,row.data.id,artwork);
   const saved=await db.from('wl_community_receipts').upsert({token_hash,wine_id:row.data.id,evidence:fields},{onConflict:'token_hash',ignoreDuplicates:true});
   if(saved.error)throw new Fault(503,'We could not save your receipt. Please retry.');
   return {id:row.data.id,received:true,status:row.data.status,catalog_match:match?.id??null};
  }
  if(body.action==='contribution_status'){
   const receipt=text(body.receipt,64,true);if(!/^[a-f0-9]{64}$/.test(receipt))throw new Fault(400,'Invalid receipt.');
   const row=await db.from('wl_community_receipts').select('wine_id').eq('token_hash',await hash(receipt)).maybeSingle();
   if(row.error||!row.data)throw new Fault(404,'No submission matches this receipt.');
   const wine=await db.from('wl_community_wines').select('status,release_version,wine_name,producer,vintage').eq('id',row.data.wine_id).single();
   if(wine.error)throw new Fault(503,'Status is temporarily unavailable.');return wine.data;
  }
  throw new Fault(400,'Unknown intelligence action.');
 };
}
