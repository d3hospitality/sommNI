import {feedbackSound} from '../sound-feedback';
import './progress.css';
import { menuDuplicate } from './menu-duplicates';
import type { LibraryWine } from '../winebrary';
import { betaProvider } from '../beta/client';
import { artworkOwner } from '../artwork-store';
import { escape } from './client';
import { batchQueries } from './batch';

type Entry={country?:string;region?:string;query:string;section:string;page:number|null;source_text:string;needs_review:boolean;reason:string};
export function mountMenuImport(host:HTMLElement,start:(queries:string[])=>void,getWines:()=>LibraryWine[]=()=>[]){
 host.innerHTML=`<section class="menu-import"><h3>Read a Wine List</h3><p class="depth-caption">Paste a menu link or upload a PDF/photo. We’ll find the wines among the food and drinks. You choose what to keep.</p><form data-menu-form><label>Menu Link<input name="menu-link" type="url" inputmode="url" placeholder="Paste a restaurant menu, PDF or image link" autocomplete="off"></label><div class="menu-upload"><span aria-hidden="true">＋</span><span>Upload Menu <small>PDF · JPG · PNG · WebP · up to 12 MB</small></span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf" aria-label="Upload Menu"></div><p data-file-name class="depth-caption"></p><button type="submit" class="wl-primary" data-read>Find Wines in Menu →</button></form><div class="wine-progress" data-menu-progress hidden><div><span>Reading Wine List</span></div><progress aria-label="Reading wines from menu"></progress></div><p data-menu-status role="status" aria-live="polite"></p><button data-cancel type="button" class="wl-text-button" hidden>Cancel Reading</button><section data-menu-review hidden aria-label="Check wines found in menu"><p class="depth-caption">Edit any name or year. Tap a wine to include it; grey rows are skipped. Unclear entries and possible repeats start skipped. Wines already saved are marked and excluded. Nothing is saved yet.</p><details class="menu-reading-notes"><summary>Reading Notes</summary><p data-menu-warnings class="depth-caption"></p></details><div class="batch-toolbar"><input type="checkbox" data-menu-all hidden aria-hidden="true" tabindex="-1"><button type="button" data-menu-select-all class="wl-outline" aria-pressed="false">Select All</button><button type="button" data-menu-back class="wl-text-button">Change Menu</button></div><div data-menu-places class="menu-places" aria-label="Select wines by country and region"></div><div class="menu-columns" aria-hidden="true"><span>Selection</span><span>Wine / Producer / Vintage</span><span>Status</span></div><div data-menu-entries></div><button type="button" data-menu-research class="wl-primary">Research Selected Wines →</button></section></section>`;
 const form=host.querySelector<HTMLFormElement>('form')!,link=form.querySelector<HTMLInputElement>('[name=menu-link]')!,file=form.querySelector<HTMLInputElement>('[type=file]')!,read=host.querySelector<HTMLButtonElement>('[data-read]')!,status=host.querySelector<HTMLElement>('[data-menu-status]')!,cancel=host.querySelector<HTMLButtonElement>('[data-cancel]')!,review=host.querySelector<HTMLElement>('[data-menu-review]')!,entries=host.querySelector<HTMLElement>('[data-menu-entries]')!,all=host.querySelector<HTMLInputElement>('[data-menu-all]')!,research=host.querySelector<HTMLButtonElement>('[data-menu-research]')!;
 let foundEntries:Entry[]=[];
 let controller:AbortController|undefined,revision=0;
 const selections=()=>Array.from(entries.querySelectorAll<HTMLInputElement>('[data-keep]:not(:disabled)'));
 function markDuplicates(initial=false){
  const wines=getWines();
  entries.querySelectorAll<HTMLElement>('.menu-entry').forEach(row=>{
   const query=row.querySelector<HTMLTextAreaElement>('[data-query]')!,box=row.querySelector<HTMLInputElement>('[data-keep]')!,badge=row.querySelector<HTMLElement>('[data-duplicate]')!;
   const match=menuDuplicate(query.value,wines),wasDisabled=box.disabled;box.disabled=match==='existing';
   if(match==='existing'||initial&&match==='possible')box.checked=false;
   else if(wasDisabled)box.checked=false; // Editing an existing label needs explicit approval again.
   row.classList.toggle('is-duplicate',match==='existing');
   badge.textContent=match==='existing'?'Already in your Winebrary':match==='possible'?'Possible match · check vintage':'New to your Winebrary';
   badge.dataset.match=match;
  });
 }

 function counts(){
  const boxes=selections(),count=boxes.filter(b=>b.checked).length;all.checked=!!boxes.length&&count===boxes.length;all.indeterminate=count>0&&count<boxes.length;research.disabled=!count;research.textContent=`Research ${count} Selected Wine${count===1?'':'s'} →`;
  const selectAll=host.querySelector<HTMLButtonElement>('[data-menu-select-all]')!;selectAll.textContent=all.checked?'Skip All':'Select All';selectAll.setAttribute('aria-pressed',String(all.checked));
  entries.querySelectorAll<HTMLElement>('.menu-entry').forEach(row=>{const box=row.querySelector<HTMLInputElement>('[data-keep]')!,toggle=row.querySelector<HTMLButtonElement>('[data-menu-toggle]')!;row.dataset.selected=String(box.checked);toggle.setAttribute('aria-pressed',String(box.checked));toggle.disabled=box.disabled;toggle.textContent=box.disabled?'Already Saved':box.checked?'Selected · Tap to Skip':'Skipped · Tap to Include';});
  host.querySelectorAll<HTMLButtonElement>('[data-place-country]').forEach(button=>{const subset=boxes.filter(b=>{const e=foundEntries[Number(b.dataset.keep)];return (e.country||'Not stated')===button.dataset.placeCountry&&(!button.dataset.placeRegion||(e.region||'Not stated')===button.dataset.placeRegion)}),selected=subset.filter(b=>b.checked).length;button.disabled=!subset.length;button.setAttribute('aria-pressed',selected===subset.length&&selected>0?'true':'false');button.dataset.partial=String(selected>0&&selected<subset.length);button.querySelector('small')!.textContent=`${selected} / ${subset.length}`;});
 }
 function places(){
  const groups=new Map<string,Set<string>>();for(const e of foundEntries){const country=e.country||'Not stated';if(!groups.has(country))groups.set(country,new Set());groups.get(country)!.add(e.region||'Not stated');}
  host.querySelector('[data-menu-places]')!.innerHTML='<p class="depth-caption">Include or skip a whole place. Places come from the menu and our Atlas. Unclear places stay separate.</p>'+[...groups].map(([country,regions])=>`<div class="menu-place-group"><button type="button" data-place-country="${escape(country)}" class="place-pill">${escape(country==='Not stated'?'Country not stated':country)} <small></small></button><details><summary>Regions · ${regions.size}</summary><div>${[...regions].map(region=>`<button type="button" data-place-country="${escape(country)}" data-place-region="${escape(region)}" class="place-pill">${escape(region==='Not stated'?'Region not stated':region)} <small></small></button>`).join('')}</div></details></div>`).join('');
 }

 function idle(){read.disabled=false;file.disabled=false;link.disabled=false;cancel.hidden=true;host.querySelector<HTMLElement>('[data-menu-progress]')!.hidden=true;}
 function reset(){revision++;controller?.abort();controller=undefined;idle();form.hidden=false;review.hidden=true;status.textContent='';entries.replaceChildren();foundEntries=[];host.querySelector('[data-menu-places]')!.replaceChildren();}
 file.onchange=()=>{if(file.files?.length){link.value='';host.querySelector('[data-file-name]')!.textContent=file.files[0].name;}};
 link.oninput=()=>{if(link.value.trim()){file.value='';host.querySelector('[data-file-name]')!.textContent='';}};
 cancel.onclick=()=>{reset();status.textContent='Reading cancelled. Your Winebrary is unchanged.';};
 host.querySelector<HTMLButtonElement>('[data-menu-back]')!.onclick=reset;
 form.onsubmit=async event=>{
  event.preventDefault();const token=++revision,owner=artworkOwner();controller?.abort();controller=new AbortController();const signal=controller.signal;
  const current=()=>token===revision&&!signal.aborted&&artworkOwner()===owner;
  try{
   let payload:Record<string,unknown>;const chosen=file.files?.[0];
   if(chosen){
    if(!chosen.size||chosen.size>12*1024*1024)throw Error('Choose a menu under 12 MB.');
    if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(chosen.type)&&!(!chosen.type&&/\.pdf$/i.test(chosen.name)))throw Error('Choose a PDF, JPEG, PNG or WebP menu.');
    read.disabled=true;file.disabled=true;link.disabled=true;cancel.hidden=false;host.querySelector<HTMLElement>('[data-menu-progress]')!.hidden=false;status.textContent='Reading menu file…';
    const document=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();const abort=()=>reader.abort();signal.addEventListener('abort',abort,{once:true});reader.onloadend=()=>signal.removeEventListener('abort',abort);reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Could not read this file. Choose it again.'));reader.onabort=()=>reject(Error('Reading cancelled.'));reader.readAsDataURL(chosen.type?chosen:new Blob([chosen],{type:'application/pdf'}));});
    if(!current())return;payload={document};
   }else{
    const url=link.value.trim();if(!url)throw Error('Paste a menu link or upload a PDF/photo first.');
    let parsed:URL;try{parsed=new URL(url);}catch{throw Error('Paste a complete HTTPS menu link.');}if(parsed.protocol!=='https:')throw Error('Use an HTTPS link to a public menu page, PDF or image.');payload={url};
   }
   read.disabled=true;file.disabled=true;link.disabled=true;cancel.hidden=false;host.querySelector<HTMLElement>('[data-menu-progress]')!.hidden=false;status.textContent='Finding wine sections and reading labels… Larger menus may take a minute.';
   const result=await betaProvider({action:'import_menu',...payload},signal);if(!current())return;
   const found:Entry[]=Array.isArray(result.entries)?result.entries:[];foundEntries=found;
   status.textContent=found.length?`${found.length} wines found${result.duplicates?` · ${result.duplicates} repeated listings merged`:''}. Check the names and vintages below.`:'No identifiable wines found. Try a clearer image or the wine pages from the menu.';
   host.querySelector('[data-menu-warnings]')!.textContent=[...(result.warnings||[]),...(result.truncated?['Some entries could not fit in this reading (up to 400 wines). Import the remaining wine sections separately.']:[])].join(' ');
   host.querySelector<HTMLElement>('.menu-reading-notes')!.hidden=!host.querySelector('[data-menu-warnings]')!.textContent;
   entries.innerHTML=found.map((entry,i)=>`<article class="menu-entry${entry.needs_review?' needs-review':''}"><input hidden aria-hidden="true" tabindex="-1" type="checkbox" data-keep="${i}" aria-label="Keep ${escape(entry.query)}" ${entry.needs_review?'':'checked'}><div><button type="button" data-menu-toggle="${i}" class="wine-selection-toggle"></button><textarea data-query="${i}" aria-label="Wine ${i+1} name and vintage" rows="2" maxlength="400">${escape(entry.query)}</textarea><small>${escape([entry.section,entry.page?`Page ${entry.page}`:''].filter(Boolean).join(' · '))}</small>${entry.needs_review?`<p class="menu-review-reason">Check this label · ${escape(entry.reason||'Some text was unclear.')}</p>`:''}<details><summary>Menu Text</summary><p>${escape(entry.source_text)}</p></details></div><p class="menu-match" data-duplicate role="status"></p></article>`).join('');
   form.hidden=found.length>0;review.hidden=false;markDuplicates(true);places();counts();if(found.length)feedbackSound('ready');
  }catch(error){if(current())status.textContent=(error as Error).message||'Could not read this menu. Try again.';}
  finally{if(token===revision)idle();}
 };
 host.querySelector<HTMLButtonElement>('[data-menu-select-all]')!.onclick=()=>{all.checked=!all.checked;all.onchange?.(new Event('change'));};
 host.querySelector('[data-menu-places]')!.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-place-country]');if(!button||button.disabled)return;const checked=button.getAttribute('aria-pressed')!=='true';selections().filter(b=>{const e=foundEntries[Number(b.dataset.keep)];return (e.country||'Not stated')===button.dataset.placeCountry&&(!button.dataset.placeRegion||(e.region||'Not stated')===button.dataset.placeRegion)}).forEach(b=>b.checked=checked);counts();});
 entries.addEventListener('click',event=>{const target=event.target as HTMLElement,row=target.closest('.menu-entry');if(!row)return;const control=target.closest('textarea,input,details,a,button:not([data-menu-toggle])');if(control&&row.contains(control))return;const box=row.querySelector<HTMLInputElement>('[data-keep]');if(box&&!box.disabled){box.checked=!box.checked;counts();}});
 entries.addEventListener('input',()=>{markDuplicates();counts();});
 entries.addEventListener('change',counts);all.onchange=()=>{selections().forEach(box=>box.checked=all.checked);counts();};
 research.onclick=()=>{try{markDuplicates();counts();const values=selections().filter(b=>b.checked).map(b=>entries.querySelector<HTMLTextAreaElement>(`[data-query="${b.dataset.keep}"]`)!.value.trim());if(values.some(v=>!v))throw Error('Enter a name for each selected wine, or tap it to skip.');start(batchQueries(values.join('\n')));}catch(error){status.textContent=(error as Error).message;}};
 return reset;
}
