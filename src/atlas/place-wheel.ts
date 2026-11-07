import './place-wheel.css';

import { attachWheelMotion, wheelIndex, WHEEL_ROW as ROW } from './wheel-motion';
export { wheelIndex } from './wheel-motion';
const normalize = (text:string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();

/** A phone wheel over the existing select. Only Done commits to the atlas. */
export function attachPlaceWheel(select:HTMLSelectElement, title:string){
 const trigger=document.createElement('button');trigger.type='button';trigger.id=select.id+'-wheel';trigger.className='place-wheel-trigger';trigger.setAttribute('aria-haspopup','dialog');
 select.hidden=true;select.insertAdjacentElement('afterend',trigger);
 const label=select.closest('label');if(label)label.htmlFor=trigger.id;
 const sheet=document.createElement('dialog');sheet.className='place-wheel-sheet';sheet.setAttribute('aria-labelledby',select.id+'-wheel-title');
 sheet.innerHTML=`<header><h2 id="${select.id}-wheel-title">${title}</h2><button type="button" data-cancel>Cancel</button></header><input type="search" aria-label="Search ${title.toLowerCase()}" placeholder="Find a ${title.toLowerCase()}…" autocomplete="off"><p class="place-wheel-hint">Flick to glide · tap to stop · confirm to explore</p><div class="place-wheel-window"><div class="place-wheel-band" aria-hidden="true"></div><div class="place-wheel-track" role="listbox" tabindex="0" aria-label="${title}"></div></div><p class="place-wheel-empty" role="status" hidden>No matching places</p><button type="button" class="place-wheel-done">Show ${title.toLowerCase()}</button>`;
 document.body.append(sheet);
 const track=sheet.querySelector<HTMLElement>('.place-wheel-track')!,search=sheet.querySelector<HTMLInputElement>('input')!,done=sheet.querySelector<HTMLButtonElement>('.place-wheel-done')!,empty=sheet.querySelector<HTMLElement>('.place-wheel-empty')!;
 let items:HTMLOptionElement[]=[],active=-1,signature='';
 const motion=attachWheelMotion(track,()=>items.length,paint);
 const close=()=>{motion.stop();sheet.close();};
 function paint(index:number){
  const next=wheelIndex(index*ROW,items.length);if(next===active)return;active=next;
  [...track.children].forEach((row,i)=>{row.setAttribute('aria-selected',String(i===active));(row as HTMLElement).style.setProperty('--distance',String(Math.min(2,Math.abs(i-active))));});
  if(items.length)track.setAttribute('aria-activedescendant',select.id+'-choice-'+active);else track.removeAttribute('aria-activedescendant');
 }
 function jump(index:number){motion.stop();paint(index);track.scrollTop=active*ROW;}
 function render(){
  motion.stop();active=-1;
  const query=normalize(search.value.trim());
  items=[...select.options].filter(o=>!o.disabled&&!o.closest('optgroup[disabled]')&&normalize(o.textContent||'').includes(query));
  track.replaceChildren();
  items.forEach((option,i)=>{const row=document.createElement('div');row.id=select.id+'-choice-'+i;row.setAttribute('role','option');row.className='place-wheel-row';row.textContent=option.textContent;row.title=option.textContent||'';row.addEventListener('click',()=>jump(i));track.append(row);});
  done.disabled=!items.length;empty.hidden=!!items.length;track.hidden=!items.length;
  jump(Math.max(0,items.findIndex(o=>o.value===select.value)));
 }
 function sync(){
  const next=select.value+'|'+select.innerHTML+'|'+select.disabled;
  if(sheet.open&&signature!==next)close(); // A globe/G2 update invalidates a pending choice.
  signature=next;trigger.textContent=(select.selectedOptions[0]?.textContent||`Choose ${title.toLowerCase()}`)+' ↕';
  trigger.disabled=select.disabled;trigger.setAttribute('aria-label',title+': '+(select.selectedOptions[0]?.textContent||'Choose'));
 }
 trigger.addEventListener('click',()=>{sync();search.value='';sheet.showModal();render();track.focus({preventScroll:true});});
 search.addEventListener('input',render);
 track.addEventListener('scroll',()=>paint(wheelIndex(track.scrollTop,items.length)),{passive:true});
 track.addEventListener('keydown',event=>{
  const current=wheelIndex(track.scrollTop,items.length);
  const next=event.key==='ArrowDown'?current+1:event.key==='ArrowUp'?current-1:event.key==='Home'?0:event.key==='End'?items.length-1:null;
  if(next!==null){event.preventDefault();jump(next);}else if(event.key==='Enter'){event.preventDefault();done.click();}
 });
 done.addEventListener('click',()=>{
  const chosen=items[wheelIndex(track.scrollTop,items.length)];if(!chosen)return;
  // Validate against the current options; never commit a stale region from another country.
  if(select.disabled||![...select.options].some(o=>o.value===chosen.value&&!o.disabled&&!o.closest('optgroup[disabled]'))){close();sync();return;}
  const changed=select.value!==chosen.value;select.value=chosen.value;close();sync();
  if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));
 });
 sheet.querySelector('[data-cancel]')!.addEventListener('click',close);
 sheet.addEventListener('close',()=>{motion.stop();trigger.focus({preventScroll:true});});
 select.addEventListener('change',sync);sync();
 return {sync,destroy(){motion.destroy();select.removeEventListener('change',sync);if(sheet.open)sheet.close();sheet.remove();trigger.remove();select.hidden=false;if(label)label.removeAttribute('for');}};
}
