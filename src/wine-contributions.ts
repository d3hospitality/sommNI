import {bottleAccessHeaders} from './bottle-allowance';
import type { LibraryWine } from './winebrary';
import { artworkStore, artworkHash, artworkOwner, localWineArtwork, bottlePhoto } from './artwork-store';
import { stageCanvas, toGreenLevels } from './bottle-raster';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from './account-config';
export const shareWineControl=(_id:string,_checked=true)=>`<p class="wl-muted small">Every bottle helps build the collective wine globe. Its identity, vintage, region and bottle artwork are sent to sommNI’s master database in Supabase, including wines in your personal Winebrary. Reviewed wines join shared releases. Personal notes and ratings stay private.</p>`;
export type WineSubmission={id:string;scope:string;kind:'submission';receipt:string;name:string;state:'pending'|'sent';payload:any;error?:string;attempts:number;nextTry:number;remote_id?:string};
const vintage=(w:LibraryWine)=>w.vintage?String(w.vintage):w.metadata?.vintage_state==='non_vintage'?'NV':'unknown';
export async function contributionPayload(wine:LibraryWine){
 const reference=wine.metadata?.research_sources?.sources?.find(s=>{try{const u=new URL(s.url);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}})?.url||'';
 // Explicit allowlist: personal notes, rating, account identity, unselected source photos and signed URLs never pass through.
 const payload:any={action:'contribute',consent:true,wine_name:wine.wine_name,producer:wine.producer||'',vintage:vintage(wine),country:wine.metadata?.country||'',region:wine.region||'',grape:wine.metadata?.grape||'',reference_url:reference,details:'',color:wine.metadata?.color||'',sake_classification:wine.metadata?.sake_classification||'',sake_style:wine.metadata?.sake_style||'',rice_variety:wine.metadata?.rice_variety||'',tasting_notes:wine.metadata?.tasting_notes||''};
 if(wine.image_url){
  const bitmap=await createImageBitmap(await bottlePhoto(wine.image_url)),c=document.createElement('canvas');
  try{let scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));for(let attempt=0;attempt<5;attempt++){c.width=Math.round(bitmap.width*scale);c.height=Math.round(bitmap.height*scale);c.getContext('2d')!.drawImage(bitmap,0,0,c.width,c.height);if(c.toDataURL('image/png').length<=2796200)break;scale*=.8;}}finally{bitmap.close()}
  const photo=c.toDataURL('image/png');if(photo.length>2796200)throw Error('Bottle saved locally, but its review image is too large.');
  const sprite=await stageCanvas(photo,100,240),ctx=sprite.getContext('2d')!,pixels=ctx.getImageData(0,0,100,240),gray=toGreenLevels(pixels.data,100);
  for(let i=0;i<gray.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=gray[i];pixels.data[i*4+3]=255;}ctx.putImageData(pixels,0,0);
  const provenance:Record<string,string>={renderer:'sommni-floor-v2-gray16-100x240'};for(const key of ['pipeline','segmentation','source_sha256','scale_basis','vintage_binding','catalog_id','asset_id','source_page','source_image','verified_at','identity_check','source_dimensions'])if(typeof (wine.metadata as any)?.bottle_provenance?.[key]==='string')provenance[key]=(wine.metadata as any).bottle_provenance[key];
  payload.artwork={photo,sprite:sprite.toDataURL('image/png'),source:wine.metadata?.image_source==='generated'?'generated':'photograph',provenance};
 }
 return payload;
}
let flushing:Promise<void>|undefined;
export function flushWineContributions(){
 if(flushing)return flushing;
 flushing=(async()=>{
  if(!navigator.onLine)return;
  const rows=(await artworkStore<WineSubmission[]>('getAll')).filter(r=>r.kind==='submission'&&r.state==='pending'&&r.nextTry<=Date.now());
  for(const row of rows){
   try{
    const response=await fetch(`${ACCOUNT_URL}/functions/v1/winelens-beta`,{method:'POST',headers:await bottleAccessHeaders(row.scope),body:JSON.stringify({...row.payload,receipt:row.receipt}),signal:AbortSignal.timeout(30000)});
    const result=await response.json().catch(()=>({}));if(!response.ok||!result.received)throw Error(result.error||'The master Winebrary has not confirmed this upload.');
    await artworkStore('put',{...row,state:'sent',remote_id:result.id,payload:undefined,error:undefined});
   }catch(error){await artworkStore('put',{...row,attempts:row.attempts+1,nextTry:Date.now()+Math.min(3600000,30000*2**Math.min(row.attempts,7)),error:(error as Error).message});}
  }
  window.dispatchEvent(new Event('sommni-contribution-status'));
 })().finally(()=>{flushing=undefined});return flushing;
}
/** Durably queue public facts before photo work. Called by every library write, including voice and manual saves. */
export async function queueWineSubmission(wine:LibraryWine,scope:string,withArtwork=false):Promise<string>{
 const payload=await contributionPayload(withArtwork?wine:{...wine,image_url:undefined}).catch(()=>contributionPayload({...wine,image_url:undefined}));
 const fingerprint=await artworkHash(JSON.stringify(payload)),id=`${scope}:submission:${fingerprint}`;
 const previous=await artworkStore<WineSubmission|undefined>('get',id);
 if(!previous){const receipt=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');await artworkStore('put',{id,scope,kind:'submission',receipt,name:wine.wine_name,state:'pending',payload,attempts:0,nextTry:0});}
 void flushWineContributions().catch(()=>{});
 return previous?.state==='sent'?'Saved in the shared master Winebrary.':'Saved on this device. Master Winebrary upload queued; it retries when connected.';
}
export async function finishWineArtwork(wine:LibraryWine,scope:string,_share=true,autoSearch=true):Promise<string>{
 const message=await queueWineSubmission(wine,scope);
 if(artworkOwner()!==scope)return message;
 if(!wine.image_url&&!autoSearch)return message+' Choose a bottle photo in Winebrary whenever you’re ready.';
 if(!wine.image_url){try{await (await import('./research/bottle-jobs')).queueBottleArtwork(wine,scope);}catch{return message+' Bottle search could not be queued; retry from Winebrary.';}}
 try{const local=await localWineArtwork(wine,scope);if(local.image_url){await queueWineSubmission(local,scope,true);return message+' Bottle artwork saved.';}}catch{}
 return message+(wine.image_url?'':' Bottle search is running.');
}
export function initWineContributions(){window.addEventListener('online',()=>void flushWineContributions().catch(()=>{}));setInterval(()=>void flushWineContributions().catch(()=>{}),60000);void flushWineContributions().catch(()=>{});}
export async function retryWineContributions(){for(const row of await artworkStore<WineSubmission[]>('getAll'))if(row.kind==='submission'&&row.scope===artworkOwner()&&row.state==='pending')await artworkStore('put',{...row,nextTry:0});await flushWineContributions();}
