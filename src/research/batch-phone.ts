import {savedLocations} from '../saved-locations';
import {menuDuplicate} from './menu-duplicates';
import {cloudCollection,isGuestLibrary} from '../cloud-library';
import {localCollection} from '../beta/store';
import {feedbackSound} from '../sound-feedback';
import { readLibrary } from '../winebrary-glasses';
import { mountMenuImport } from './menu-import';
import './menu-import.css';
import './progress.css';
import { WineBatch, batchQueries, type BatchRow } from './batch';
import { artworkOwner } from '../artwork-store';
import { researchAction, escape } from './client';
import { prepareBottleArtwork } from './bottle-jobs';
import { bottleIdentity, inlineBottle } from './bottles';
import { finishWineArtwork, shareWineControl } from '../wine-contributions';
import { referenceNotes } from '../reference-notes';
import { highlightArrival } from './arrival';

export function mountBatchResearch(host:HTMLElement){
 host.innerHTML=`<div class="batch-input"><label class="batch-location">Restaurant / Location <small>Optional · use a city to distinguish branches</small><input data-saved-location list="saved-menu-locations" maxlength="120" placeholder="Runway 84 · Fort Lauderdale" autocomplete="off"><datalist id="saved-menu-locations">${savedLocations(readLibrary().items).map(l=>`<option value="${escape(l.name)}"></option>`).join('')}</datalist></label><div data-menu-import></div><form class="batch-form"><label>Or enter one wine per line<textarea name="wines" rows="4" maxlength="160400" required placeholder="Orin Swift Machete 2022\nChâteau Montelena Chardonnay 2023\nTignanello 2021"></textarea></label><p class="depth-caption">Review up to 400 lines. Free accounts can search or add 10 bottles daily. We’ll research the details and prepare real bottle photos. Tap a wine to include it; grey rows are skipped. Nothing saves until you choose Save Selected.</p><button type="submit" class="wl-primary">Find these bottles →</button></form></div><section class="batch-review" hidden aria-label="Review multiple wines"><p data-location-summary class="depth-caption"></p><div class="batch-toolbar"><input type="checkbox" data-all checked hidden aria-hidden="true" tabindex="-1"><button type="button" data-select-all class="wl-outline" aria-pressed="true">Skip All</button><div class="batch-search-controls"><button type="button" data-pause class="wl-outline">Pause</button><button type="button" data-stop class="wl-outline">Stop Search</button><button type="button" data-clear class="wl-text-button">Clear batch</button></div></div><div class="batch-progress"><div class="wine-progress"><div><span>Wine Details</span><span data-research-count></span></div><progress data-research-progress max="1" value="0" aria-label="Wine details checked"></progress><p data-photo-count></p></div><div class="wine-progress" data-saving-progress hidden><div><span data-save-label>Saving to Winebrary</span><span data-save-count></span></div><progress data-save-progress max="1" value="0" aria-label="Checked wines processed"></progress></div><p data-status role="status" aria-live="polite"></p></div><div class="batch-rows"></div><div class="batch-footer"><button type="button" data-save class="wl-primary" disabled>Save Selected</button><button type="button" data-library class="wl-text-button">Open Winebrary →</button></div>${shareWineControl('batch-share')}</section><p data-error role="alert"></p>`;
 const form=host.querySelector<HTMLFormElement>('.batch-form')!,review=host.querySelector<HTMLElement>('.batch-review')!,rows=host.querySelector<HTMLElement>('.batch-rows')!,save=host.querySelector<HTMLButtonElement>('[data-save]')!,all=host.querySelector<HTMLInputElement>('[data-all]')!,clear=host.querySelector<HTMLButtonElement>('[data-clear]')!,error=host.querySelector<HTMLElement>('[data-error]')!;
 let batch:WineBatch|undefined;
 const input=host.querySelector<HTMLElement>('.batch-input')!;
 const resetMenu=mountMenuImport(host.querySelector<HTMLElement>('[data-menu-import]')!,startBatch,()=>readLibrary().items,()=>host.querySelector<HTMLInputElement>('[data-saved-location]')!.value.trim());
 function rowContent(row:BatchRow){
  const w=row.draft?.result;
  return `<label class="batch-select"><input hidden aria-hidden="true" tabindex="-1" type="checkbox" data-select="${row.id}" ${row.selected?'checked':''} ${['saving','saved','duplicate'].includes(row.state)?'disabled':''} aria-label="Keep ${escape(w?.wine_name||row.query)}"><span class="batch-photo">${row.bottle?`<img src="${escape(row.bottle.url)}" alt="${escape(w?.wine_name)} bottle photograph">`:'<span>Finding<br>bottle</span>'}</span></label><div class="batch-copy"><h3><button type="button" data-row-toggle="${row.id}" aria-pressed="${row.selected}" ${['saving','saved','duplicate'].includes(row.state)?'disabled':''}>${escape(w?.wine_name||row.query)}</button></h3>${w?`<p>${escape([w.producer,w.vintage_state==='year'?w.vintage:w.vintage_state==='non_vintage'?'Non-vintage':'Year unknown'].filter(Boolean).join(' · '))}</p><p class="depth-caption">${escape([w.region,w.country,w.grape].filter(Boolean).join(' · '))}</p>`:''}<p class="batch-state">${escape(!row.selected&&!['saved','duplicate'].includes(row.state)?'Skipped · tap to include':row.message)}</p>${row.imageMessage?`<p class="depth-caption">${escape(row.imageMessage)}</p>`:''}${row.state==='error'?`<button type="button" data-retry="${row.id}" class="wl-text-button">Retry this wine</button>`:''}${row.artwork==='error'&&row.state==='ready'?`<button type="button" data-photo-retry="${row.id}" class="wl-text-button">Retry bottle photo</button>`:''}${w?`<details><summary>Notes</summary><p class="research-pre">${escape(w.uncertainty||'AI-assisted reference details. Check the identity and vintage before saving.')}</p><p class="research-pre">${escape(referenceNotes(w.tasting_notes)||'No reference notes returned.')}</p></details>`:''}</div>`;
 }
 function paint(row?:BatchRow){
  if(!batch)return;
  if(!rows.children.length){for(const r of batch.rows){const node=document.createElement('article');node.dataset.row=String(r.id);node.className='batch-row';node.innerHTML=rowContent(r);rows.append(node);}}
  if(row){const node=rows.querySelector<HTMLElement>(`[data-row="${row.id}"]`)!;const arrived=node.dataset.state!=='ready'&&row.state==='ready';const open=node.querySelector('details')?.open;const focused=node.contains(document.activeElement)?(document.activeElement as HTMLElement).getAttribute('data-select'):null;node.innerHTML=rowContent(row);node.dataset.state=row.state;node.dataset.selected=String(row.selected);if(open&&node.querySelector('details'))node.querySelector('details')!.open=true;if(focused!==null)node.querySelector<HTMLInputElement>('[data-select]')?.focus({preventScroll:true});if(arrived&&row.selected)highlightArrival(node);if(!row.selected)node.classList.remove('sommni-arrived');}
  const pause=host.querySelector<HTMLButtonElement>('[data-pause]')!,stop=host.querySelector<HTMLButtonElement>('[data-stop]')!;pause.textContent=batch.paused?'Resume Search':'Pause';pause.setAttribute('aria-pressed',String(batch.paused));stop.disabled=batch.stopped;
  const ready=batch.rows.filter(r=>r.selected&&r.state==='ready').length,saved=batch.rows.filter(r=>r.state==='saved').length,active=batch.rows.filter(r=>r.selected&&['queued','researching'].includes(r.state)).length;
  const included=batch.rows.filter(r=>r.selected||r.state==='duplicate'||r.state==='saved'),checked=included.filter(r=>!['queued','researching'].includes(r.state)).length;
  const researchProgress=host.querySelector<HTMLProgressElement>('[data-research-progress]')!;researchProgress.max=Math.max(1,included.length);researchProgress.value=checked;
  host.querySelector('[data-research-count]')!.textContent=`${checked} / ${included.length} checked`;
  const photos=included.filter(r=>r.artwork==='ready').length,photoActive=included.some(r=>r.artwork==='working'),photoErrors=included.filter(r=>r.artwork==='error').length;
  host.querySelector('[data-photo-count]')!.textContent=`${photos} bottle photo${photos===1?'':'s'} ready${photoActive?' · Preparing photos…':''}${photoErrors?` · ${photoErrors} need another attempt`:''}`;
  const progress=batch.saveProgress;host.querySelector<HTMLElement>('[data-saving-progress]')!.hidden=!progress;
  if(progress){const meter=host.querySelector<HTMLProgressElement>('[data-save-progress]')!;meter.max=progress.total;meter.value=progress.completed;host.querySelector('[data-save-count]')!.textContent=`${progress.completed} / ${progress.total}`;host.querySelector('[data-save-label]')!.textContent=batch.saving?'Saving to Winebrary':progress.failed?'Finished · some wines need retry':'Save complete';}
  host.querySelector('[data-status]')!.textContent=`${batch.stopped?"Search stopped · ":batch.paused?"Paused · current work finishes · ":""}${ready} ready to save · ${saved} saved${active?` · ${active} still finding`:""}${progress?.failed?` · ${progress.failed} failed — retry below`:""}${progress?.skipped?` · ${progress.skipped} skipped`:""}`;
  save.textContent=batch.saving?'Saving selected wines…':`Save Selected${ready?' ('+ready+')':''}`;save.disabled=batch.saving||!ready;clear.disabled=batch.saving;
  const editable=batch.rows.filter(r=>!['saving','saved','duplicate'].includes(r.state));all.checked=editable.length>0&&editable.every(r=>r.selected);all.indeterminate=editable.some(r=>r.selected)&&!all.checked;all.disabled=!editable.length;const selectAll=host.querySelector<HTMLButtonElement>('[data-select-all]')!;selectAll.disabled=all.disabled;selectAll.textContent=all.checked?'Skip All':'Select All';selectAll.setAttribute('aria-pressed',String(all.checked));
 }
 function reset(){resetMenu();batch?.dispose();batch=undefined;rows.innerHTML='';review.hidden=true;input.hidden=false;error.textContent='';}
 function startBatch(queries:string[]){const location=host.querySelector<HTMLInputElement>('[data-saved-location]')!.value.trim().replace(/\s+/g,' ').slice(0,120);error.textContent='';try{
  const scope=artworkOwner();if(!scope)throw Error('Your device library is still opening. Try again in a moment.');
  const current=()=>artworkOwner()===scope;
  batch?.dispose();
  host.querySelector('[data-location-summary]')!.textContent=location?'Saved list · '+location:'All Saved Wines';
  batch=new WineBatch({current,changed:paint,reuse:query=>readLibrary().items.find(w=>menuDuplicate(query,[w])==='existing'),
   research:async(query,signal)=>(await researchAction({action:'research',query,request_id:crypto.randomUUID()},signal)).draft,
   artwork:async (wine,signal)=>prepareBottleArtwork(wine,scope,signal),
   save:async(row,signal)=>{
    const check=()=>{signal.throwIfAborted();if(!current())throw Error('Account changed. Start again in the current Winebrary.');};check();
    const result=row.existing?{item:row.existing,duplicate:true}:await researchAction({action:'confirm',draft_id:row.draft.id,confirmed:true,review:row.draft.result},signal);check();
    if(location){const collection=isGuestLibrary()?localCollection:cloudCollection;const saved=await collection('/api/collection','PATCH',{id:result.item.id,add_saved_location:location});check();result.item=saved.item;}
    let warning='';
    if(!row.existing&&row.bottle&&!result.item.image_url){try{const photo=await inlineBottle(row.bottle);check();const attached=await researchAction({action:'attach_bottle',collection_id:result.item.id,expected:bottleIdentity(result.item),only_if_missing:true,photo,provenance:row.bottle.provenance},signal);check();result.item=attached.item;}catch(e){check();warning=' Photo attachment will retry.';}}
    const message=await finishWineArtwork(result.item,scope,true);check();
    window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{id:result.item.id}}));
    return (result.duplicate?'Already in Winebrary; existing notes and photo kept. ':'')+message+warning;
   }});
  rows.innerHTML='';input.hidden=true;review.hidden=false;batch.start(queries);
 }catch(e){error.textContent=(e as Error).message;}}
 form.onsubmit=event=>{event.preventDefault();try{startBatch(batchQueries(String(new FormData(form).get('wines')||'')));}catch(e){error.textContent=(e as Error).message;}};
 rows.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.matches('[data-select]'))batch?.select(Number(input.dataset.select),input.checked);});
 rows.addEventListener('click',event=>{const target=event.target as HTMLElement,node=target.closest<HTMLElement>('[data-row]'),control=target.closest('input,label,details,a,button:not([data-row-toggle])');if(node&&(!control||!node.contains(control))){const r=batch?.rows[Number(node.dataset.row)];if(r)batch?.select(r.id,!r.selected);}const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(button?.dataset.retry!==undefined)batch?.retry(Number(button.dataset.retry));if(button?.dataset.photoRetry!==undefined)batch?.retryArtwork(Number(button.dataset.photoRetry));});
 host.querySelector<HTMLButtonElement>('[data-select-all]')!.onclick=()=>{all.checked=!all.checked;all.onchange?.(new Event('change'));};
 all.onchange=()=>{const selected=all.checked;batch?.rows.forEach(r=>batch?.select(r.id,selected));};
 host.querySelector<HTMLButtonElement>('[data-pause]')!.onclick=()=>{if(batch?.paused)batch.resume();else batch?.pause();};
 host.querySelector<HTMLButtonElement>('[data-stop]')!.onclick=()=>batch?.stop();
 clear.onclick=()=>{if(!batch?.saving)reset();};save.onclick=()=>{const current=batch;void current?.saveSelected().then(()=>{if(current===batch&&current.saveProgress?.saved)feedbackSound('saved')});};
 host.querySelector<HTMLButtonElement>('[data-library]')!.onclick=()=>document.querySelector<HTMLButtonElement>('.tab[data-tab="winebrary"]')?.click();
 return reset;
}
