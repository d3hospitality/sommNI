import { Fault, text, review, grounding, safeUrl } from './domain.ts';
import { researchPrompt, researchInput } from '../../../prompts/wine-research.ts';
export function createWineProvider(env:(name:string)=>string|undefined,fetcher:typeof fetch){
 const model=env('GEMINI_MODEL')||'gemini-2.5-flash';
 async function google(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string) {
  const key=env('GEMINI_API_KEY');if(!key)throw new Fault(503,'Wine research is not connected yet.');
  const search=mode==='research'||mode==='ask';
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(35000),body:JSON.stringify({systemInstruction:{parts:[{text:researchPrompt(mode)}]},contents:[{role:'user',parts:[{text:input},...(image?[{inlineData:{mimeType:'image/jpeg',data:image}}]:[])]}],...(search?{tools:[{google_search:{}}]}:{}),generationConfig:{maxOutputTokens:4096,...(!search?{responseMimeType:'application/json'}:{})}})});
  if(!response.ok)throw new Fault(502,'The wine research provider could not complete this request.');
  const result=await response.json(), candidate=result.candidates?.[0];
  if(candidate?.finishReason!=='STOP')throw new Fault(502,'Research was incomplete. Try a clearer photo or a more specific wine name.');
  const answer=(candidate.content?.parts??[]).filter((p:any)=>!p.thought).map((p:any)=>p.text??'').join('\n').trim();
  if(!answer||answer.length>18000)throw new Fault(502,'No usable research result was returned.');
  return {answer,...grounding(candidate)};
 }
 async function openai(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string){
  const key=env('OPENAI_API_KEY');if(!key)throw new Fault(503,'Wine research is not connected yet.');
  const search=mode==='research'||mode==='ask', model=env('SOMMNI_RESEARCH_MODEL')||env('SOMMNI_TEXT_MODEL')||'gpt-4.1-mini';
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(80000),body:JSON.stringify({model,store:false,instructions:researchPrompt(mode,'web'),input:[{role:'user',content:[{type:'input_text',text:researchInput(mode,input)},...(image?[{type:'input_image',image_url:`data:image/jpeg;base64,${image}`,detail:'high'}]:[])]}],max_output_tokens:4096,...(model.startsWith('gpt-6')?{reasoning:{effort:'low'}}:{}),...(search?{tools:[{type:'web_search'}],tool_choice:'required'}:{text:{format:{type:'json_object'}}})})});
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
 const gemini=(mode:'identify'|'research'|'structure'|'ask',input:string,image?:string)=>env('GEMINI_API_KEY')?google(mode,input,image):openai(mode,input,image);
 async function structured(mode:'identify'|'structure',input:string,image?:string) {
  const response=await gemini(mode,input,image);
  try{const data=JSON.parse(response.answer);return {...review(data),uncertainty:text(data.uncertainty??'',700)}}catch{throw new Fault(502,'The wine identity is not clear enough. Try a clearer label or a more specific name.');}
 }
 return {gemini,structured};
}
