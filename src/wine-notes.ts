import {foodPairingsHtml} from './food-pairings';
import { bottleRowHead, bottleRowCells } from './bottle-rows';
import { catalogContext, watchWinePhotos } from './wine-context';
import { mountWineCommunity } from './community/initiative-ui';
import { account } from './account-client';
import { showAccountPairing } from './account-pairing';
import { getCatalogAnecdote, anecdoteSourcesHtml } from './catalog-anecdotes';
import { translateTexts, getLocale } from './intelligence/client';
import { wineHistoryCards, storyParagraphs, textParagraphs, STORY_SOURCES } from './history/content';
import { mountReadingDocument, openReadingRoom } from './reading/phone';
import { catalogPhoto, allCatalogWines, lookupWineById } from './identity';
import { wineReferences } from './study/content';
import './wine-notes.css';
const esc=(x:unknown)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let dialog:HTMLDialogElement;
let disposeCommunity:(()=>void)|undefined;
function shell(){
 disposeCommunity?.();
 if(!dialog){dialog=document.createElement('dialog');dialog.id='wine-notes-dialog';dialog.setAttribute('aria-label','Wine tasting notes');document.body.append(dialog);}
 dialog.innerHTML='<div class="notes-top"><p class="wl-kicker">SOMMNI / TASTING NOTES</p><button class="wl-outline" data-notes-close aria-label="Close tasting notes">×</button></div><div id="notes-body"></div>';
 dialog.querySelector('[data-notes-close]')!.addEventListener('click',()=>dialog.close());
 if(!dialog.open)dialog.showModal();return dialog.querySelector<HTMLElement>('#notes-body')!;
}
export function openWineNotes(id:string){
 const entry=lookupWineById(id);if(!entry)return;const w=entry.wine,host=shell(),refs=wineReferences(entry.id),anecdote=getCatalogAnecdote(entry.id);
 let fields=[['Appearance',w.appearance],['Aroma',w.nose],['Palate',w.palate],['Finish',w.finish],[anecdote?'Behind the wine · '+anecdote.title:'Behind the wine',textParagraphs(w.anecdote).join('\n\n')]];
 host.innerHTML=`<div class="notes-heading">${catalogPhoto(entry.id)?`<button type="button" class="notes-bottle-open" aria-label="Enlarge bottle photograph"><img src="${esc(catalogPhoto(entry.id,new URL('./',location.href).href))}" alt="Catalogue bottle photograph; vintage may differ"><span>View label +</span></button>`:''}<div><p class="wl-kicker">${esc(entry.type)} · ${esc(entry.country)}</p><h2>${esc(w.name)}</h2><p>${esc(w.region)}</p><p>${esc(w.grape)} · ${esc(w.style)}</p><p class="depth-caption">${entry.community?'Community supplied reference notes · verify details for your vintage.':'Catalogue tasting notes. Exact vintage unconfirmed; these are reference descriptions, not your personal observations.'}</p></div></div>${foodPairingsHtml({grape:w.grape,style:w.style,color:entry.type})}<div class="notes-sections">${fields.map(([label,body])=>`<section><h3>${label}</h3><p>${esc(body||'No description recorded yet.')}</p></section>`).join('')}</div>${anecdote?anecdoteSourcesHtml(anecdote):''}<div class="notes-actions"><button class="wl-primary" data-save-library="${esc(entry.id)}">Save to Winebrary</button><button class="wl-outline" id="notes-download">Download notes ↓</button><button class="wl-text-button" data-browse-notes>Browse all wines</button></div>`;
 const community=document.createElement('section');host.append(community);const [wineName,...producer]=w.name.split(/ – | — /);disposeCommunity=mountWineCommunity(community,account,{ref:entry.id,name:wineName,producer:producer.join(' – ')},()=>{dialog.close();void showAccountPairing()});dialog.addEventListener('close',()=>disposeCommunity?.(),{once:true});
 mountReadingDocument(host.querySelector('.notes-sections')!,{title:w.name,sections:fields.map(([label,text])=>({label,text:text||''}))});
 if(getLocale()!=='en'){
  const status=document.createElement('p');status.className='translation-status';status.setAttribute('role','status');status.textContent='Translating notes…';host.querySelector('.notes-heading')!.after(status);
  void translateTexts(fields.flat()).then(texts=>{if(!status.isConnected||!dialog.open)return;fields=fields.map((_,i)=>[texts[i*2],texts[i*2+1]]);mountReadingDocument(host.querySelector('.notes-sections')!,{title:w.name,sections:fields.map(([label,text])=>({label,text}))});status.textContent='Translated from catalog reference notes.';}).catch(error=>{if(status.isConnected)status.textContent=error.message+' Showing original English.';});
 }

 if(wineHistoryCards(entry.id).length){const button=document.createElement('button');button.type='button';button.className='wl-outline notes-story-link';button.textContent='Explore regional & estate history ↗';button.onclick=()=>openReadingRoom({title:w.name+' · Behind the wine',sections:wineHistoryCards(entry.id).map(c=>({label:c.title,context:c.scope,text:storyParagraphs(c).join('\n\n'),source:{title:STORY_SOURCES[c.source].publisher,url:STORY_SOURCES[c.source].url}}))});host.querySelector('.notes-sections')!.after(button);}
 host.querySelector('.notes-bottle-open')?.addEventListener('click',()=>{
  const photo=host.querySelector<HTMLImageElement>('.notes-bottle-open img')!;
  const zoom=document.createElement('dialog');zoom.className='notes-bottle-zoom';zoom.setAttribute('aria-label',w.name+' bottle detail');
  zoom.innerHTML=`<button type="button" class="wl-outline" autofocus>Close bottle detail</button><h2>${esc(w.name)}</h2><img src="${esc(photo.src)}" alt="${esc(w.name)} — representative photograph"><p>Representative catalogue bottle. The photographed vintage may differ from yours.</p>`;
  document.body.append(zoom);zoom.showModal();zoom.querySelector('button')!.onclick=()=>zoom.close();zoom.addEventListener('close',()=>zoom.remove(),{once:true});
 });
 host.querySelector('[data-save-library]')!.addEventListener('click',()=>dialog.close());
 host.querySelector('#notes-download')!.addEventListener('click',()=>{const content=[w.name,w.region,`${w.grape} · ${w.style}`,'Catalogue reference notes; exact vintage unconfirmed.','',...fields.flatMap(([label,body])=>[label,body,''])].join('\n');const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=w.name.replace(/[^a-z0-9 -]/gi,'').slice(0,70)+'-tasting-notes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
}
export function openNotesLibrary(query=''){
 const host=shell();host.innerHTML='<h2>Every wine. The full notes.</h2><label class="notes-search">Find a wine<input type="search" id="notes-search" placeholder="Wine, grape, country or region…"></label><p id="notes-count" role="status"></p><div id="notes-results"></div>';
 const search=host.querySelector<HTMLInputElement>('#notes-search')!;
 search.value=query;
 const render=()=>{const q=search.value.trim().toLocaleLowerCase();const wines=allCatalogWines().filter(w=>[w.wine.name,w.wine.grape,w.wine.region,w.country].join(' ').toLocaleLowerCase().includes(q));host.querySelector('#notes-count')!.textContent=`${wines.length} catalogue wines`;host.querySelector('#notes-results')!.innerHTML=wines.length?`<div class="bottle-row-list">${bottleRowHead(wines.every(w=>w.type==='Sake'),wines.some(w=>w.type==='Sake'))}${wines.map(w=>`<button class="notes-result bottle-row-summary" data-wine-notes="${esc(w.id)}">${bottleRowCells({name:w.wine.name,photo:catalogContext(w).photo,vintage:w.vintages?.join(', '),country:w.country,region:w.wine.region,variety:w.wine.grape,style:w.type==='Sake'?w.wine.style:w.type,sake:w.type==='Sake'})}</button>`).join('')}</div>`:'<p>No matching wine. Try another name, grape or region.</p>';watchWinePhotos(host);};search.addEventListener('input',render);render();search.focus();
}
export function initWineNotes(){
 document.querySelector('#wine-search-form')?.addEventListener('submit',event=>{event.preventDefault();openNotesLibrary((document.querySelector('#wine-search-input') as HTMLInputElement).value);});
 document.addEventListener('click',event=>{const element=(event.target as HTMLElement).closest<HTMLElement>('[data-wine-notes],[data-browse-notes]');if(!element)return;if(element.hasAttribute('data-browse-notes'))openNotesLibrary();else openWineNotes(element.dataset.wineNotes!);});}
