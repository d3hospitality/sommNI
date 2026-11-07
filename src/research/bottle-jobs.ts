import type { LibraryWine } from '../winebrary';
import { artworkOwner, artworkStore } from '../artwork-store';
import { catalogBottleCandidates, catalogBottleDraft, createBottleCutout, inlineBottle, bottleIdentity, type BottleDraft } from './bottles';
import { betaProvider } from '../beta/client';
import { researchAction } from './client';
import { finishWineArtwork } from '../wine-contributions';
export type BottleCandidate={id:string;photo:string;provenance:Record<string,unknown>};
const searches=new Map<string,Promise<BottleCandidate[]>>();
export function findBottleCandidates(wine:any,scope:string,refresh=false):Promise<BottleCandidate[]>{
 const identityKey=scope+':'+JSON.stringify(bottleIdentity(wine));
 if(artworkOwner()!==scope)return Promise.reject(Error('Account changed. Start again.'));
 if(refresh)searches.delete(identityKey);
 let pending=searches.get(identityKey);if(!pending){pending=betaProvider({action:'bottle_candidates',...bottleIdentity(wine)},AbortSignal.timeout(170000)).then(result=>{if(artworkOwner()!==scope)throw Error('Account changed.');const candidates=(result.candidates?.length?result.candidates:result.photo?[result]:[]).filter((c:BottleCandidate)=>typeof c.photo==='string'&&c.photo.startsWith('data:image/')).slice(0,3);if(!candidates.length)throw Error('No bottle photos found. Try again or upload your own.');return candidates;});searches.set(identityKey,pending);void pending.catch(()=>{if(searches.get(identityKey)===pending)searches.delete(identityKey);});if(searches.size>8)searches.delete(searches.keys().next().value!);}
 return pending;
}
export async function clipBottleCandidate(candidate:BottleCandidate){const draft=await createBottleCutout(candidate.photo,true);return {...draft,provenance:{...draft.provenance,...candidate.provenance,pipeline:'web-photo-to-transparent-v2'}};}
type Job={id:string;kind:'bottle-job';scope:string;wineId:string;state:'pending'|'working'|'ready'|'attention';attempts:number;nextTry:number;message:string};
let load: (()=>Promise<LibraryWine[]>)|undefined, running:Promise<void>|undefined, started=false;
const key=(scope:string,id:string)=>`${scope}:bottle-job:${id}`;
// Preview and saved-library jobs share the same lookup/cutout; saving never starts it twice.
const preparations=new Map<string,{expires:number;promise:Promise<BottleDraft>}>();
export function prepareBottleArtwork(wine:Parameters<typeof bottleIdentity>[0],scope:string):Promise<BottleDraft>{
 const current=()=>{if(artworkOwner()!==scope)throw Error('Account changed. Start this bottle search again.');};
 if(artworkOwner()!==scope)return Promise.reject(Error('Account changed. Start this bottle search again.'));
 const identityKey=scope+':'+JSON.stringify(bottleIdentity(wine));
 const existing=preparations.get(identityKey);if(existing&&existing.expires>Date.now())return existing.promise;
 const promise=(async()=>{
  current();const candidates=catalogBottleCandidates(wine);
  if(candidates.length===1)return catalogBottleDraft(candidates[0]);
  const photos=await findBottleCandidates(wine,scope);current();
  const draft=await clipBottleCandidate(photos[0]);current();return draft;
 })();
 preparations.set(identityKey,{expires:Date.now()+300000,promise});
 void promise.catch(()=>{if(preparations.get(identityKey)?.promise===promise)preparations.delete(identityKey);});
 if(preparations.size>8)preparations.delete(preparations.keys().next().value!);
 return promise;
}
export async function bottleJobStatuses(){const scope=artworkOwner();return new Map((await artworkStore<Job[]>('getAll')).filter(j=>j.kind==='bottle-job'&&j.scope===scope).map(j=>[j.wineId,j]));}
export async function queueBottleArtwork(wine:LibraryWine,scope:string,retry=false){
 if(artworkOwner()!==scope||wine.image_url)return;
 const id=key(scope,wine.id),prior=await artworkStore<Job|undefined>('get',id);
 if(!prior||retry)await artworkStore('put',{id,kind:'bottle-job',scope,wineId:wine.id,state:'pending',attempts:0,nextTry:0,message:'Bottle photo queued — matching the label, then making its transparent sprite.'});
 void runBottleJobs();
}
export function runBottleJobs(){
 if(running||!load||!navigator.onLine)return running;
 running=(async()=>{
  const scope=artworkOwner();if(!scope)return;
  for(const job of (await bottleJobStatuses()).values()){
   if(artworkOwner()!==scope)return;
   if(job.state==='ready'||job.state==='attention'||job.nextTry>Date.now())continue;
   const wine=(await load!()).find(w=>w.id===job.wineId);
   if(!wine){await artworkStore('delete',job.id);continue;}
   if(wine.image_url){await artworkStore('put',{...job,state:'ready',message:'Bottle saved.'});continue;}
   const current=()=>{if(scope!==artworkOwner())throw Error('Account changed.');};
   try{
    await artworkStore('put',{...job,state:'working',message:'Finding and checking a real bottle photograph…'});
    window.dispatchEvent(new Event('sommni-bottle-status'));
    const draft=await prepareBottleArtwork(wine,scope);
    current();const photo=await inlineBottle(draft);current();
    const attached=await researchAction({action:'attach_bottle',collection_id:wine.id,expected:bottleIdentity(wine),only_if_missing:true,photo,provenance:draft.provenance},AbortSignal.timeout(45000));current();
    await finishWineArtwork(attached.item,scope,true);current();
    await artworkStore('put',{...job,state:'ready',message:'Bottle photo and G2 sprite saved. Check master uploads for the receipt.'});
    window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{id:wine.id}}));
   }catch(error){
    if(scope!==artworkOwner())return;
    const attempts=job.attempts+1;await artworkStore('put',{...job,state:attempts>=3?'attention':'pending',attempts,nextTry:Date.now()+Math.min(3600000,60000*5**attempts),message:(error as Error).message||'Bottle search paused. Retry or add a photograph.'});
   }
   window.dispatchEvent(new Event('sommni-bottle-status'));
  }
 })().catch(()=>{}).finally(()=>{running=undefined});return running;
}
export function initBottleJobs(loader:()=>Promise<LibraryWine[]>){load=loader;if(started)return;started=true;window.addEventListener('online',()=>void runBottleJobs());setInterval(()=>void runBottleJobs(),60000);void runBottleJobs();}
