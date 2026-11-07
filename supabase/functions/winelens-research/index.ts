import { publicContent } from '../_shared/public-content.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createResearchService } from './service.ts';
import { Fault } from './domain.ts';
const env=(name:string)=>Deno.env.get(name);
const projectUrl=env('SUPABASE_URL')||'';
const db=createClient(projectUrl,env('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const service=createResearchService({db,env,fetch});
const allowed=new Set((env('WL_RESEARCH_ORIGINS')||'http://127.0.0.1:5196,http://localhost:5196,https://sommni-beige.vercel.app,https://d3hospitality.github.io,null').split(','));
allowed.add('https://d3hospitality.com');
allowed.add('http://127.0.0.1:5198');
allowed.add('http://127.0.0.1:5188');
allowed.add('http://localhost:5188');
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS',...(origin&&allowed.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(publicContent(body)),{status,headers});
 if(origin&&!allowed.has(origin))return respond({error:'Origin not allowed.'},403);
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
  return respond(await service(data.user.id,body));
 }catch(error){return respond({error:error instanceof Fault?error.message:'The wine service is temporarily unavailable.'},error instanceof Fault?error.status:503);}
});
