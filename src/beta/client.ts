import {readResearchStream,type ResearchProgress} from '../research/research-stream';
import {bottleAccessHeaders,announceBottleAllowance,checkBottleAllowance} from '../bottle-allowance';
import {artworkOwner} from '../artwork-store';
import {isGuestLibrary,cloudCollection} from '../cloud-library';
import { bottleIdentity } from '../research/bottles';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from '../account-config';
import { localStore, localWines, updateLocalWine } from './store';
export async function betaProvider(body:Record<string,unknown>,signal?:AbortSignal,onProgress?:(value:ResearchProgress)=>void) {
 let response:Response;try{response=await fetch(`${ACCOUNT_URL}/functions/v1/winelens-beta`,{method:'POST',headers:{...await bottleAccessHeaders(),...(onProgress?{Accept:"application/x-ndjson"}:{})},body:JSON.stringify(body),signal});}catch(error){if(signal?.aborted)throw error;throw Error('Could not reach the wine service. Your saved wines and downloaded labels are still available. Retry when connected; this error does not confirm an API credit problem.');}
 const result=onProgress&&response.headers.get('content-type')?.includes('application/x-ndjson')?await readResearchStream(response,onProgress):await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(result.error||'The beta service is unavailable. Your saved wines are still on this device.'),{code:result.code});announceBottleAllowance(result.allowance);return result;
}
export async function betaResearch(body:any,signal?:AbortSignal,onProgress?:(value:ResearchProgress)=>void):Promise<any>{
 signal?.throwIfAborted();const owner=artworkOwner();const current=()=>{signal?.throwIfAborted();if(artworkOwner()!==owner)throw Error('Account changed. Please retry in the current library.');};
 if(body.action==='attach_bottle'){
  const item=await updateLocalWine(body.collection_id,wine=>{
   if(!wine)throw new Error('Save this wine first.');
   if(JSON.stringify(bottleIdentity(wine))!==JSON.stringify(body.expected))throw new Error('This wine changed. Review its bottle again.');
   if(body.only_if_missing&&wine.image_url)return wine;
   if(typeof body.photo!=='string'||!body.photo.startsWith('data:image/png;base64,')||body.photo.length>3000000)throw new Error('Choose a transparent PNG under 2 MB.');
   return {...wine,image_url:body.photo,metadata:{...wine.metadata,image_source:'photograph',bottle_provenance:body.provenance},updated_at:new Date().toISOString()};
  });return {item};
 }
 if(body.action==='drafts')return {drafts:(await localStore<any[]>('drafts','getAll')).filter(d=>!d.confirmed_at).sort((a,b)=>b.created_at.localeCompare(a.created_at))};
 if(body.action==='confirm'){
  if(!body.confirmed)throw new Error('Review and confirm this wine first.');
  const draft=await localStore('drafts','get',body.draft_id);
  current();if(!draft){const existing=isGuestLibrary()?await localStore('wines','get',body.draft_id):null;if(existing)return {item:existing};throw new Error('Draft not found on this device.');}
  const r=body.review;
  if(['wine_name','producer','vintage','vintage_state'].some(key=>String(r[key]??'').trim().toLowerCase()!==String(draft.result[key]??'').trim().toLowerCase()))throw new Error('Research the corrected wine before saving.');
  await checkBottleAllowance(r,signal);current();
  const norm=(value:unknown)=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  if(!isGuestLibrary()){
   const result=await cloudCollection('/api/collection','POST',{...r,metadata:{vintage_state:r.vintage_state,country:r.country,grape:r.grape,color:r.color,sake_classification:r.sake_classification,sake_style:r.sake_style,rice_variety:r.rice_variety,tasting_notes:r.tasting_notes,research_sources:draft.evidence,research_report:draft.report,research_query:draft.query}});
   current();await localStore('drafts','put',{...draft,confirmed_at:new Date().toISOString()});return result;
  }
  const duplicate=(await localWines()).find(w=>norm(w.wine_name)===norm(r.wine_name)&&norm(w.producer)===norm(r.producer)&&norm(w.vintage)===norm(r.vintage)&&norm(w.metadata?.vintage_state||'unknown')===norm(r.vintage_state));
  if(duplicate){current();await localStore('drafts','put',{...draft,confirmed_at:new Date().toISOString()});return {item:duplicate,duplicate:true};}
  const item={id:draft.id,wine_name:r.wine_name,producer:r.producer,vintage:r.vintage,region:r.region,notes:'',image_url:undefined,metadata:{vintage_state:r.vintage_state,country:r.country,grape:r.grape,color:r.color,sake_classification:r.sake_classification,sake_style:r.sake_style,rice_variety:r.rice_variety,tasting_notes:r.tasting_notes,research_sources:draft.evidence,research_report:draft.report,research_query:draft.query,research_at:draft.created_at,image_source:undefined},updated_at:new Date().toISOString()};
  await localStore('wines','put',item);current();await localStore('drafts','put',{...draft,confirmed_at:new Date().toISOString()});return {item};
 }
 if(body.action==='research'){
  if(!body.photo&&!body.refresh){const query=String(body.query||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();const prior=(await localStore<any[]>('drafts','getAll')).find(d=>!d.photo&&String(d.query||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()===query&&Date.now()-Date.parse(d.created_at)<7*86400000);if(prior){const allowance=await checkBottleAllowance(prior.result,signal);current();return {draft:prior,cached:true,allowance}};}
  const result=await betaProvider(body,signal,onProgress?(value=>{current();onProgress(value)}):undefined);signal?.throwIfAborted();const draft={...result.draft,photo:body.photo,image_path:body.photo?'device-photo':null,created_at:new Date().toISOString()};current();await localStore('drafts','put',draft);return {draft,cached:result.cached};
 }
 if(body.action==='ask'){const wines=body.use_library?(isGuestLibrary()?await localWines():(await cloudCollection('/api/collection')).items).slice(0,50).map(({wine_name,producer,vintage,region}:any)=>({wine_name,producer,vintage,region})):[];return betaProvider({...body,library:wines});}
 if(body.action==='audio'||body.action==='audio_status'){
  const wine=await localStore('wines','get',body.collection_id);if(!wine)throw new Error('Save the wine on this device first.');
  const input={wine_name:wine.wine_name,producer:wine.producer,vintage:wine.vintage,region:wine.region,notes:wine.notes,metadata:{tasting_notes:wine.metadata?.tasting_notes,vintage_state:wine.metadata?.vintage_state}};
  const fingerprint=JSON.stringify(input),cached=await localStore('audio','get',wine.id);
  if(cached?.fingerprint===fingerprint)return cached.result;
  if(body.action==='audio_status')return {configured:(await betaProvider({action:'status'})).audio};
  const result=await betaProvider({action:'audio',wine:input});await localStore('audio','put',{id:wine.id,fingerprint,result});return result;
 }
 return betaProvider(body);
}
