import prefectures from './data/japan-prefectures.json';
export const SAKE_CLASSES=['Junmai','Tokubetsu Junmai','Junmai Ginjo','Junmai Daiginjo','Honjozo','Tokubetsu Honjozo','Ginjo','Daiginjo','Futsushu'];
export const SAKE_STYLES=['Nigori','Nama','Genshu','Kimoto','Yamahai','Koshu','Sparkling'];
export const SAKE_RICE=['Yamada Nishiki','Gohyakumangoku','Miyama Nishiki','Omachi','Dewa Sansan','Koshitanrei'];
export const isSake=(value:any)=>String(value?.color??value?.metadata?.color??'').toLowerCase()==='sake';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function sakeFields(value:any={}){
 return `<div class="wl-form-grid sake-fields" ${isSake(value)?'':'hidden'}>${[['sake_classification','Sake classification',SAKE_CLASSES],['sake_style','Sake styles / methods',SAKE_STYLES],['rice_variety','Rice variety',SAKE_RICE]].map(([key,label,options])=>`<label>${label}<input name="${key}" value="${esc(value[key as string])}" maxlength="200" list="${key}-options" placeholder="Leave unknown details blank"><datalist id="${key}-options">${(options as string[]).map(x=>`<option value="${esc(x)}">`).join('')}</datalist></label>`).join('')}<p class="wl-muted small">Styles can overlap: Junmai Nigori, for example. Rice variety and brewery prefecture are separate facts. Use the bottle’s actual release; do not turn a bottling date into a vintage.</p></div><datalist id="sake-prefectures">${prefectures.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>`;
}
export function bindSakeFields(form:HTMLElement){
 const color=form.querySelector<HTMLSelectElement>('[name=color]');if(!color)return;
 const sync=()=>{const sake=color.value==='Sake';form.querySelectorAll<HTMLElement>('.sake-fields').forEach(el=>{el.hidden=!sake;el.querySelectorAll<HTMLInputElement>('input').forEach(i=>i.disabled=!sake)});
  const grape=form.querySelector<HTMLInputElement>('[name=grape]');if(grape){grape.disabled=sake;grape.closest('label')!.hidden=sake;}
  const region=form.querySelector<HTMLInputElement>('[name=region]');if(region){const label=region.closest('label');if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=sake?'Prefecture / region':'Region';if(sake)region.setAttribute('list','sake-prefectures');else region.removeAttribute('list');}
 };
 color.addEventListener('change',sync);sync();
}
export function sakeSummary(metadata:any){return [metadata?.sake_classification,metadata?.sake_style,metadata?.rice_variety].filter(Boolean).join(' · ');}
/** Administrative suffixes do not change a Japanese prefecture's identity. */
export const prefectureKey=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(',')[0].replace(/\b(prefecture|pref|ken|fu|to)\b/g,'').replace(/[^a-z0-9]/g,'');
