import { localizedDocument } from '../intelligence/translation';
import { getLocale } from '../intelligence/client';
import './reading.css';
export interface ReadingSection { label:string; text:string; context?:string; source?:{title:string;url:string} }
export interface ReadingDocument { title:string; sections:ReadingSection[] }
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Notes are ordinary selectable text. No recording, narration or automatic following. */
export function mountReadingDocument(host:HTMLElement,doc:ReadingDocument){
 host.classList.add('read-along');
 host.innerHTML=`<div class="read-passages">${doc.sections.filter(s=>s.text.trim()).map(s=>`<section>${s.context?`<p class="wl-kicker">${esc(s.context)}</p>`:''}<h3>${esc(s.label)}</h3><p class="read-passage">${esc(s.text)}</p></section>`).join('')}</div>`;
}
export function openReadingRoom(doc:ReadingDocument){
 document.querySelector<HTMLDialogElement>('#reading-room')?.close();document.querySelector('#reading-room')?.remove();
 const dialog=document.createElement('dialog');dialog.id='reading-room';dialog.setAttribute('aria-label',`${doc.title} reading`);
 dialog.innerHTML=`<div class="reading-room-heading"><div><p class="wl-kicker">SOMMNI / BEHIND THE WINE</p><h2>${esc(doc.title)}</h2></div><button type="button" class="wl-outline" aria-label="Close story">×</button></div><div data-reader></div>`;
 document.body.append(dialog);dialog.showModal();mountReadingDocument(dialog.querySelector('[data-reader]')!,doc);
 if(getLocale()!=='en'){const status=document.createElement('p');status.className='translation-status';status.setAttribute('role','status');status.textContent='Translating the passage…';dialog.querySelector('.reading-room-heading')!.after(status);void localizedDocument(doc).then(translated=>{if(!dialog.open)return;mountReadingDocument(dialog.querySelector('[data-reader]')!,translated);status.textContent='Translated from the original source notes.';}).catch(error=>{if(dialog.open)status.textContent=error.message+' Showing original notes.';});}
 dialog.querySelector('button')!.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
}
