import {withBottleAllowance} from '../_shared/bottle-allowance.ts';
import { publicContent } from '../_shared/public-content.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createResearchService } from './service.ts';
import { Fault } from './domain.ts';
const env=(name:string)=>Deno.env.get(name);
const projectUrl=env('SUPABASE_URL')||'';
const db=createClient(projectUrl,env('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const service=createResearchService({db,env,fetch});
// Packaged Even WebViews use device-specific origins. This bearer-only API
// accepts CORS from any origin, like the cutout service; no cookies/credentials.
// getUser, revoked-session checks and collection ownership remain mandatory.
Deno.serve(async(req:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-retry-count,traceparent,tracestate,baggage','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(publicContent(body)),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'POST required.'},405);
 try{
  if(projectUrl!=='https://mcmtasetompygfktzhpr.supabase.co')throw new Fault(503,'Research project configuration mismatch.');
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))throw new Fault(401,'Sign in to research wines.');
  const {data,error}=await db.auth.getUser(auth.slice(7));
  if(error||!data.user)throw new Fault(401,'Sign in again to continue.');
  const claims=JSON.parse(atob(auth.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const linked=await db.from('wl_linked_devices').select('revoked_at').eq('user_id',data.user.id).eq('session_id',claims.session_id).maybeSingle();
  if(linked.error)throw new Fault(503,'Could not check this device session.');
  if(linked.data?.revoked_at)throw new Fault(401,'This device was unlinked.');
  if(Number(req.headers.get('content-length')||0)>4500000)throw new Fault(413,'Photo too large.');
  // Bound the streamed body even when Content-Length is absent.
  const reader=req.body?.getReader();if(!reader)throw new Fault(400,'Empty request.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4500000){await reader.cancel();throw new Fault(413,'Photo too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Fault(400,'Invalid request.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Fault(400,'Invalid request.');
  return respond(await withBottleAllowance(db,'user:'+data.user.id,body,()=>service(data.user.id,body)));
 }catch(error){return respond({code:error instanceof Fault&&error.status===429&&error.message.startsWith('Daily limit reached')?'DAILY_BOTTLE_LIMIT':undefined,error:error instanceof Fault?error.message:'The wine service is temporarily unavailable.'},error instanceof Fault?error.status:503);}
});
