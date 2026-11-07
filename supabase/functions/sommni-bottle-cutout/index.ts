import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createBottleService} from './service.ts';
import {BottleError} from './pipeline.ts';
const project=Deno.env.get('SUPABASE_URL');
const db=createClient(project!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const service=createBottleService(db);
// Gateway JWT verification MUST remain enabled. The anon role may process its supplied
// photograph, but has no direct access to cache tables or either private storage bucket.
Deno.serve(async req=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required.'},405);
 try{
  if(project!=='https://mcmtasetompygfktzhpr.supabase.co')throw new BottleError(503,'Bottle service project mismatch.');
  if(!req.headers.get('authorization')?.startsWith('Bearer '))throw new BottleError(401,'Project authorization required.');
  if(Number(req.headers.get('content-length')||0)>3000000)throw new BottleError(413,'Choose a photograph under 2 MB.');
  const reader=req.body?.getReader();if(!reader)throw new BottleError(400,'A bottle photograph is required.');
  const chunks:Uint8Array[]=[];let total=0;for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>3000000){await reader.cancel();throw new BottleError(413,'Choose a photograph under 2 MB.')}chunks.push(value)}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new BottleError(400,'Invalid request.')}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BottleError(400,'Invalid request.');
  if(body.action!=='assets'&&body.action!=='lookup'){
   const bytes=new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')+':'+(req.headers.get('x-forwarded-for')||'unknown').split(',')[0]);
   const network=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const gate=await db.rpc('sommni_request_allow',{p_key:'bottle-cutout:'+network,p_limit:30,p_seconds:60});
   if(gate.error)throw new BottleError(503,'Bottle processing is temporarily unavailable.');
   if(!gate.data)throw new BottleError(429,'Several bottles are processing from this connection. Retry in a minute.');
  }
  return reply(await service(body));
 }catch(error){if(!(error instanceof BottleError))console.error('Bottle processing failed',error instanceof Error?error.name:'unknown');return reply({error:error instanceof BottleError?error.message:'The bottle could not be processed. Your original photo is unchanged.'},error instanceof BottleError?error.status:503)}
});
