import type {LibraryWine} from './winebrary';
/** A broken URL needs attention too; changing the URL automatically clears that failure. */
export function createLibraryPhotoState(resolve:(wine:LibraryWine)=>string|null){
 const failed=new Map<string,string>();
 return {
  photo(wine:LibraryWine){const url=resolve(wine);return url&&failed.get(wine.id)!==url?url:null;},
  fail(wine:LibraryWine,url:string){if(resolve(wine)!==url||failed.get(wine.id)===url)return false;failed.set(wine.id,url);return true;},
  reset(){failed.clear();},
 };
}
export function missingPhotoTools(count:number,filtered:boolean){
 if(!count&&!filtered)return '';
 return `<section class="wl-photo-tools" aria-label="Missing bottle photos"><div><strong>${count?`${count} bottle${count===1?'':'s'} need${count===1?'s':''} a photo`:'Photos complete'}</strong><small>${count?'Find real labels, choose a match, save to phone & glasses.':'No missing photos in this view.'}</small></div><div class="wl-photo-tool-actions"><button id="wl-missing-photos" type="button" aria-pressed="${filtered}">${filtered?'Show All Wines':'Missing Photos'}${!filtered&&count?' · '+count:''}</button>${count?`<button id="wl-find-photos" type="button">Find Photos${count>1?' · '+Math.min(count,10):''} ↗</button>`:''}</div>${count>10?'<small class="wl-photo-batch-note">Search the next 10 missing bottles. Choose each label before it is saved.</small>':''}</section>`;
}
export function missingPhotoAction(id:string,name:string,escape:(s:unknown)=>string){return `<button type="button" class="wl-find-photo" data-edit-photo="${escape(id)}" aria-label="Find bottle photo for ${escape(name)}"><span aria-hidden="true">＋</span> Find Photo <span aria-hidden="true">↗</span></button>`;}
