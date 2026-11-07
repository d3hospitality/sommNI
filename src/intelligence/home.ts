import {revealHomeTask} from '../home-task';
import { loadLocale,saved,getLocale,setLocale,LANGUAGES,esc } from './client';
import { initDaily } from './daily';
import { initCommunity } from './community';
import { initSommelier } from './sommelier';
import { configureHomeMotion, centerHomeGlass } from '../image-utils';
import { paintHomeWordmark } from './home-identity';
import './intelligence.css';
export async function initIntelligence(){
 await loadLocale();initDaily();initCommunity();initSommelier();
 window.addEventListener('sommni-motion-status',event=>{const el=document.querySelector('#home-motion-status');if(el)el.textContent=(event as CustomEvent<string>).detail;});
 document.querySelector('#home-motion-center')?.addEventListener('click',centerHomeGlass);
 const motionEnabled=await saved.get('home-motion',true);configureHomeMotion(motionEnabled);
 const motion=document.querySelector<HTMLInputElement>('#glasses-home-motion');if(motion){motion.checked=motionEnabled;motion.onchange=async()=>{configureHomeMotion(motion.checked);try{await saved.set('home-motion',motion.checked);}catch{document.querySelector('#home-motion-status')!.textContent='Changed for this session; saving failed.';}};}
 matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>configureHomeMotion(motion?.checked??motionEnabled));
 const canvas=document.querySelector<HTMLCanvasElement>('#home-logo');if(canvas)paintHomeWordmark(canvas);
 const settings=document.getElementById('language-settings');if(settings){settings.innerHTML=`<label for="notes-language">Notes & learning language</label><select id="notes-language">${Object.entries(LANGUAGES).map(([code,label])=>`<option value="${code}" ${code===getLocale()?'selected':''}>${label}</option>`).join('')}</select><p class="wl-muted small">Tasting notes, wine history, daily questions and your sommelier use this language. Translations are saved for reuse. Names and vintages stay intact. Navigation labels remain in English. Online translations send displayed notes to our server and OpenAI; original notes are preserved.</p><p role="status" id="language-status"></p>`;settings.querySelector<HTMLSelectElement>('select')!.onchange=async event=>{try{await setLocale((event.target as HTMLSelectElement).value as keyof typeof LANGUAGES);settings.querySelector('#language-status')!.textContent='Saved. Open notes to use '+LANGUAGES[getLocale()]+'.';}catch(error){settings.querySelector('#language-status')!.textContent=(error as Error).message;}};}
 document.querySelectorAll('[data-open-sommelier]').forEach(b=>b.addEventListener('click',()=>{revealHomeTask(document.getElementById('wine-sommelier'));document.getElementById('wine-sommelier')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});document.getElementById('sommelier-input')?.focus({preventScroll:true});}));
}
