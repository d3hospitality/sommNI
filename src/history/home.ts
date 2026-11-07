import { initHistoryPanel } from './phone';
import { storyWines } from './content';
export function initHistoryHome(){
 const host=document.getElementById('history-home'),wines=storyWines();if(!host||!wines.length)return;
 host.innerHTML=`<div class="wl-page-heading"><div><p class="wl-kicker">SOMMNI / PEOPLE · PLACE · ORIGINS</p><h1>Wine History</h1><p class="wl-muted">Follow the people and places behind a bottle. Nothing here needs unlocking.</p></div></div><div class="history-entry-grid"><label>Start with a wine<select id="history-wine-picker" aria-label="Choose a wine for history"></select></label><div><strong>Start with a place</strong><p>Countries, regions and the stories behind them — including places you haven’t collected yet.</p><button class="wl-outline" id="history-explore-places">Explore country & region history ↗</button></div></div><section id="wine-history" aria-label="Wine history chapters"></section>`;
 const picker=host.querySelector<HTMLSelectElement>('#history-wine-picker')!;
 for(const wine of wines){const option=document.createElement('option');option.value=wine.id;option.textContent=wine.wine.name+' · '+wine.wine.region;picker.append(option);}
 const panel=initHistoryPanel(host.querySelector<HTMLElement>('#wine-history')!,wines[0].id);
 picker.addEventListener('change',()=>panel.setWine(picker.value));
 host.querySelector('#history-explore-places')!.addEventListener('click',()=>window.dispatchEvent(new Event('winelens-open-browser-atlas')));
}
