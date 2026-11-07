import {Fault,hash,text,photo} from '../winelens-research/domain.ts';
const MESSAGE='Daily limit reached: free accounts can search or add 10 bottles per day. Resets at midnight New York time.';
export function bottleAllowanceKey(w:any){
 const norm=(v:unknown)=>String(v??'').toLowerCase().replace(/\s+/g,' ').trim();
 const vintage=String(w.vintage??w.vintage_state??w.metadata?.vintage_state??'unknown').toLowerCase();
 return 'wine:'+norm(w.wine_name)+'|'+norm(String(w.producer??'').trim()||'Unknown producer')+'|'+(['nv','non_vintage','non-vintage'].includes(vintage)?'nv':vintage||'unknown');
}
export async function quotaSubject(db:any,req:Request,salt:string){
 const auth=req.headers.get('authorization');
 if(auth){
  if(!/^Bearer \S+$/.test(auth))throw new Fault(401,'Sign in again to continue.');
  const token=auth.slice(7),{data,error}=await db.auth.getUser(token);if(error||!data?.user)throw new Fault(401,'Sign in again to continue.');
  let sessionId;try{sessionId=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{throw new Fault(401,'Sign in again.');}
  const linked=await db.from('wl_linked_devices').select('revoked_at').eq('user_id',data.user.id).eq('session_id',sessionId||'').maybeSingle();
  if(linked.error)throw new Fault(503,'Could not verify your linked device.');if(linked.data?.revoked_at)throw new Fault(401,'This device was unlinked.');
  return 'user:'+data.user.id;
 }
 // Guests cannot impersonate an account/owner by supplying an ID or email.
 return 'guest:'+await hash(salt+':'+(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim());
}
export async function withBottleAllowance(db:any,subject:string,body:any,work:()=>Promise<any>){
 let key:string|null=null;
 if(body.action==='research'){
  const query=text(body.query??'',400),image=photo(body.photo);if(!query&&!image)throw new Fault(400,'Enter a wine name or add a label photo.');
  key='search:'+await hash(query.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()+'|'+(image?.data||''));
 }else if(['bottle_lookup','bottle_candidates','bottle_allow'].includes(body.action)){
  const w=body.action==='bottle_allow'?body.wine:body;
  text(w?.wine_name,300,true);text(w?.producer??'',200);key=bottleAllowanceKey(w);
 }else if(body.action!=='bottle_allowance')return work();
 const {data:allowance,error}=await db.rpc('sommni_bottle_allow',{p_subject:subject,p_key:key});
 if(error)throw new Fault(503,'Could not check your daily bottle allowance. Connect and retry.');
 if(!allowance?.allowed)throw new Fault(429,MESSAGE);
 if(['bottle_allow','bottle_allowance'].includes(body.action))return {allowance};
 const result=await work();
 if(body.action==='research'&&result.draft?.result){
  const bound=await db.rpc('sommni_bottle_bind',{p_subject:subject,p_key:key,p_alias:bottleAllowanceKey(result.draft.result)});
  if(bound.error)throw new Fault(503,'Could not link this research to your save allowance. Retry the same wine.');
 }
 return {...result,allowance};
}
