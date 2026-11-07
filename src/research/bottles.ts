import {artworkStore,artworkOwner,artworkHash,bottlePhoto,blobData} from '../artwork-store';
import {boundedPng} from './photo-input';
export {photoData} from './photo-input';
import { SOMMNI_PROJECT_URL, SOMMNI_PUBLISHABLE_KEY } from '../account-project';
import { allCatalogWines, type CatalogWine } from '../identity';
import { bottleImageUrl } from '../bottle-assets';
export interface BottleDraft {url:string;path:string;source:'photograph'|'generated';provenance?:Record<string,unknown>}
export const bottleIdentity=(wine:any)=>({wine_name:String(wine.wine_name||''),producer:String(wine.producer||''),vintage:wine.vintage??null});
const normalized=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Whole identity only. A producer or appellation alone is not a cuvée match. */
export function catalogBottleCandidates(wine:{wine_name:string;producer?:string|null}):CatalogWine[]{
 const name=normalized(wine.wine_name),producer=normalized(wine.producer||'');
 const names=new Set([name,normalized(`${producer} ${name}`),normalized(`${name} ${producer}`)]);
 return allCatalogWines().filter(entry=>{
  if((!entry.legacyId&&!entry.imageUrl)||entry.legacyId==='w105')return false; // unresolved source label
  const [cuvee,maker]=entry.wine.name.split(/\s+[–—]\s+/);
  if(maker&&producer&&producer!==normalized(maker))return false;
  return names.has(normalized(entry.wine.name)) || (!!maker && [normalized(`${cuvee} ${maker}`),normalized(`${maker} ${cuvee}`)].some(n=>names.has(n)));
 });
}
export function catalogBottleDraft(entry:CatalogWine):BottleDraft {
 const url=entry.imageUrl||bottleImageUrl(import.meta.env.BASE_URL,entry.legacyId!);
 return {url,path:url,source:'photograph',provenance:{pipeline:'photographic-v2',catalog_id:entry.id,asset_id:entry.legacyId,vintage_binding:'representative catalog photograph; exact vintage unverified'}};
}
const hostedEndpoint=`${SOMMNI_PROJECT_URL}/functions/v1/sommni-bottle-cutout`;
// Public anon JWT for the Edge gateway's legacy verify_jwt compatibility, never a server key.
const edgeAnonJwt='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jbXRhc2V0b21weWdma3R6aHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMzg1MjEsImV4cCI6MjEwMDkxNDUyMX0.Kli3HSk3PDGG2qCXbwcfIwhurIHMcPa7A5sfvPO085U';
export function bottleCutoutEndpoint(){return import.meta.env.VITE_WL_BOTTLE_CUTOUT_URL || hostedEndpoint;}
export function bottleCutoutHosted(){return bottleCutoutEndpoint()===hostedEndpoint;}
export async function createBottleCutout(photo:string,frame=false):Promise<BottleDraft>{
 const endpoint=bottleCutoutEndpoint(),headers:Record<string,string>={'Content-Type':'application/json'};
 if(bottleCutoutHosted()){headers.Authorization=`Bearer ${edgeAnonJwt}`;headers.apikey=SOMMNI_PUBLISHABLE_KEY;photo=await boundedPng(photo,frame);}
 const scope=artworkOwner(),cacheKey=scope+':cutout:v2:'+await artworkHash(photo);const local=scope?await artworkStore('get',cacheKey).catch(()=>null):null;if(local?.draft?.url)return local.draft;
 const request=async(body:unknown)=>{
  let response:Response;try{response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});}catch{throw Error('Bottle processing connection interrupted. Retry when connected; your chosen photo is kept. This does not confirm an API credit problem.');}
  const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'The bottle cutter is unavailable. Your original photo is unchanged.');return result;
 };
 const remember=async(draft:BottleDraft)=>{if(scope&&scope===artworkOwner())await artworkStore('put',{id:cacheKey,kind:'cutout',scope,draft}).catch(()=>{});return draft;};
 let result;
 if(bottleCutoutHosted()){
  const cached=await request({action:'lookup',photo});if(cached.draft?.url)return remember(cached.draft);
  const [{assets},{bottleMask}]=await Promise.all([request({action:'assets'}),import('./bottle-segmentation')]);
  const mask=await bottleMask(photo,assets);result=await request({photo,mask});
 }else result=await request({photo});
 if(!result.draft?.url)throw new Error('The bottle cutter returned no image. Your original photo is unchanged.');return remember(result.draft);
}
export async function inlineBottle(draft:BottleDraft):Promise<string>{
 if(draft.url.startsWith('data:image/png;base64,'))return draft.url.length<=2796200?draft.url:boundedPng(draft.url);
 const data=await blobData(await bottlePhoto(draft.url));
 return data.startsWith('data:image/png;base64,')&&data.length<=2796200?data:boundedPng(data);
}
