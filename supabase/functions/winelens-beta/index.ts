import { publicContent } from '../_shared/public-content.ts';
import { sharedCatalog } from './shared-catalog.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createIntelligence } from './intelligence.ts';
import { cachedResearch } from './research-cache.ts';
import { createBetaService } from './service.ts';
import { createRequestReserve } from './request-limit.ts';
import { Fault } from '../winelens-research/domain.ts';
const env=(key:string)=>Deno.env.get(key);
const db=createClient(env('SUPABASE_URL')!,env('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const publicService=(requestReserve:(weight:number)=>Promise<boolean>)=>createBetaService({env,fetch,reserve:requestReserve,resolveHost:async host=>(await Promise.allSettled([Deno.resolveDns(host,'A'),Deno.resolveDns(host,'AAAA')])).flatMap(r=>r.status==='fulfilled'?r.value:[]),cacheResearch:(key,build)=>cachedResearch(db,key,build)});
const intelligenceActions=new Set(['daily','daily_archive','daily_saved','translate','sommelier','contribute','contribution_status']);
// This intentionally public beta endpoint has no account/library database access. Community writes and shared AI caches use isolated private tables.
// No shared daily allowance. Independent short request windows contain runaway traffic.
Deno.serve(async(req:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(publicContent(body)),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'POST required.'},405);
 try{
  if(env('SUPABASE_URL')!=='https://mcmtasetompygfktzhpr.supabase.co')throw new Fault(503,'Beta project configuration mismatch.');
  if(Number(req.headers.get('content-length')||0)>17000000)throw new Fault(413,'Request too large.');
  const reader=req.body?.getReader();if(!reader)throw new Fault(400,'Empty request.');
  const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>17000000){await reader.cancel();throw new Fault(413,'Request too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Fault(400,'Invalid request.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Fault(400,'Invalid request.');
  if(size>4500000&&body.action!=='import_menu')throw new Fault(413,'Request too large.');
  if(body.action==='shared_catalog')return respond(await sharedCatalog(db,body.after||''));
  if(body.action==='catalog_anecdotes'){
   // Public editorial content only: never expose run credentials, audit inputs or private notes.
   const {data,error}=await db.from('wl_wine_anecdotes').select('wine_id,title,anecdote,scope,identity_note,generated_at,prompt_version').eq('status','ready').order('wine_id');
   if(error)throw new Fault(503,'Anecdote refresh is unavailable. Bundled notes remain available.');
   return respond({anecdotes:data});
  }
  const reserve=createRequestReserve(db,req,env('SUPABASE_SERVICE_ROLE_KEY')!,body.action);
  return respond(intelligenceActions.has(body.action)?await createIntelligence({db,env,fetch,reserve})(body):await publicService(reserve)(body));
 }catch(error){return respond({error:error instanceof Fault?error.message:'The beta service is temporarily unavailable.'},error instanceof Fault?error.status:503);}
});
