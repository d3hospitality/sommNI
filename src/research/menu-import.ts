import { betaProvider } from '../beta/client';
import { artworkOwner } from '../artwork-store';
import { escape } from './client';
import { batchQueries } from './batch';

type Entry={query:string;section:string;page:number|null;source_text:string;needs_review:boolean;reason:string};
export function mountMenuImport(host:HTMLElement,start:(queries:string[])=>void){
 host.innerHTML=`<section class="menu-import"><h3>Read a Wine List</h3><p class="depth-caption">Paste a menu link or upload a PDF/photo. We’ll find the wines among the food and drinks. You choose what to keep.</p><form data-menu-form><label>Menu Link<input name="menu-link" type="url" inputmode="url" placeholder="Paste a PDF or menu image link" autocomplete="off"></label><div class="menu-upload"><span aria-hidden="true">＋</span><span>Upload Menu <small>PDF · JPG · PNG · WebP · up to 12 MB</small></span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf" aria-label="Upload Menu"></div><p data-file-name class="depth-caption"></p><button type="submit" class="wl-primary" data-read>Find Wines in Menu →</button></form><p data-menu-status role="status" aria-live="polite"></p><button data-cancel type="button" class="wl-text-button" hidden>Cancel Reading</button><section data-menu-review hidden aria-label="Check wines found in menu"><p class="depth-caption">Edit any name or year. Unclear entries start unchecked. Nothing is saved yet.</p><details class="menu-reading-notes"><summary>Reading Notes</summary><p data-menu-warnings class="depth-caption"></p></details><div class="batch-toolbar"><label class="research-check"><input type="checkbox" data-menu-all> Check all</label><button type="button" data-menu-back class="wl-text-button">Change Menu</button></div><div data-menu-entries></div><button type="button" data-menu-research class="wl-primary">Research Checked Wines →</button></section></section>`;
 const form=host.querySelector<HTMLFormElement>('form')!,link=form.querySelector<HTMLInputElement>('[name=menu-link]')!,file=form.querySelector<HTMLInputElement>('[type=file]')!,read=host.querySelector<HTMLButtonElement>('[data-read]')!,status=host.querySelector<HTMLElement>('[data-menu-status]')!,cancel=host.querySelector<HTMLButtonElement>('[data-cancel]')!,review=host.querySelector<HTMLElement>('[data-menu-review]')!,entries=host.querySelector<HTMLElement>('[data-menu-entries]')!,all=host.querySelector<HTMLInputElement>('[data-menu-all]')!,research=host.querySelector<HTMLButtonElement>('[data-menu-research]')!;
 let controller:AbortController|undefined,revision=0;
 const selections=()=>Array.from(entries.querySelectorAll<HTMLInputElement>('[data-keep]'));
 function counts(){const boxes=selections(),count=boxes.filter(b=>b.checked).length;all.checked=!!boxes.length&&count===boxes.length;all.indeterminate=count>0&&count<boxes.length;research.disabled=!count;research.textContent=`Research ${count} Checked Wine${count===1?'':'s'} →`;}
 function idle(){read.disabled=false;file.disabled=false;link.disabled=false;cancel.hidden=true;}
 function reset(){revision++;controller?.abort();controller=undefined;idle();form.hidden=false;review.hidden=true;status.textContent='';entries.replaceChildren();}
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
    read.disabled=true;file.disabled=true;link.disabled=true;cancel.hidden=false;status.textContent='Reading menu file…';
    const document=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();const abort=()=>reader.abort();signal.addEventListener('abort',abort,{once:true});reader.onloadend=()=>signal.removeEventListener('abort',abort);reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Could not read this file. Choose it again.'));reader.onabort=()=>reject(Error('Reading cancelled.'));reader.readAsDataURL(chosen.type?chosen:new Blob([chosen],{type:'application/pdf'}));});
    if(!current())return;payload={document};
   }else{
    const url=link.value.trim();if(!url)throw Error('Paste a menu link or upload a PDF/photo first.');
    let parsed:URL;try{parsed=new URL(url);}catch{throw Error('Paste a complete HTTPS menu link.');}if(parsed.protocol!=='https:')throw Error('Use an HTTPS link to a public PDF or menu image.');payload={url};
   }
   read.disabled=true;file.disabled=true;link.disabled=true;cancel.hidden=false;status.textContent='Finding wine sections and reading labels… Larger menus may take a minute.';
   const result=await betaProvider({action:'import_menu',...payload},signal);if(!current())return;
   const found:Entry[]=Array.isArray(result.entries)?result.entries:[];
   status.textContent=found.length?`${found.length} wines found${result.duplicates?` · ${result.duplicates} repeated listings merged`:''}. Check the names and vintages below.`:'No identifiable wines found. Try a clearer image or the wine pages from the menu.';
   host.querySelector('[data-menu-warnings]')!.textContent=[...(result.warnings||[]),...(result.truncated?['This menu has more than 200 wines. Import the remaining wine pages separately.']:[])].join(' ');
   host.querySelector<HTMLElement>('.menu-reading-notes')!.hidden=!host.querySelector('[data-menu-warnings]')!.textContent;
   entries.innerHTML=found.map((entry,i)=>`<article class="menu-entry${entry.needs_review?' needs-review':''}"><input type="checkbox" data-keep="${i}" aria-label="Keep ${escape(entry.query)}" ${entry.needs_review?'':'checked'}><div><textarea data-query="${i}" aria-label="Wine ${i+1} name and vintage" rows="2" maxlength="400">${escape(entry.query)}</textarea><small>${escape([entry.section,entry.page?`Page ${entry.page}`:''].filter(Boolean).join(' · '))}</small>${entry.needs_review?`<p class="menu-review-reason">Check this label · ${escape(entry.reason||'Some text was unclear.')}</p>`:''}<details><summary>Menu Text</summary><p>${escape(entry.source_text)}</p></details></div></article>`).join('');
   form.hidden=found.length>0;review.hidden=false;counts();
  }catch(error){if(current())status.textContent=(error as Error).message||'Could not read this menu. Try again.';}
  finally{if(token===revision)idle();}
 };
 entries.addEventListener('change',counts);all.onchange=()=>{selections().forEach(box=>box.checked=all.checked);counts();};
 research.onclick=()=>{try{const values=selections().filter(b=>b.checked).map(b=>entries.querySelector<HTMLTextAreaElement>(`[data-query="${b.dataset.keep}"]`)!.value.trim());if(values.some(v=>!v))throw Error('Enter a name for each checked wine, or uncheck it.');start(batchQueries(values.join('\n')));}catch(error){status.textContent=(error as Error).message;}};
 return reset;
}
