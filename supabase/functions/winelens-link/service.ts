export class LinkError extends Error {constructor(public status:number,message:string){super(message)}}
const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const normalizeCode=(v:unknown)=>String(v||'').toUpperCase().replace(/[\s-]/g,'');
export const validCode=(v:string)=>v.length===8&&[...v].every(c=>alphabet.includes(c));
export function newCode(){let s='';while(s.length<8){for(const n of crypto.getRandomValues(new Uint8Array(16))){if(n<Math.floor(256/alphabet.length)*alphabet.length&&s.length<8)s+=alphabet[n%alphabet.length];}}return s;}
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const digest=async(v:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function createLinkService(db:any,salt:string){
 const hash=(v:string)=>digest(salt+':'+v);
 const ok=(r:any)=>{if(r.error)throw new LinkError(503,'Account linking is temporarily unavailable.');return r.data};
 const limited=async(key:string,n:number,seconds:number)=>{if(!ok(await db.rpc('sommni_request_allow',{p_key:key,p_limit:n,p_seconds:seconds})))throw new LinkError(429,'Too many attempts. Wait a minute before trying again.');};
 return async(body:any,context:{user?:{id:string;email?:string};sessionId?:string;network:string})=>{
  const {user,sessionId,network}=context;
  const authenticated=()=>{if(!user)throw new LinkError(401,'Sign in with Google on d3hospitality.com/sommNI first.');return user;};
  const current=async()=>{const u=authenticated();if(!sessionId)throw new LinkError(401,'Sign in again.');const row=ok(await db.from('wl_linked_devices').select('id,revoked_at').eq('user_id',u.id).eq('session_id',sessionId).maybeSingle());if(row?.revoked_at)throw new LinkError(401,'This device was unlinked.');return row;};
  if(body.action==='start'){
   await limited('pair-start:'+network,12,3600);const code=newCode(),proof=secret();
   const row=ok(await db.from('sommni_pair_requests').insert({code_hash:await hash('code:'+code),proof_hash:await hash('proof:'+proof)}).select('id,expires_at').single());
   return {...row,code:code.slice(0,4)+'-'+code.slice(4),proof};
  }
  if(body.action==='approve'){
   const u=authenticated();await limited('pair-claim:'+u.id,12,600);await current();
   const code=normalizeCode(body.code);if(!validCode(code))throw new LinkError(400,'Enter the eight-character code shown in sommNI.');
   const count=ok(await db.from('wl_linked_devices').select('id').eq('user_id',u.id).is('revoked_at',null));if(count.length>=10)throw new LinkError(409,'Unlink an old device before adding another.');
   const row=ok(await db.from('sommni_pair_requests').update({user_id:u.id,claimed_at:new Date().toISOString()}).eq('code_hash',await hash('code:'+code)).is('user_id',null).gt('expires_at',new Date().toISOString()).select('id').maybeSingle());
   if(!row)throw new LinkError(404,'This code expired or was already used. Get a new code in sommNI.');
   return {status:'approved'};
  }
  if(['poll','register'].includes(body.action)){
   if(typeof body.proof!=='string'||! /^[a-f0-9]{64}$/.test(body.proof))throw new LinkError(400,'Invalid device request.');
   const proof=await hash('proof:'+body.proof);await limited('pair-poll:'+proof,90,60);
   const row=ok(await db.from('sommni_pair_requests').select('*').eq('id',body.id).eq('proof_hash',proof).maybeSingle());
   if(!row||Date.parse(row.expires_at)<=Date.now())throw new LinkError(410,'Pairing code expired. Get a new code.');
   if(body.action==='register'){
    const u=authenticated();if(u.id!==row.user_id||!sessionId)throw new LinkError(403,'This request belongs to another account.');
    if(row.completed_at){const linked=ok(await db.from('wl_linked_devices').select('session_id,revoked_at').eq('id',row.id).single());if(linked.session_id!==sessionId||linked.revoked_at)throw new LinkError(403,'This code has already linked another session.');return {status:'linked'};}
    if(!row.exchange_hash)throw new LinkError(409,'Finish approving this device first.');
    // Keep the existing device/code foreign key; this retired code is already consumed.
    ok(await db.from('wl_link_codes').upsert({id:row.id,user_id:u.id,code_hash:await hash('registered:'+row.id),expires_at:row.expires_at,claimed_at:new Date().toISOString()},{onConflict:'id',ignoreDuplicates:true}));
    const device=ok(await db.from('wl_linked_devices').upsert({id:row.id,user_id:u.id,code_id:row.id,session_id:sessionId,label:'sommNI companion',linked_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:'id',ignoreDuplicates:true}).select('id').maybeSingle());
    const existing=device||ok(await db.from('wl_linked_devices').select('id,session_id,revoked_at').eq('id',row.id).single());
    if(existing.revoked_at||existing.session_id&&existing.session_id!==sessionId)throw new LinkError(403,'This code has already linked another session.');
    ok(await db.from('sommni_pair_requests').update({completed_at:new Date().toISOString(),device_id:row.id,exchange_hash:null}).eq('id',row.id));return {status:'linked'};
   }
   if(row.completed_at)return {status:'linked'};
   if(!row.user_id)return {status:'pending',expires_at:row.expires_at};
   if(row.exchange_hash)return {status:'approved',token_hash:row.exchange_hash};
   if(row.exchange_started_at&&Date.parse(row.exchange_started_at)<Date.now()-60000)ok(await db.from('sommni_pair_requests').update({exchange_started_at:null}).eq('id',row.id).eq('exchange_started_at',row.exchange_started_at).is('exchange_hash',null));
   const lease=new Date().toISOString();
   const claimed=ok(await db.from('sommni_pair_requests').update({exchange_started_at:lease}).eq('id',row.id).is('exchange_started_at',null).select('id').maybeSingle());
   if(!claimed)return {status:'pending'};
   try{
    const result=await db.auth.admin.getUserById(row.user_id);const target=result.data?.user;if(result.error||!target?.email||!target.email_confirmed_at)throw new LinkError(403,'Verify your account email before linking.');
    const generated=await db.auth.admin.generateLink({type:'magiclink',email:target.email});const token=generated.data?.properties?.hashed_token;if(generated.error||!token)throw new LinkError(503,'Could not complete linking. Please retry.');
    const saved=ok(await db.from('sommni_pair_requests').update({exchange_hash:token}).eq('id',row.id).eq('exchange_started_at',lease).select('id').maybeSingle());return saved?{status:'approved',token_hash:token}:{status:'pending'};
   }catch(e){await db.from('sommni_pair_requests').update({exchange_started_at:null}).eq('id',row.id).eq('exchange_started_at',lease);throw e;}
  }
  if(body.action==='status'){await current();return {status:'linked',user_id:user!.id};}
  if(body.action==='list'){await current();return {devices:ok(await db.from('wl_linked_devices').select('id,label,linked_at,last_seen_at').eq('user_id',user!.id).is('revoked_at',null).order('created_at',{ascending:false}))};}
  if(body.action==='unlink'){const device=await current();if(device)ok(await db.rpc('sommni_revoke_device',{p_user:user!.id,p_id:device.id}));return {status:'unlinked'};}
  if(body.action==='revoke'){await current();if(!ok(await db.rpc('sommni_revoke_device',{p_user:user!.id,p_id:body.id})))throw new LinkError(404,'Device not found.');return {status:'unlinked'};}
  throw new LinkError(400,'Unknown account action.');
 };
}
