import { publicContent } from '../_shared/public-content.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createLinkService,LinkError,digest} from './service.ts';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),service=createLinkService(db,key);
Deno.serve(async req=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  if(req.method!=='POST')throw new LinkError(405,'POST required.');
  if(url!=='https://mcmtasetompygfktzhpr.supabase.co')throw new LinkError(503,'Account project mismatch.');
  const reader=req.body?.getReader();if(!reader)throw new LinkError(400,'Request required.');let raw='';for(;;){const {done,value}=await reader.read();if(done)break;raw+=new TextDecoder().decode(value);if(raw.length>4096){await reader.cancel();throw new LinkError(413,'Request too large.');}}
  let body;try{body=JSON.parse(raw)}catch{throw new LinkError(400,'Invalid request.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new LinkError(400,'Invalid request.');
  let user,sessionId;const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
  if(token){const r=await db.auth.getUser(token);if(r.error||!r.data.user)throw new LinkError(401,'Sign in again to continue.');user=r.data.user;try{sessionId=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id}catch{throw new LinkError(401,'Invalid session.');}}
  const network=await digest(key+':'+(req.headers.get('x-forwarded-for')||'unknown').split(',')[0]);
  return Response.json(publicContent(await service(body,{user,sessionId,network})),{headers});
 }catch(e){return Response.json({error:e instanceof LinkError?e.message:'Account linking is temporarily unavailable.'},{status:e instanceof LinkError?e.status:503,headers});}
});
