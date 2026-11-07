import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import catalog from '../winelens-beta/data/catalog.json' with {type:'json'};
import { generateAnecdote, ANECDOTE_VERSION } from './generate.ts';
import { hash } from '../winelens-research/domain.ts';
const env=(key:string)=>Deno.env.get(key),db=createClient(env('SUPABASE_URL')!,env('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// A short-lived run credential can only process pre-seeded catalog rows, up to four attempts each.
// It cannot read keys, personal data, alter a run, or create arbitrary provider work.
Deno.serve(async(req:Request)=>{
 const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='POST')return respond({error:'POST required'},405);
 let lease:string|undefined,wineId:string|undefined;
 try{
  const token=req.headers.get('x-anecdote-run')||'';if(!/^[a-f0-9]{64}$/.test(token))return respond({error:'Unauthorized'},401);
  const run=await db.from('wl_anecdote_runs').select('id').eq('token_hash',await hash(token)).eq('status','active').gt('expires_at',new Date().toISOString()).maybeSingle();
  if(run.error||!run.data)return respond({error:'Unauthorized'},401);
  const body=await req.json();if(typeof body.wine_id!=='string')return respond({error:'Wine required'},400);
  const wine=catalog.wines.find(w=>w.id===body.wine_id);if(!wine)return respond({error:'Unknown catalog wine'},400);wineId=wine.id;
  const prior=await db.from('wl_wine_anecdotes').select('status,identity_note').eq('wine_id',wine.id).eq('run_id',run.data.id).maybeSingle();
  if(prior.data?.status==='ready')return respond({wine_id:wine.id,status:'ready',cached:true});
  lease=crypto.randomUUID();const claim=await db.rpc('wl_claim_anecdote',{p_run:run.data.id,p_wine:wine.id,p_lease:lease});if(claim.error||!claim.data)return respond({error:'Not claimable'},409);
  const model=env('SOMMNI_ANECDOTE_MODEL')||'gpt-6.1-sol';
  const input={id:wine.id,name:wine.name,country:wine.country,region:wine.region,grape:wine.grape,catalog_version:catalog.version,research_hint:prior.data?.identity_note||''};
  const logged=await db.from('wl_anecdote_attempts').insert({id:lease,run_id:run.data.id,wine_id:wine.id,model,prompt_version:ANECDOTE_VERSION,input});if(logged.error)throw new Error('Could not start audit log');
  const previous=prior.data?.status==='failed'?await db.from('wl_anecdote_attempts').select('id,research').eq('wine_id',wine.id).eq('status','failed').eq('prompt_version',ANECDOTE_VERSION).order('started_at',{ascending:false}).limit(1).maybeSingle():null;
  const generated=await generateAnecdote(input,env,fetch,previous?.data?.research?{research:previous.data.research,attempt_id:previous.data.id}:undefined);
  const log=await db.from('wl_anecdote_attempts').update({finished_at:new Date().toISOString(),status:generated.result.status,research:generated.research,result:generated.draft,provider_usage:generated.usage}).eq('id',lease);if(log.error)throw new Error('Could not save audit log');
  const saved=await db.from('wl_wine_anecdotes').update({...generated.result,model:generated.model,prompt_version:generated.prompt_version,generated_at:new Date().toISOString(),updated_at:new Date().toISOString(),lease_id:null,lease_until:null}).eq('wine_id',wine.id).eq('lease_id',lease).select('wine_id');if(saved.error||!saved.data?.length)throw new Error('Could not save anecdote');
  return respond({wine_id:wine.id,status:generated.result.status,title:generated.result.title,scope:generated.result.scope});
 }catch(error){const message=error instanceof Error?error.message:'Generation failed';if(lease&&wineId){await db.from('wl_anecdote_attempts').update({status:'failed',error:message,research:(error as any)?.research||null,result:(error as any)?.draft||null,provider_usage:(error as any)?.usage||null,finished_at:new Date().toISOString()}).eq('id',lease);await db.from('wl_wine_anecdotes').update({status:'failed',lease_id:null,lease_until:null,updated_at:new Date().toISOString()}).eq('wine_id',wineId).eq('lease_id',lease);}return respond({error:message},502);}
});
