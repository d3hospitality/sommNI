import {photoChoices} from './photo-choices';
import { labelSession, labelProgress, subscribeLabels, startLabels } from './label-session';
import { openLabelGlasses } from './label-glasses';
import { canShowWine } from '../winebrary-glasses';
import { escape } from './client';
import type { LibraryWine } from '../winebrary';
import { highlightArrival } from './arrival';
import './label-review.css';

export function initLabelReview(anchor:HTMLElement){
 const panel=document.createElement('section');panel.className='label-review';panel.id='wl-label-review';panel.hidden=true;panel.setAttribute('aria-label','Bottle label review');anchor.before(panel);
 const nib=document.createElement('button');nib.type='button';nib.className='label-nib';nib.hidden=true;document.querySelector('#app')?.prepend(nib);
 nib.onclick=()=>{document.querySelector<HTMLButtonElement>('.tab[data-tab="winebrary"]')?.click();panel.scrollIntoView({block:'start',behavior:'smooth'});};
 let previousPhoto='';
 const render=()=>{
  const s=labelSession(),r=s?.current;panel.hidden=!r;nib.hidden=!r;if(!s||!r){previousPhoto='';return;}
  nib.textContent='Bottle labels · '+labelProgress();nib.setAttribute('aria-label','Open bottle label review: '+labelProgress());
  const focus=panel.contains(document.activeElement)?(document.activeElement as HTMLElement).id:null;
  const photo=r.preview||r.options[r.choice]?.photo;
  const processing=r.work==='polishing'||r.work==='saving',action=r.state==='error'?'Retry search':r.work==='saved'?'Saved · next wine':processing?'Polishing your label…':'Use this photo';
  panel.innerHTML=`<div class="label-review-heading"><div><p class="wl-kicker">YOUR BOTTLES · YOUR CHOICE</p><h3>Choose your bottle.</h3></div><button type="button" id="label-on-glasses" class="wl-outline" ${canShowWine()?'':'disabled'}>Review on glasses</button></div><p class="label-review-progress" role="status" aria-live="polite">${escape(labelProgress())}</p><progress max="${s.rows.length}" value="${s.settled}" aria-label="Wines searched"></progress><label>Wine<select id="label-wine">${s.rows.map((row,i)=>`<option value="${i}" ${i===s.index?'selected':''}>${i+1}. ${escape(row.wine.wine_name)} · ${row.wine.vintage||'Year unknown'}${row.work==='saved'?' · Saved':row.state==='searching'?' · Searching':''}</option>`).join('')}</select></label>${photoChoices(r.options,r.choice)}<div class="label-review-body" data-preview="${!!r.preview}"><div class="label-review-photo">${photo?`<img src="${escape(photo)}" alt="${escape(r.wine.wine_name)} label option ${r.choice+1}">`:'<span>Finding label photographs…</span>'}</div><div><h4>${escape(r.wine.wine_name)}</h4><p>${escape([r.wine.producer,r.wine.vintage,r.wine.region].filter(Boolean).join(' · '))}</p><p>Photo ${r.options.length?r.choice+1:0} of ${r.options.length} · Check the pictured vintage.</p><p role="status">${escape(r.message)}</p><p class="wl-muted small">We remove the background and keep the real label.</p><div class="label-review-actions balanced-actions balanced-actions--primary"><button id="label-use" class="wl-primary" ${s.busy||!['ready','error'].includes(r.state)?'disabled':''}>${action}</button><button id="label-search-again" class="wl-outline" ${processing?'disabled':''}>Search again</button><button id="label-next" class="wl-text-button">Next wine →</button></div></div></div>`;
  panel.querySelector<HTMLSelectElement>('#label-wine')!.onchange=e=>s.select(Number((e.target as HTMLSelectElement).value));
  panel.querySelector<HTMLButtonElement>('#label-use')!.onclick=()=>{if(r.state==='error')s.retry();else if(r.work==='saved')s.move(1);else void s.use();};
  panel.querySelectorAll<HTMLButtonElement>('[data-photo-option]').forEach(b=>{b.disabled=processing;b.onclick=()=>s.photo(Number(b.dataset.photoOption)-r.choice);});
  panel.querySelector<HTMLButtonElement>('#label-search-again')!.onclick=()=>s.retry();
  panel.querySelector<HTMLButtonElement>('#label-next')!.onclick=()=>s.move(1);
  panel.querySelector<HTMLButtonElement>('#label-on-glasses')!.onclick=()=>void openLabelGlasses().catch(e=>{panel.querySelector('.label-review-progress')!.textContent=e.message;});
  if(focus)panel.querySelector<HTMLElement>('#'+focus)?.focus({preventScroll:true});
  if(photo&&photo!==previousPhoto){highlightArrival(panel.querySelector('.label-review-photo')!);previousPhoto=photo;}
 };
 subscribeLabels(render);window.addEventListener('sommni-glasses-connection',render);render();
 window.addEventListener('sommni-polish-labels',event=>{
  try{const wines=(event as CustomEvent<{wines:LibraryWine[]}>).detail.wines;startLabels(wines);document.querySelector<HTMLButtonElement>('.tab[data-tab="winebrary"]')?.click();panel.scrollIntoView({block:'start'});}
  catch(e){panel.hidden=false;panel.textContent=(e as Error).message;}
 });
}
