import { ANECDOTE_VERSION, anecdoteResearchPrompt, anecdoteEditPrompt } from '../../../prompts/wine-anecdotes.ts';
import { safeUrl, Fault } from '../winelens-research/domain.ts';
export { ANECDOTE_VERSION };
export function validateAnecdote(data:any,sources:any[]){
 if(!data||!['wine','producer','uncertain'].includes(data.scope)||typeof data.title!=='string'||data.title.length>100||typeof data.identity_note!=='string'||data.identity_note.length>700)throw new Error('Invalid anecdote identity');
 if(data.scope==='uncertain')return {title:data.title,scope:data.scope,anecdote:'',identity_note:data.identity_note,sources:[],status:'needs_review'};
 if(!Array.isArray(data.paragraphs)||data.paragraphs.length!==2||data.paragraphs.some((p:any)=>typeof p!=='string'||p.trim().length<50))throw new Error('Two substantive paragraphs required');
 const anecdote=data.paragraphs.map((p:string)=>p.trim()).join('\n\n');
 if(anecdote.length>850||new TextEncoder().encode(anecdote).length>1000)throw new Error('Anecdote exceeds display budget');
 if(!Array.isArray(data.paragraph_sources)||data.paragraph_sources.length!==2||data.paragraph_sources.some((a:any)=>!Array.isArray(a)||!a.length||a.some((n:any)=>!Number.isInteger(n)||!sources.some(s=>s.index===n))))throw new Error('Each paragraph needs real supporting sources');
 const used=new Set(data.paragraph_sources.flat());
 return {title:data.title.trim(),scope:data.scope,anecdote,identity_note:data.identity_note.trim(),sources:sources.filter(s=>used.has(s.index)),status:'ready'};
}
export async function generateAnecdote(wine:any,env:(s:string)=>string|undefined,fetcher:typeof fetch,prior?:{research:any;attempt_id:string}){
 const key=env('OPENAI_API_KEY');if(!key)throw new Fault(503,'OpenAI is not configured');
 const model=env('SOMMNI_ANECDOTE_MODEL')||'gpt-6.1-sol';
 const input={name:wine.name,country:wine.country,region:wine.region,grape:wine.grape,identity_note:wine.research_hint||'',vintage:'Only if explicitly present in name; otherwise unknown'};
 const api=async(path:string,body:any)=>{const r=await fetcher('https://api.openai.com/v1/'+path,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const data=await r.json();if(!r.ok)throw new Error(`OpenAI ${r.status}: ${String(data.error?.code||data.error?.type||'provider error')}`);return data;};
 let research:any,researchUsage:any;
 if(prior?.research?.report&&Array.isArray(prior.research.sources)&&prior.research.sources.length&&prior.research.sources.every((s:any)=>Number.isInteger(s.index)&&safeUrl(s.url))){research=prior.research;researchUsage={reused_from_attempt:prior.attempt_id};}
 else {
 const raw=await api('responses',{model,store:false,instructions:anecdoteResearchPrompt(),input:JSON.stringify(input),tools:[{type:'web_search'}],tool_choice:'required',max_output_tokens:5000,...(model.startsWith('gpt-6')?{reasoning:{effort:'low'}}:{})});
 if(raw.status!=='completed')throw new Error('Incomplete wine research');
 const parts=(raw.output||[]).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]).filter((p:any)=>p.type==='output_text');
 const report=parts.map((p:any)=>p.text).join('\n'),sources:any[]=[];
 for(const p of parts)for(const a of p.annotations||[]){const url=a.type==='url_citation'&&safeUrl(a.url);if(url&&!sources.some(s=>s.url===url))sources.push({index:sources.length,title:String(a.title||new URL(url).hostname).slice(0,180),url});}
 if(!report||!sources.length)throw new Error('No sourced wine research returned');
 research={report,sources,response_id:raw.id};researchUsage=raw.usage;
 }
 const {report,sources}=research;let draft:any,editingUsage:any;
 try{
 const edited=await api('chat/completions',{model,store:false,messages:[{role:'system',content:anecdoteEditPrompt()},{role:'user',content:JSON.stringify({wine:input,report,sources})}],response_format:{type:'json_schema',json_schema:{name:'wine_anecdote',strict:true,schema:{type:'object',additionalProperties:false,required:['title','scope','paragraphs','paragraph_sources','identity_note'],properties:{title:{type:'string'},scope:{type:'string',enum:['wine','producer','uncertain']},paragraphs:{type:'array',items:{type:'string'}},paragraph_sources:{type:'array',items:{type:'array',items:{type:'integer'}}},identity_note:{type:'string'}}}}},max_completion_tokens:4000,...(model.startsWith('gpt-6')?{reasoning_effort:'low'}:{})});
 if(edited.choices?.[0]?.finish_reason!=='stop')throw new Error('Incomplete anecdote');
 editingUsage=edited.usage;draft=JSON.parse(edited.choices[0].message.content);const result=validateAnecdote(draft,sources);
 return {result,research,draft,usage:{research:researchUsage,editing:editingUsage},model,prompt_version:ANECDOTE_VERSION};
 }catch(error){throw Object.assign(error as Error,{research,draft,usage:{research:researchUsage,editing:editingUsage}});}
}
