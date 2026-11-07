import {bottlePhotoUpload, bindBottlePhotoUpload} from './photo-upload';
import {revealHomeTask} from '../home-task';
import {photoChoices} from './photo-choices';
import { sakeFields, bindSakeFields } from '../sake';
import { mountBatchResearch } from './batch-phone';
import {isGuestLibrary} from '../cloud-library';
import { findBottleCandidates, clipBottleCandidate } from './bottle-jobs';
import { highlightArrival } from './arrival';
import { shareWineControl, finishWineArtwork } from '../wine-contributions';
import { artworkOwner } from '../artwork-store';
import { catalogBottleCandidates, catalogBottleDraft, bottleCutoutEndpoint, bottleCutoutHosted, createBottleCutout, photoData, inlineBottle, bottleIdentity, type BottleDraft } from './bottles';
import { referenceNotes } from '../reference-notes';
import { FREE_BETA } from '../beta/config';
import { account } from '../account-client';
import { ACCOUNT_SITE } from '../account-config';
import { researchAction, escape } from './client';
import { mountWineNotesExport } from './notes';
import './research.css';
export function initResearchPanel() {
 const history=document.getElementById('wine-history');if(!history)return;
 const root=document.createElement('section');root.id='wine-research';root.className='wine-research';history.before(root);
 let user:string|null=null,revision=0,reviewVersion=0,busy=false,photo:string|null=null,draft:any=null;
 root.innerHTML=`<div class="research-heading"><div><p class="wl-kicker">YOUR NEXT DISCOVERIES</p><h2>Add a wine.</h2></div><p>One bottle or a whole list. We’ll find the details; you choose what to keep.</p></div>
 <div class="history-tabs" role="group" aria-label="Wine assistant"><button type="button" data-mode="research" aria-pressed="true">Add a wine</button><button type="button" data-mode="batch" aria-pressed="false">Add multiple wines</button><button type="button" data-mode="ask" aria-pressed="false">Ask & recommend</button></div>
 <div id="research-find"><form id="research-form"><label>Which wine?<input name="query" maxlength="400" placeholder="Wine name, producer, year — whatever you know" autocomplete="off"></label><div class="research-input-row">${bottlePhotoUpload('research-photo')}<div><img id="research-photo-preview" hidden alt="Your wine label"><button id="research-clear-photo" class="wl-text-button" type="button" hidden>Remove photo</button></div></div><p class="depth-caption">Your name or photo is sent for AI-assisted identification. Nothing is added until you confirm.</p><button id="research-submit" type="submit" class="wl-primary">Find my bottle →</button><details class="research-extra"><summary>Enter manually or resume a draft</summary><button type="button" class="wl-text-button" id="research-manual">Enter details myself</button><button id="research-resume" type="button" class="wl-text-button">Resume latest draft</button><label class="research-check"><input type="checkbox" name="refresh"> Research again using fresh web sources</label></details></form><div id="research-review" aria-label="Wine review"></div></div>
 <div id="research-batch" hidden></div><div id="research-ask" hidden><form id="research-question"><label>Your wine question<textarea name="question" rows="3" maxlength="1200" required placeholder="Which of my wines would suit mushroom risotto, and why?"></textarea></label><label class="research-check"><input type="checkbox" name="library" checked> Include names and vintages from my 50 most recently saved wines</label><p class="depth-caption">Your question and selected library context are sent to our AI provider.</p><button type="submit" class="wl-primary">Ask sommNI ↗</button></form><div id="research-answer" aria-live="polite"></div></div><p id="research-feedback" role="status" aria-live="polite"></p><details class="research-extra"><summary>Connection & privacy</summary><p id="research-account" class="depth-caption"></p><p id="research-capabilities" class="depth-caption" role="status"></p></details>`;
 const get=<T extends HTMLElement>(id:string)=>root.querySelector<T>(`#${id}`)!;
 const resetBatch=mountBatchResearch(get('research-batch'));
 const feedback=(message:string)=>get('research-feedback').textContent=message;
 get('research-manual').addEventListener('click',()=>window.dispatchEvent(new Event('sommni-manual-wine')));
 window.addEventListener('sommni-add-wine',event=>{
  document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();
  revealHomeTask(root);if(busy){root.scrollIntoView({block:'start'});return;}reviewVersion++;
  get('research-find').hidden=false;get('research-batch').hidden=true;get('research-ask').hidden=true;get('research-form').hidden=false;get('research-review').innerHTML='';
  root.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode==='research')));
  const query=(event as CustomEvent<{query?:string}>).detail?.query;
  if(query!==undefined)(get<HTMLFormElement>('research-form').elements.namedItem('query') as HTMLInputElement).value=query;
  revealHomeTask(root);root.scrollIntoView({block:'start'});get<HTMLFormElement>('research-form').querySelector<HTMLInputElement>('[name="query"]')?.focus({preventScroll:true});
 });
 function citedReport(report:string,_citations:any[]=[],_sources:any[]=[]){
  return escape(report.replace(/https?:\/\/[^\s<>]+/g,'')).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
 }

 async function run(task:(token:number)=>Promise<void>) {
  if(busy)return;if(!FREE_BETA&&!user){feedback('Sign in to your sommNI account first.');return;}
  busy=true;const token=++revision;root.setAttribute('aria-busy','true');root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{await task(token)}catch(error){if(token===revision)feedback(error instanceof Error?error.message:'Try again.');}
  finally{if(token===revision){busy=false;root.removeAttribute('aria-busy');root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}}
 }
 function evidence(_host:HTMLElement,_result:any) { /* Audit evidence stays on the server. */ }
 function showDraft(value:any) {
  draft=value;const wine=value.result,host=get('research-review'),version=++reviewVersion,scope=artworkOwner();let bottle: BottleDraft|null=null,manualPhoto=false,choiceRevision=0,clipBusy=false;
  get('research-form').hidden=true;
  host.innerHTML=`<div class="research-review-top"><p class="wl-kicker">FOUND IT · READY TO REVIEW</p><h3>Is this your wine?</h3><p>${escape(wine.uncertainty||'Check the name, producer and year. You can change anything below.')}</p><button type="button" class="wl-text-button" id="research-start-over">Search a different wine</button></div><form id="research-confirm"><div class="research-fields">${[['wine_name','Wine name'],['producer','Producer']].map(([name,label])=>`<label>${label}<input name="${name}" value="${escape(wine[name])}" maxlength="200" ${name==='wine_name'?'required':''}></label>`).join('')}<label>Vintage<select name="vintage_state">${[['unknown','Not sure'],['year','Known year'],['non_vintage','Non-vintage']].map(([v,label])=>`<option value="${v}" ${wine.vintage_state===v?'selected':''}>${label}</option>`).join('')}</select></label><label>Year<input type="number" name="vintage" min="1800" max="${new Date().getFullYear()+1}" value="${escape(wine.vintage??'')}"></label></div><p class="research-facts">${escape([wine.region,wine.country,wine.grape].filter(Boolean).join(' · '))}</p><details class="research-extra"><summary>Details & tasting notes <span>Already filled in</span></summary><div class="research-fields">${[['region','Region'],['country','Country'],['grape','Grape']].map(([name,label])=>`<label>${label}<input name="${name}" value="${escape(wine[name])}" maxlength="200"></label>`).join('')}<label>Style<select name="color">${['','Red','White','Sparkling','Rosé','Orange','Dessert','Sake'].map(c=>`<option ${wine.color===c?'selected':''}>${c}</option>`).join('')}</select></label></div>${sakeFields(wine)}<label>Reference tasting notes<textarea name="tasting_notes" rows="5" maxlength="2000">${escape(referenceNotes(wine.tasting_notes))}</textarea></label><p class="depth-caption">AI reference notes stay separate from your personal observations.</p></details><details class="research-extra" open><summary>Bottle image <span>We find it and remove the background</span></summary><div id="research-bottle"></div></details><details class="research-extra"><summary>Research & sources</summary><p class="research-pre">${citedReport(value.report||'',value.evidence?.citations,value.evidence?.sources)}</p><div id="research-evidence"></div></details><input type="hidden" name="confirmed" value="on"><p class="depth-caption">${isGuestLibrary()?'Saved on this device, including notes and bottle artwork. You can choose a photo now or add one later in Winebrary.':'Saving confirms that you’ve reviewed this wine’s identity and reference details.'}</p>${shareWineControl('research-share-master')}<button type="submit" class="wl-primary">${isGuestLibrary()?'Save locally to Winebrary':'Save to my Winebrary'} →</button></form>`;
  get('research-start-over').onclick=()=>{reviewVersion++;get('research-form').hidden=false;host.innerHTML='';get<HTMLFormElement>('research-form').querySelector<HTMLInputElement>('[name="query"]')?.focus();};
  evidence(get('research-evidence'),value);
  bindSakeFields(host.querySelector('#research-confirm')!);
  const bottleHost=get('research-bottle'),candidates=catalogBottleCandidates(wine);
  bottleHost.innerHTML=`<section class="research-bottle"><p class="wl-kicker">YOUR BOTTLE, IN FOCUS</p><div id="research-bottle-options" class="research-bottle-options"></div><div id="research-bottle-preview"></div><p>${candidates.length===1?'We have a photograph of this catalog label. Review it below; its pictured vintage may differ.':'Choose a photo. We remove the background and keep the real label.'}</p>${bottlePhotoUpload('research-bottle-file',!bottleCutoutEndpoint())}<p class="depth-caption">JPEG, PNG or WebP · up to 15 MB. Include the whole bottle. ${!bottleCutoutEndpoint()?'Bottle photo processing is unavailable on this build. You can still use a catalog image or add an original photo in Winebrary.':bottleCutoutHosted()?'':'Processed by the photo cutter.'}</p><label class="research-check" id="research-use-bottle" hidden><input type="checkbox" name="use_bottle"> Use this reviewed bottle image with my wine</label><p id="research-bottle-status" role="status" aria-live="polite"></p><button id="research-retry-bottle" type="button" class="wl-text-button" hidden>Search again</button></section>`;
  const showBottle=()=>{
   get('research-bottle-preview').innerHTML=bottle?`<img src="${escape(bottle.url)}" alt="Bottle photograph for review"><p class="depth-caption">${bottle.provenance?.catalog_id?'Catalog photograph · exact vintage unverified':bottle.provenance?.vintage_binding||'Transparent photograph · original label preserved'}</p>`:'';
   get('research-use-bottle').hidden=!bottle||!manualPhoto;
   if(bottle)highlightArrival(get('research-bottle-preview'));
  };
  const currentReview=()=>version===reviewVersion&&host.contains(bottleHost)&&scope===artworkOwner();
  const searchBottle=async(refresh=false)=>{
   if(!scope||clipBusy)return;const defaultChoice=++choiceRevision;manualPhoto=false;const retry=get<HTMLButtonElement>('research-retry-bottle');retry.hidden=true;
   get('research-bottle-status').textContent='Finding up to 3 bottle photographs… '+(isGuestLibrary()?'You can save locally now.':'You can save your wine now.');
   try{
    const options=await findBottleCandidates(wine,scope,refresh);if(!currentReview()||manualPhoto||defaultChoice!==choiceRevision)return;
    get('research-bottle-options').innerHTML=photoChoices(options);
    get('research-bottle-options').querySelectorAll<HTMLButtonElement>('[data-photo-option]').forEach(button=>button.onclick=()=>{
     get('research-bottle-options').querySelectorAll('[data-photo-option]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
     manualPhoto=true;clipBusy=true;bottle=null;showBottle();const choice=++choiceRevision;
     get('research-bottle-status').textContent='Clipping your selected bottle photograph…';
     const selected=options[Number(button.dataset.photoOption)];
     void clipBottleCandidate(selected).then(next=>{if(!currentReview()||choice!==choiceRevision)return;bottle=next;manualPhoto=true;showBottle();(root.querySelector('[name="use_bottle"]') as HTMLInputElement).checked=true;get('research-bottle-status').textContent='Selected bottle ready. It will save with your wine.';}).catch(error=>{if(!currentReview()||choice!==choiceRevision)return;bottle={url:selected.photo,path:'',source:'photograph',provenance:{...selected.provenance,pipeline:'selected-original'}};showBottle();(root.querySelector('[name="use_bottle"]') as HTMLInputElement).checked=true;get('research-bottle-status').textContent='Background removal is unavailable. Your selected original is ready to save.';}).finally(()=>{if(currentReview()&&choice===choiceRevision)clipBusy=false;});
    });
    get('research-bottle-status').textContent=`${options.length} photo${options.length===1?'':'s'} found. Choose the closest label; the year may differ.`;retry.hidden=false;}
   catch(error){if(!currentReview()||manualPhoto)return;get('research-bottle-status').textContent=(error as Error).message+' You can still save this wine now.';retry.hidden=false;}
  };
  get('research-retry-bottle').onclick=()=>void searchBottle(true);
  if(candidates.length===1){bottle=catalogBottleDraft(candidates[0]);showBottle();get('research-bottle-status').textContent='Catalog bottle ready. Choose Search again for alternatives.';get('research-retry-bottle').hidden=false;}
  void searchBottle();
  get<HTMLInputElement>('research-bottle-file').onchange=event=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;bottle=null;showBottle();get('research-bottle-options').querySelectorAll('[data-photo-option]').forEach(b=>b.setAttribute('aria-pressed','false'));manualPhoto=true;choiceRevision++;clipBusy=false;void run(async token=>{
   (root.querySelector('[name="use_bottle"]') as HTMLInputElement).checked=false;
   get('research-bottle-status').textContent='Separating your bottle from its background…';
   try {const original=await photoData(file);if(token!==revision||!currentReview())return;bottle={url:original,path:'',source:'photograph',provenance:{pipeline:'user-upload-original'}};showBottle();(root.querySelector('[name="use_bottle"]') as HTMLInputElement).checked=true;const next=await createBottleCutout(original);if(token!==revision||!currentReview())return;bottle=next;showBottle();(root.querySelector('[name="use_bottle"]') as HTMLInputElement).checked=true;get('research-bottle-status').textContent='Your photo is selected and will save with this wine. Check the label, neck and base below.';}
   catch(error){if(token===revision&&currentReview())get('research-bottle-status').textContent=bottle?'Background removal is unavailable. Your original photo is selected and ready to save.':(error as Error).message;}
  });};
  bindBottlePhotoUpload(root,'research-bottle-file');
  const form=get<HTMLFormElement>('research-confirm'),state=form.elements.namedItem('vintage_state') as HTMLSelectElement,year=form.elements.namedItem('vintage') as HTMLInputElement;
  const sync=()=>{year.disabled=state.value!=='year';year.required=state.value==='year';};sync();state.addEventListener('change',sync);
  form.addEventListener('submit',event=>{event.preventDefault();if(clipBusy){feedback('Your selected bottle is still being clipped. Wait for its preview before saving.');return;}void run(async token=>{
   const values=Object.fromEntries(new FormData(form));const reviewed={...values,vintage:values.vintage_state==='year'?Number(values.vintage):null};
   const identityChanged=['wine_name','producer','vintage','vintage_state'].some(key=>String((reviewed as Record<string,unknown>)[key]??'').trim().toLowerCase()!==String(draft.result[key]??'').trim().toLowerCase());
   if(identityChanged){
    feedback('Identity changed. Checking the corrected wine before saving…');
    const query=[values.producer,values.wine_name,values.vintage_state==='year'?values.vintage:values.vintage_state].filter(Boolean).join(' ');
    const researched=await researchAction({action:'research',query,request_id:crypto.randomUUID()});
    if(token!==revision)return;showDraft(researched.draft);feedback('Corrected identity researched. Review these new notes and confirm again. We’re finding the matching bottle image.');return;
   }
   const result=await researchAction({action:'confirm',draft_id:draft.id,confirmed:values.confirmed==='on',review:reviewed});
   if(token!==revision)return;
   let bottleMessage='';
   if((!manualPhoto||values.use_bottle==='on')&&bottle&&(manualPhoto||!result.duplicate||!result.item.image_url)){
    try {const photo=await inlineBottle(bottle);if(token!==revision||!currentReview())return;const attached=await researchAction({action:'attach_bottle',collection_id:result.item.id,expected:bottleIdentity(result.item),only_if_missing:!manualPhoto,photo,provenance:bottle.provenance});if(token!==revision)return;result.item=attached.item;bottleMessage=' Your reviewed bottle photograph is saved with it.';}
    catch(error){bottleMessage=` Wine saved, but its bottle image could not be attached: ${(error as Error).message} Open Winebrary to retry.`;}
   }
   if(token!==revision)return;
   const artworkMessage=await finishWineArtwork(result.item,artworkOwner()||'beta-local',true,false);
   if(token!==revision)return;bottleMessage+=' '+artworkMessage;
   host.innerHTML=`<p class="wl-kicker">SAVED TO YOUR WINEBRARY${isGuestLibrary()?' · ON THIS DEVICE':''}</p>${result.item.image_url?`<img class="research-saved-bottle" src="${escape(result.item.image_url)}" alt="Saved bottle photograph">`:''}<h3>${escape(result.item.wine_name)}</h3><p>Reference notes now belong to this wine in your library.${escape(bottleMessage)}</p><button id="research-open-library" class="wl-primary" type="button">Open my Winebrary →</button><div id="research-saved-notes"></div>`;
   get('research-open-library').onclick=()=>document.querySelector<HTMLButtonElement>('.tab[data-tab="winebrary"]')?.click();
   mountWineNotesExport(get('research-saved-notes'),result.item);highlightArrival(host,true);window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{id:result.item.id}}));feedback(result.duplicate?'This exact wine and vintage is already in your Winebrary. Your notes were preserved; any selected replacement photo has been applied.':'Wine saved. Open Winebrary to view it or show it on G2.');
  });});
  highlightArrival(host,true);
 }
 window.addEventListener('sommni-review-draft',event=>{
  if(busy)return;const value=(event as CustomEvent).detail?.draft;if(!value?.id||!value.result)return;
  event.preventDefault();
  document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();
  get('research-find').hidden=false;get('research-batch').hidden=true;get('research-ask').hidden=true;revealHomeTask(root);showDraft(value);root.scrollIntoView({block:'start'});feedback('From your glasses. Check the details, then save.');
 });
 root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.addEventListener('click',()=>{if(FREE_BETA&&button.dataset.mode==='ask'){revealHomeTask(document.getElementById('wine-sommelier'));document.getElementById('wine-sommelier')?.scrollIntoView({block:'start'});document.getElementById('sommelier-input')?.focus({preventScroll:true});return;}root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));get('research-batch').hidden=button.dataset.mode!=='batch';get('research-find').hidden=button.dataset.mode!=='research';get('research-ask').hidden=button.dataset.mode!=='ask';feedback('');}));
 get('research-clear-photo').addEventListener('click',()=>{photo=null;get<HTMLImageElement>('research-photo-preview').hidden=true;get('research-clear-photo').hidden=true;get<HTMLInputElement>('research-photo').value='';get<HTMLInputElement>('research-photo-camera').value='';const filename=get('research-photo').closest('.sommni-photo-upload')?.querySelector('[data-photo-filename]');if(filename)filename.textContent='';});
 get<HTMLInputElement>('research-photo').onchange=async event=>{
  if(busy)return;const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;const token=++revision;photo=null;
  try{
   const data=await photoData(file);if(token!==revision)return;photo=data;
   const preview=get<HTMLImageElement>('research-photo-preview');preview.src=photo!;preview.hidden=false;get('research-clear-photo').hidden=false;feedback('Photo ready. It is sent only when you choose Find my bottle.');
  }catch(error){if(token===revision)feedback(error instanceof Error?error.message:'Photo unavailable.');}
 };
 bindBottlePhotoUpload(root,'research-photo');
 get('research-form').addEventListener('submit',event=>{event.preventDefault();void run(async token=>{
  const query=String(new FormData(get<HTMLFormElement>('research-form')).get('query')||'').trim();if(!query&&!photo)throw new Error('Enter a wine name or add a photo.');
  get('research-review').innerHTML='';feedback('Reading the wine and checking web sources…');
  const result=await researchAction({action:'research',query,photo,refresh:new FormData(get<HTMLFormElement>('research-form')).get('refresh')==='on',request_id:crypto.randomUUID()});if(token!==revision)return;showDraft(result.draft);feedback(result.cached?'Saved research restored—no new lookup needed. Review it before saving.':'Research ready. Review it before saving.');
 });});
 get('research-resume').addEventListener('click',()=>void run(async token=>{const result=await researchAction({action:'drafts'});if(token!==revision)return;if(result.drafts.length){showDraft(result.drafts[0]);feedback('Latest unfinished draft restored.');}else feedback('No unfinished research drafts.');}));
 get('research-question').addEventListener('submit',event=>{event.preventDefault();void run(async token=>{
  const values=new FormData(get<HTMLFormElement>('research-question'));feedback('Considering your question and checking sources…');
  const result=await researchAction({action:'ask',question:values.get('question'),use_library:values.get('library')==='on',request_id:crypto.randomUUID()});if(token!==revision)return;
  const host=get('research-answer');host.innerHTML=`<p class="wl-kicker">SOMMNI ANSWER</p><p class="research-pre">${citedReport(result.answer,result.citations,result.sources)}</p><p class="depth-caption">${result.library_count} recent library wines included. To save a recommendation, research its exact wine and vintage in “Find a wine”.</p>`;evidence(host,result);highlightArrival(host,true);feedback('Answer ready.');
 });});
 async function sessionChanged(id:string|null) {
  if(id===user)return;resetBatch();user=id;revision++;reviewVersion++;busy=false;photo=null;draft=null;root.removeAttribute('aria-busy');root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);get('research-review').innerHTML='';get('research-form').hidden=false;get('research-answer').innerHTML='';get<HTMLFormElement>('research-form').reset();get<HTMLFormElement>('research-question').reset();get<HTMLImageElement>('research-photo-preview').hidden=true;get('research-clear-photo').hidden=true;feedback('');
  get('research-account').innerHTML=id==='beta-local'?'Guest Winebrary · saved on this device.':id?'Private to your sommNI account.':`<a href="${escape(ACCOUNT_SITE)}" target="_blank" rel="noopener noreferrer">Sign in to research and save wines ↗</a>`;
  get('research-capabilities').textContent='';if(id){const token=revision;try{const status=await researchAction({action:'status'});if(token!==revision)return;get('research-capabilities').textContent=`${status.research?`Wine research connected · ${status.research_provider||'sourced web lookup'}.`:'Wine research is not available yet.'}`;}catch{if(token===revision)get('research-capabilities').textContent='Research connection is not available yet.';}}
 }
 if(FREE_BETA){
  account.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{void sessionChanged(session?.user.id??'beta-local');},0)});
  get('research-account').textContent='Free beta · no account needed. Wines and photos are saved on this device.';
  void researchAction({action:'status'}).then(status=>{get('research-capabilities').textContent=`${status.research?`Wine research connected · ${status.research_provider||'sourced web lookup'}.`:'Live wine research awaits provider setup.'}`;}).catch(()=>{get('research-capabilities').textContent='Live AI is temporarily unavailable. Your library and catalogue remain available.';});
  return;
 }
 get('research-account').innerHTML=`<a href="${escape(ACCOUNT_SITE)}" target="_blank" rel="noopener noreferrer">Sign in to research and save wines ↗</a>`;
 account.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>void sessionChanged(session?.user.id??null),0)});
 void account.auth.getSession().then(result=>sessionChanged(result.data.session?.user.id??null));
}
