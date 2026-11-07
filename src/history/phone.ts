import { getLocale, translateTexts } from '../intelligence/client';
import { wineHistoryCards, storyParagraphs, storyWines, STORY_SOURCES } from './content';
import { buildStoryPage, historyStatus, openHistoryOnGlasses } from './glasses';
import './phone.css';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function initHistoryPanel(host:HTMLElement,initialWineId:string) {
  let wineId=initialWineId,index=0,revision=0;
  host.className='wine-history';
  host.innerHTML=`<div class="history-heading"><div><p class="wl-kicker">PEOPLE / PLACE / ORIGINS</p><h2>Behind the wine.</h2><p id="history-wine"></p></div><p>The people who made it. The place that shaped it. Sourced stories, with room to read.</p></div>
    <div class="history-layout"><nav id="history-timeline" aria-label="Jump to a chapter"></nav><article id="history-detail"></article></div>
    <div class="history-glasses"><div><p class="wl-kicker">TAKE THE STORY WITH YOU</p><h3>Scroll at your pace.</h3><p>Each chapter reads continuously on G2. Double tap returns to its chapter list.</p><button type="button" id="history-send" class="wl-primary" disabled>Read on glasses ↗</button><p id="history-status" role="status" class="depth-caption"></p></div><div><canvas id="history-hud" width="576" height="288" aria-label="Beginning of the selected glasses chapter"></canvas><p class="depth-caption">Preview of the opening lines. Device font approximated. Scroll to read; double tap to go back.</p></div></div>`;
  const get=<T extends HTMLElement>(id:string)=>host.querySelector<T>(`#${id}`)!;
  function status() { const state=historyStatus();get<HTMLButtonElement>('history-send').disabled=!state.ready||state.busy;get('history-status').textContent=state.message; }
  function preview() {
    const cards=wineHistoryCards(wineId),card=cards[index];if(!card)return;
    const canvas=get<HTMLCanvasElement>('history-hud'),ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#07150e';ctx.fillRect(0,0,576,288);ctx.fillStyle='#a9fca0';ctx.font='18px Arial';ctx.textBaseline='top';
    for(const box of buildStoryPage(card,'time',index,cards.length).textObject??[]) {
      ctx.save();ctx.beginPath();ctx.rect(box.xPosition!,box.yPosition!,box.width!,box.height!);ctx.clip();let y=box.yPosition!;
      for(const line of (box.content??'').split('\n')) {
        let run='';for(const word of line.split(' ')){const next=run?`${run} ${word}`:word;if(ctx.measureText(next).width>box.width!&&run){ctx.fillText(run,box.xPosition!,y);y+=27;run=word;}else run=next;}
        ctx.fillText(run,box.xPosition!,y);y+=27;
      }ctx.restore();
    }
    host.querySelectorAll('[data-story-index]').forEach((b,i)=>b.setAttribute('aria-current',i===index?'location':'false'));
    get('history-send').textContent='Read on glasses: '+card.title+' ↗';
  }
  function render() {
    const token=++revision,cards=wineHistoryCards(wineId),wine=storyWines().find(w=>w.id===wineId||w.legacyId===wineId);
    get('history-wine').textContent=wine?.wine.name??'';
    get('history-timeline').innerHTML=cards.map((c,i)=>`<button type="button" data-story-index="${i}"><span>${escape(c.date==='The wine in context'?c.scope:c.date)}</span><strong>${escape(c.title)}</strong></button>`).join('');
    get('history-detail').innerHTML=cards.map((card,i)=>{const source=STORY_SOURCES[card.source];return `<section class="history-chapter" id="wine-chapter-${i}"><p class="wl-kicker">${escape(card.scope)}</p>${card.date!=='The wine in context'?`<p class="history-date">${escape(card.date)}</p>`:''}<h3>${escape(card.title)}</h3>${storyParagraphs(card).map((p,n)=>`<p${n===0?' class="history-cue"':''}>${escape(p)}</p>`).join('')}${card.practice?`<aside class="history-recall"><span class="wl-kicker">A CONVERSATION STARTER</span><p>${escape(card.practice)}</p></aside>`:''}</section>`;}).join('');
    preview();status();
    if(getLocale()!=='en'){
      const nodes=[...get('history-detail').querySelectorAll<HTMLElement>('h3,p')];
      const note=document.createElement('p');note.className='translation-status';note.setAttribute('role','status');note.textContent='Translating stories…';get('history-detail').prepend(note);
      void translateTexts(nodes.map(n=>n.textContent??'')).then(texts=>{if(token!==revision)return;nodes.forEach((n,i)=>n.textContent=texts[i]);note.textContent='Translated from the cited stories.';}).catch(error=>{if(token===revision)note.textContent=error.message+' Showing original English.';});
    }
  }
  host.addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-story-index]');if(!target)return;index=Number(target.dataset.storyIndex);preview();get('wine-chapter-'+index).scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
  get('history-send').addEventListener('click',()=>void openHistoryOnGlasses(wineId,'time',index));
  window.addEventListener('winelens-history-status',status);window.addEventListener('winelens-language',render);
  window.addEventListener('winelens-reading-status',event=>{get('history-status').textContent=(event as CustomEvent<string>).detail;});
  render();return {setWine(id:string){if(id!==wineId){wineId=id;index=0;render();}}};
}
