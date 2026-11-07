import { prefectureKey } from '../sake';
import { PLACE_STORIES, SAKE_PLACE_STORIES } from '../history/place-stories';
import { historyStatus, openHistoryOnGlasses } from '../history/glasses';
import { allCatalogWines, type CatalogWine } from '../identity';
import { storyCards, STORY_SOURCES, type StoryCard } from '../history/content';
import { esc, translateTexts, getLocale } from '../intelligence/client';
const sameCountry=(a:string,b:string)=>a===b||(['USA','United States','United States of America'].includes(a)&&['USA','United States','United States of America'].includes(b));
export function placeInsights(country:string,wines:CatalogWine[]=allCatalogWines().filter(w=>sameCountry(w.country,country)),region:string|null=null):StoryCard[]{
 if(country==='Japan'){const regional=region&&prefectureKey(region)==='niigata'?SAKE_PLACE_STORIES.Niigata:[];return [...regional,...SAKE_PLACE_STORIES.Japan,...(!region?PLACE_STORIES.Japan:[])];}
 const cards=wines.flatMap(w=>storyCards(w.id,'region'));
 const unique=[...new Map(cards.map(c=>[c.source+'|'+c.title,c])).values()];
 if(unique.length)return unique;
 const countryCards=PLACE_STORIES[country]??[...new Map(allCatalogWines().filter(w=>sameCountry(w.country,country)).flatMap(w=>storyCards(w.id,'region')).map(c=>[c.source+'|'+c.title,c])).values()].slice(0,3);
 if(countryCards.length)return countryCards.map(c=>({...c,scope:region?country+' context · not a history of '+region:c.scope}));
 return [{id:'atlas-reading-'+country+'-'+(region??''),date:'Reading the atlas',title:region?region+' in context':'Exploring '+country,
 cue:region?region+' is a place to explore in '+country+'. A shaded area means there is no matched saved wine; it does not mean wine is absent.':'Your Winebrary is a personal record, not a survey of wine production in '+country+'.',
 detail:'Country and administrative boundaries help you locate a place. Winery groups mark recorded locations; they are not legal appellation borders. When you encounter a bottle, look for its producer, grape, vintage and more specific origin. Those details will help connect it to the atlas. A verified local history for this place has not been added yet.',source:'atlasReading',scope:'Map reading · local history not yet researched'}];
}
export async function openPlaceInsight(country:string,region:string|null,wines:CatalogWine[]){
 const cards=placeInsights(country,wines,region),dialog=document.createElement('dialog');dialog.className='intel-dialog';dialog.setAttribute('aria-label',(region||country)+' wine insights');
 dialog.innerHTML=`<button class="wl-text-button intel-close" aria-label="Close place insights">×</button><p class="wl-kicker">WINE ATLAS / ${esc(country)}</p><h2>${esc(region||country)}</h2><p>${wines.length} linked catalog wines · ${[...new Set(wines.map(w=>w.wine.grape))].length} grape / rice descriptions</p><p class="translation-status" role="status"></p><div class="place-content"></div><button type="button" class="wl-primary" id="place-to-g2">Read place history on glasses ↗</button><p id="place-g2-status" class="wl-muted" role="status"></p>`;document.body.append(dialog);dialog.showModal();dialog.querySelector('button')!.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 const send=dialog.querySelector<HTMLButtonElement>('#place-to-g2')!,status=dialog.querySelector<HTMLElement>('#place-g2-status')!;
 send.disabled=!historyStatus().ready;status.textContent=send.disabled?'Open in Even Hub with G2 connected to read here on your glasses.':'Scroll continuously on G2; double tap returns to Wine History.';
 send.onclick=async()=>{send.disabled=true;try{const {openPlaceGlasses}=await import('../intelligence/glasses');await openPlaceGlasses(country,region,wines,()=>openHistoryOnGlasses());status.textContent='Use the glasses to read; double tap returns to Wine History.';}catch(error){status.textContent=(error as Error).message;}finally{send.disabled=!historyStatus().ready;}};
 const render=(items:StoryCard[])=>{dialog.querySelector('.place-content')!.innerHTML=items.length?items.map(c=>`<article class="place-insight"><p class="wl-kicker">${esc(c.scope)}</p><h3>${esc(c.title)}</h3><p><strong>${esc(c.cue)}</strong></p><p>${esc(c.detail)}</p></article>`).join(''):'<p>We haven’t added sourced wine context for this place yet. Its administrative map boundary is still available.</p>';};render(cards);
 if(getLocale()!=='en'&&cards.length){const status=dialog.querySelector('.translation-status')!;status.textContent='Translating place insights…';try{const texts=await translateTexts(cards.flatMap(c=>[c.title,c.cue,c.detail,c.scope]));if(!dialog.open)return;render(cards.map((c,i)=>({...c,title:texts[i*4],cue:texts[i*4+1],detail:texts[i*4+2],scope:texts[i*4+3]})));status.textContent='Translated from the cited source notes.';}catch(e){status.textContent=(e as Error).message+' Showing the original English.';}}
}
