import { LabelQueue } from './label-queue';
import type { LibraryWine } from '../winebrary';
import { artworkOwner } from '../artwork-store';
import { findBottleCandidates, clipBottleCandidate } from './bottle-jobs';
import { bottleIdentity, inlineBottle } from './bottles';
import { researchAction } from './client';
import { finishWineArtwork } from '../wine-contributions';

let session:LabelQueue|null=null;
const listeners=new Set<()=>void>();
const changed=()=>{for(const listener of listeners)listener();};
export const labelSession=()=>session;
export function subscribeLabels(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function clearLabels(){session?.dispose();session=null;changed();}
window.addEventListener('sommni-library-account-changing',clearLabels);
export function startLabels(wines:LibraryWine[]){
 if(session?.busy)throw Error('A selected label is still saving. Finish it before starting a new batch.');
 const scope=artworkOwner();if(!scope)throw Error('Open your Winebrary first.');
 const unique=[...new Map(wines.map(w=>[w.id,w])).values()];
 if(!unique.length)throw Error('Add a wine to your Winebrary first.');
 if(unique.length>20)throw Error('Select up to 20 wines for each label review.');
 session?.dispose();
 const current=()=>artworkOwner()===scope;
 const check=()=>{if(!current())throw Error('Account changed. Open your Winebrary again.');};
 session=new LabelQueue(unique,{
  current,changed,
  search:async wine=>findBottleCandidates(wine,scope,true),
  polish:async option=>{check();const result=await clipBottleCandidate(option);check();return result;},
  save:async(wine,draft)=>{
   check();const photo=await inlineBottle(draft);check();
   const result=await researchAction({action:'attach_bottle',collection_id:wine.id,expected:bottleIdentity(wine),only_if_missing:false,photo,provenance:draft.provenance},AbortSignal.timeout(45000));check();
   await finishWineArtwork(result.item,scope,true);check();
   window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{id:wine.id}}));return result.item;
  },
 });changed();session.start();return session;
}
export function labelProgress(){
 const s=session;if(!s)return '';
 const working=s.rows.find(r=>r.work==='polishing'||r.work==='saving');
 return `${s.settled}/${s.rows.length} searched · ${s.saved} saved${working?' · '+(working.work==='polishing'?'Polishing':'Saving'):s.settled<s.rows.length?' · Searching…':' · Ready to review'}`;
}
