import {researchAction} from './client';
import {artworkOwner} from '../artwork-store';
import {finishWineArtwork,queueWineSubmission} from '../wine-contributions';
import {createBottleCutout,inlineBottle,bottleIdentity,type BottleDraft} from './bottles';
import type {WineDraft} from './add-session';

/** Called only by the explicit approval button. Uses the same dedupe, local/cloud
 * storage and durable master-catalog outbox as other Winebrary additions. */
export async function saveScannedWine(draft:WineDraft,photo:string,changed:(message:string)=>void){
 const scope=artworkOwner();if(!scope)throw Error('Open your Winebrary, then approve the scan again.');
 const current=()=>{if(artworkOwner()!==scope)throw Error('Account changed. Open the Winebrary where you approved this bottle.');};
 const w=draft.result;
 const review=Object.fromEntries(['wine_name','producer','vintage','vintage_state','region','country','grape','color','sake_classification','sake_style','rice_variety','tasting_notes'].map(k=>[k,(w as any)[k]??(k==='vintage'?null:'')]));
 changed('Saving your approved wine…');current();
 const result=await researchAction({action:'confirm',draft_id:draft.id,confirmed:true,review});
 let message=result.duplicate?'Already in your Winebrary. Existing notes and photo are kept.':'Saved to your Winebrary.';
 // A photo failure must never turn a successful wine save into a misleading failure.
 try{
  current();message+=' '+await queueWineSubmission(result.item,scope);
  if(!result.item.image_url){
   changed('Wine saved · Preparing your bottle image…');
   let bottle:BottleDraft={url:photo,path:'',source:'photograph',provenance:{pipeline:'camera-scan-original'}};
   try{bottle=await createBottleCutout(photo);}catch{message+=' Original photo retained; background removal can be retried in Winebrary.';}
   current();const png=await inlineBottle(bottle);current();
   const attached=await researchAction({action:'attach_bottle',collection_id:result.item.id,expected:bottleIdentity(result.item),only_if_missing:true,photo:png,provenance:bottle.provenance});result.item=attached.item;
  }
  current();message+=' '+await finishWineArtwork(result.item,scope,true,false);
 }catch(error){message+=' '+(error as Error).message+' Open Winebrary to check image and upload status.';}
 window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{id:result.item.id}}));
 return {message,item:result.item,duplicate:!!result.duplicate};
}
