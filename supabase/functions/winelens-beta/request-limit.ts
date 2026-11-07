import { Fault } from '../winelens-research/domain.ts';
/** Each operation has its own short window; unrelated users never spend a shared daily budget. */
export function createRequestReserve(db:any,request:Request,salt:string,action:string){
 const bucket=action==='bottle_candidates'?'bottle_lookup':action;
 const limit=action==='transcribe'?60:action==='studio'?6:20;
 return async(_weight:number)=>{
  const address=(request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+':'+address));
  const network=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
  const {data,error}=await db.rpc('sommni_request_allow',{p_key:'beta:'+bucket+':'+network,p_limit:limit,p_seconds:60});
  if(error)throw new Fault(503,'The request service is temporarily unavailable. Please retry.');
  if(data!==true)throw new Fault(429,'Several '+(action==='transcribe'?'voice':'wine')+' requests are running from this connection. Wait one minute and retry.');
  return true;
 };
}
