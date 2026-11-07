import { TASTE_QUESTIONS, tasteProfileMessage } from './taste-profile';
import { intelligence, getLocale, esc } from './client';
import { bottleImageUrl } from '../bottle-assets';
import { lookupWineById } from '../identity';
export interface SommelierMessage {role:'user'|'assistant';content:string}
/** Keep actual recommendations in context so 'the second one, less oaky' is meaningful. */
export function sommelierReplyMemory(reply:any){return [String(reply.message||'').slice(0,400),...(reply.matches||[]).map((match:any)=>`${lookupWineById(match.wine_id)?.wine.name.slice(0,70)||''} [${match.wine_id}]: ${String(match.reason||'').slice(0,100)}. Tradeoff: ${String(match.tradeoff||'').slice(0,70)}`),String(reply.question||'').slice(0,200)].filter(Boolean).join('\n').slice(0,1600);}
export const askSommelier=(messages:SommelierMessage[])=>intelligence({action:'sommelier',messages,locale:getLocale()});
export function initSommelier(){
 const host=document.getElementById('wine-sommelier');if(!host)return;
 let messages:SommelierMessage[]=[],busy=false;
 host.innerHTML=`<header><p class="wl-kicker">FIND MY WINE</p><h2>What would feel right?</h2><p>A conversation about your taste, your food, and this moment.</p><button class="wl-outline" id="sommelier-profile" type="button">Build my taste profile · 8 questions</button></header><section id="sommelier-intake" hidden aria-label="Your taste profile"></section><div id="sommelier-conversation" aria-live="polite"><p class="intel-bubble">Tell me about the occasion, something you’re eating, or a wine you already enjoy.</p></div><div id="sommelier-suggestions" class="intel-suggestions"><button type="button">Something fresh with seafood</button><button type="button">A smooth red, no drying tannins</button><button type="button">Help me try something different</button></div><form id="sommelier-form"><label class="sr-only" for="sommelier-input">Tell your sommelier</label><textarea id="sommelier-input" maxlength="1600" rows="2" placeholder="What do you like? What would you rather avoid?" required></textarea><button class="wl-primary" type="submit">Ask ↗</button></form><div class="intel-question-top"><p id="sommelier-status" role="status" class="wl-muted small">Uses GPT and the sommNI catalog. Prices and live stock aren’t available.</p><button class="wl-text-button" id="sommelier-reset">Start over</button></div>`;
 const conversation=host.querySelector<HTMLElement>('#sommelier-conversation')!,suggestions=host.querySelector<HTMLElement>('#sommelier-suggestions')!,input=host.querySelector<HTMLTextAreaElement>('#sommelier-input')!,form=host.querySelector<HTMLFormElement>('#sommelier-form')!,status=host.querySelector<HTMLElement>('#sommelier-status')!;
 const intake=host.querySelector<HTMLElement>('#sommelier-intake')!;let step=0;const answers:Record<string,string>={};
 const renderIntake=()=>{
  const q=TASTE_QUESTIONS[step];intake.hidden=false;
  intake.innerHTML=`<div class="taste-progress"><span>TASTE PROFILE · ${step+1} / ${TASTE_QUESTIONS.length}</span><button type="button" class="wl-text-button" data-close-intake>Close</button></div><h3>${esc(q.title)}</h3><p class="taste-why">${esc(q.why)}</p><div class="intel-suggestions">${q.options.map(option=>`<button type="button" data-taste-option>${esc(option)}</button>`).join('')}</div><label for="taste-answer">Your answer, in your own words</label><textarea id="taste-answer" maxlength="160" rows="2" placeholder="${esc(q.placeholder)}">${esc(answers[q.key]||'')}</textarea><div class="taste-actions"><button type="button" class="wl-text-button" data-taste-back ${step===0?'disabled':''}>← Back</button><button type="button" class="wl-text-button" data-taste-skip>Not sure yet</button><button type="button" class="wl-primary" data-taste-next>${step===TASTE_QUESTIONS.length-1?'Find my wine ↗':'Next →'}</button></div>`;
  const answer=intake.querySelector<HTMLTextAreaElement>('textarea')!;
  intake.querySelectorAll<HTMLButtonElement>('[data-taste-option]').forEach(b=>b.onclick=()=>{answer.value=b.textContent||'';answer.focus();});
  intake.querySelector<HTMLButtonElement>('[data-close-intake]')!.onclick=()=>{answers[q.key]=answer.value.trim();intake.hidden=true;};
  intake.querySelector<HTMLButtonElement>('[data-taste-back]')!.onclick=()=>{answers[q.key]=answer.value.trim();step--;renderIntake();};
  const next=(skip=false)=>{answers[q.key]=skip?'Not sure':answer.value.trim()||'Not sure';if(step<TASTE_QUESTIONS.length-1){step++;renderIntake();}else{input.value=tasteProfileMessage(answers);intake.hidden=true;form.requestSubmit();}};
  intake.querySelector<HTMLButtonElement>('[data-taste-next]')!.onclick=()=>next();intake.querySelector<HTMLButtonElement>('[data-taste-skip]')!.onclick=()=>next(true);
 };
 host.querySelector<HTMLButtonElement>('#sommelier-profile')!.onclick=()=>{if(!busy)renderIntake();};
 suggestions.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest('button');if(b){input.value=b.textContent||'';form.requestSubmit();}});
 host.querySelector('#sommelier-reset')!.addEventListener('click',()=>{if(busy)return;messages=[];step=0;Object.keys(answers).forEach(k=>delete answers[k]);intake.hidden=true;conversation.innerHTML='<p class="intel-bubble">What are you in the mood for today?</p>';suggestions.innerHTML='';input.value='';status.textContent='A fresh conversation.';});
 form.onsubmit=async event=>{event.preventDefault();const value=input.value.trim();if(!value||busy)return;if(messages.length>=22){status.textContent='Start a new conversation to explore another moment.';return;}
  busy=true;form.querySelector('button')!.disabled=true;suggestions.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Thinking about your taste…';
  const pending=[...messages,{role:'user' as const,content:value}];
  try{const result=await askSommelier(pending);messages=[...pending,{role:'assistant',content:sommelierReplyMemory(result)}];input.value='';
   conversation.insertAdjacentHTML('beforeend',`<p class="intel-bubble guest">${esc(value)}</p><div class="intel-bubble">${String(result.message).split(/\n\s*\n/).map(p=>`<p>${esc(p)}</p>`).join('')}${result.matches.map((m:any)=>{const wine=lookupWineById(m.wine_id);return wine?`<article class="intel-match">${wine.legacyId?`<button class="intel-match-bottle" data-wine-notes="${esc(wine.id)}" aria-label="View ${esc(wine.wine.name)}"><img src="${esc(bottleImageUrl(import.meta.env.BASE_URL,wine.legacyId))}" alt="Catalog bottle photograph; vintage may differ" loading="lazy"></button>`:''}<button class="wl-text-button" data-wine-notes="${esc(wine.id)}">${esc(wine.wine.name)} ↗</button><p>${esc(m.reason)}</p><small>${esc(m.tradeoff)}</small></article>`:'';}).join('')}${result.question?`<p><strong>${esc(result.question)}</strong></p>`:''}</div>`);
   suggestions.innerHTML=result.suggestions.map((s:string)=>`<button type="button">${esc(s)}</button>`).join('');status.textContent='Tell me what feels close—or what you’d change.';
  }catch(error){status.textContent=(error as Error).message;}finally{busy=false;form.querySelector('button')!.disabled=false;suggestions.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
}
