import { Fault } from '../winelens-research/domain.ts';
/** Service-only shared research, serialized by the existing Postgres lease. */
export async function cachedResearch(db:any,key:string,build:()=>Promise<any>){
 const prior=await db.from('wl_beta_content').select('payload').eq('cache_key',key).maybeSingle();
 if(prior.error)throw new Fault(503,'Wine research storage is unavailable.');
 if(prior.data?.payload)return {...prior.data.payload,cached:true};
 const lease=crypto.randomUUID(),claim=await db.rpc('wl_beta_claim_content',{p_key:key,p_kind:'research',p_locale:'en',p_lease:lease});
 if(claim.error)throw new Fault(503,'Wine research storage is unavailable.');
 if(!claim.data)throw new Fault(409,'This wine is already being researched. Try again in a moment to reuse the result.');
 try{const payload=await build();const saved=await db.from('wl_beta_content').update({payload,lease_id:null,lease_until:null}).eq('cache_key',key).eq('lease_id',lease).select('cache_key');if(saved.error||!saved.data?.length)throw new Fault(503,'Research could not be saved. Please retry.');return {...payload,cached:false};}
 catch(error){await db.from('wl_beta_content').delete().eq('cache_key',key).eq('lease_id',lease);throw error;}
}
