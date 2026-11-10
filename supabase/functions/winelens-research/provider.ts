import catalog from '../winelens-beta/data/catalog.json' with {type:'json'};
import {wineSchema,photoOutline} from '../../../prompts/wine-schema.ts';
import { Fault, text, review, grounding, safeUrl } from './domain.ts';
import { researchPrompt, researchInput } from '../../../prompts/wine-research.ts';
export function createWineProvider(env:(name:string)=>string|undefined,fetcher:typeof fetch){
 const model=env('GEMINI_MODEL')||'gemini-2.5-flash';
 async function google(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string,imageDetail?:string) {
  const key=env('GEMINI_API_KEY');if(!key)throw new Fault(503,'Wine research is not connected yet.');
  const search=mode==='research'||mode==='ask';
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(35000),body:JSON.stringify({systemInstruction:{parts:[{text:researchPrompt(mode)}]},contents:[{role:'user',parts:[{text:input},...(image?[{inlineData:{mimeType:'image/jpeg',data:image}}]:[]),...(imageDetail?[{inlineData:{mimeType:'image/jpeg',data:imageDetail}}]:[])]}],...(search?{tools:[{google_search:{}}]}:{}),generationConfig:{maxOutputTokens:4096,...(!search?{responseMimeType:'application/json'}:{})}})});
  if(!response.ok)throw new Fault(502,'The wine research provider could not complete this request.');
  const result=await response.json(), candidate=result.candidates?.[0];
  if(candidate?.finishReason!=='STOP')throw new Fault(502,'Research was incomplete. Try a clearer photo or a more specific wine name.');
  const answer=(candidate.content?.parts??[]).filter((p:any)=>!p.thought).map((p:any)=>p.text??'').join('\n').trim();
  if(!answer||answer.length>18000)throw new Fault(502,'No usable research result was returned.');
  return {answer,...grounding(candidate)};
 }
 async function openai(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string,imageDetail?:string){
  const key=env('OPENAI_API_KEY');if(!key)throw new Fault(503,'Wine research is not connected yet.');
  const search=mode==='research'||mode==='ask', model=mode==='identify'?(env('SOMMNI_VISION_MODEL')||'gpt-6.1-sol'):(env('SOMMNI_RESEARCH_MODEL')||env('SOMMNI_TEXT_MODEL')||'gpt-4.1-mini');
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(80000),body:JSON.stringify({model,store:false,instructions:researchPrompt(mode,'web'),input:[{role:'user',content:[{type:'input_text',text:researchInput(mode,input)},...(image?[{type:'input_image',image_url:`data:image/jpeg;base64,${image}`,detail:'high'}]:[]),...(imageDetail?[{type:'input_image',image_url:`data:image/jpeg;base64,${imageDetail}`,detail:'high'}]:[])]}],max_output_tokens:4096,...(model.startsWith('gpt-6')?{reasoning:{effort:mode==='identify'?'medium':'low'}}:{}),...(search?{tools:[{type:'web_search'}],tool_choice:'required'}:{text:{format:{type:'json_schema',name:'wine_'+mode,strict:true,schema:wineSchema(mode==='identify')}}})})});
  if(!response.ok){
   const detail=await response.json().catch(()=>({}));
   // Log provider diagnostics only; never log user input, photos, headers or credentials.
   console.error('Wine research provider error',JSON.stringify({mode,model,status:response.status,code:detail.error?.code,type:detail.error?.type,param:detail.error?.param,message:String(detail.error?.message||'').replace(/sk-[\w-]+/g,'[redacted]').slice(0,400)}));
   throw new Fault(502,'The wine research provider could not complete this request.');
  }
  const result=await response.json();if(result.status!=='completed')throw new Fault(502,'Research was incomplete. Try a more specific wine name.');
  const parts=(result.output??[]).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content??[]);
  if(parts.some((p:any)=>p.type==='refusal'))throw new Fault(422,'The wine could not be researched from this input.');
  const sources:{index:number;title:string;url:string}[]=[],supports:{text:string;sources:number[]}[]=[],citations:{start:number;end:number;source:number}[]=[];
  let answer='';
  for(const part of parts){if(part.type!=='output_text'||typeof part.text!=='string')continue;const offset=answer.length;answer+=part.text+'\n';
   for(const a of part.annotations??[]){if(a.type!=='url_citation')continue;const url=safeUrl(a.url);if(!url)continue;let source=sources.find(s=>s.url===url);if(!source){source={index:sources.length,title:String(a.title||'Reference').slice(0,200),url};sources.push(source);}
    if(Number.isInteger(a.start_index)&&Number.isInteger(a.end_index)&&a.start_index>=0&&a.end_index>a.start_index&&a.end_index<=part.text.length){citations.push({start:offset+a.start_index,end:offset+a.end_index,source:source.index});supports.push({text:part.text.slice(Math.max(0,a.start_index-350),a.end_index),sources:[source.index]});}
   }
  }
  answer=answer.trim();if(!answer||answer.length>18000)throw new Fault(502,'No usable research result was returned.');
  if(search&&!sources.length)throw new Fault(422,'No cited web sources returned. Try the producer, cuvée and year together.');
  return {answer,sources:sources.slice(0,30),supports,search_html:'',citations};
 }
 // Keep the established provider interface for both account and free-beta pipelines.
 const gemini=(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string,imageDetail?:string)=>env('GEMINI_API_KEY')?google(mode,input,image,imageDetail):openai(mode,input,image,imageDetail);
 async function structured(mode:'identify'|'structure',input:string,image?:string,imageDetail?:string) {
  // Use the dedicated vision model when available; a partial label is not a complete wine record.
  const labelInput=mode==='identify'?JSON.stringify({request:input,catalog_name_hints:catalog.wines.map(w=>w.name),hint_rules:'These are spelling candidates, not evidence or a required match. Visible lettering or a distinctive recognizable label illustration may suggest a wine and producer. Generic artwork is not sufficient. Artwork-only suggestions must use recognition_basis artwork and describe their visible distinguishing features. Wines outside this list are valid. Never copy a vintage from the catalog. Re-examine small producer script against these names before leaving it unreadable.'}):input;
  const response=await (mode==='identify'&&env('OPENAI_API_KEY')?openai(mode,labelInput,image,imageDetail):gemini(mode,labelInput,image,imageDetail));
  let data:any;
  try{data=JSON.parse(response.answer)}catch{
   console.error('Wine response validation',JSON.stringify({mode,reason:'invalid_json'}));
   throw new Fault(502,'The label service returned an incomplete response. Your photo is kept; retry lookup.');
  }
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Fault(502,'The label service returned an invalid response. Retry lookup.');
  // Normalize provider formatting only. Public confirm/review validation stays strict.
  const colors=['','Red','White','Sparkling','Rosé','Orange','Dessert','Sake'];
  const color=typeof data.color==='string'?colors.find(c=>c.toLowerCase()===data.color.trim().toLowerCase()):'';
  const rawYear=typeof data.vintage==='string'&&/^\d{4}$/.test(data.vintage)?Number(data.vintage):data.vintage;
  const validYear=Number.isInteger(rawYear)&&rawYear>=1800&&rawYear<=new Date().getUTCFullYear()+1;
  const state=data.vintage_state==='non_vintage'?'non_vintage':data.vintage_state==='year'&&validYear?'year':'unknown';
  const normalized={...data,color:color??'',vintage_state:state,vintage:state==='year'?rawYear:null};
  if(mode==='identify')normalized.tasting_notes='';
  const basis=data.recognition_basis==='artwork'?'artwork':data.recognition_basis==='unknown'?'unknown':'label_text',visual=text(data.visual_evidence??'',500);
  if(mode==='identify'&&basis==='artwork'&&String(data.vintage_evidence??'').trim()!==String(normalized.vintage)){normalized.vintage=null;normalized.vintage_state='unknown';}
  if(mode==='identify'&&(basis==='unknown'||(basis==='artwork'&&(!visual.trim()||!String(data.producer||'').trim()))))throw new Fault(422,'This artwork is not distinctive enough for a reliable wine match yet. Include more of the label, or add a producer hint.');
  if(typeof normalized.wine_name!=='string'||!normalized.wine_name.trim())throw new Fault(422,'No clear wine match from this label or artwork. Include more of the design, or enter a producer or wine name.');
  try{return {...review(normalized),uncertainty:text(((mode==='identify'&&basis==='artwork'?'Artwork-based suggestion; confirm the producer and wine before saving. ':'')+String(data.uncertainty??'')).slice(0,700),700),...(mode==='identify'?{recognition_basis:basis,visual_evidence:visual,bottle_outline:photoOutline(data.bottle_outline)}:{})}}catch(error){
   console.error('Wine response validation',JSON.stringify({mode,reason:error instanceof Error?error.message:'invalid_fields'}));
   throw new Fault(502,mode==='identify'?'The label was read, but its details need another pass. Your photo is kept; retry lookup.':'The wine was identified, but reference notes could not be formatted. Your photo is kept; retry lookup.');
  }
 }
 return {gemini,structured};
}

/** Research may enrich a visible identity, but may not replace it or supply a guessed vintage. */
export function alignPhotoCandidate<T extends {wine_name:string;producer:string;vintage:number|null;vintage_state:string}>(candidate:T,label:T|null):T{
 if(!label)return candidate;
 const norm=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const agrees=(a:string,b:string)=>{const x=norm(a),y=norm(b);return x===y||(Math.min(x.length,y.length)>4&&(x.includes(y)||y.includes(x)));};
 if(!agrees(candidate.wine_name,label.wine_name)||(label.producer&&candidate.producer&&!agrees(candidate.producer,label.producer)))throw new Fault(422,`The label reads ${label.wine_name}${label.producer?' by '+label.producer:''}, but the research matched a different bottle. Add the producer or wine name and retry.`);
 return {...candidate,wine_name:label.wine_name,producer:label.producer||candidate.producer,vintage:label.vintage,vintage_state:label.vintage_state};
}
