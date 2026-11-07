import './setup-guide.css';
import { guidePlacement } from './guide-placement';
const KEY='sommni-setup-guide-v1';
export const SETUP_STEPS=[
 {target:'#wl-account',title:'Your wines, with you.',body:'Tap Link account to get a pairing code. On the D3 site, choose Google or create an email account. Return to Even to finish linking. You can also explore on this device first.',action:'Link account',next:'Explore first'},
 {target:'#orbit-country-wheel',fallback:'#orbit-country',title:'Pick a place.',body:'Roll to a country and confirm, then narrow it to a region. Drag the globe to look around; Spin / Pause lets you set the pace.',action:'Choose a country',next:'Try the bottles'},
 {target:'#orbit-bottle',fallback:'#dot-explorer',title:'Flick through the bottles.',body:'Swipe the large bottle left or right to change wines. Tap it for tasting notes and food pairings. Drag the uncovered globe to turn the map.',next:'Add my first wine'},
 {target:'#tab-home [data-wl-add]',title:'Make it your Winebrary.',body:'Start with a name or label photo. Review the details, compare up to three bottle photos, and save your choice. On G2: Winebrary → Add Wine by Voice lets you speak the name.',action:'Add a wine',next:'Finish guide'},
] as const;
export function readGuideState(raw:string|null):{step:number;done:boolean}|null{try{const s=JSON.parse(raw||'null');return s&&Number.isInteger(s.step)&&s.step>=0&&s.step<SETUP_STEPS.length&&typeof s.done==='boolean'?s:null;}catch{return null;}}
export function initSetupGuide(isAccountLinked:()=>boolean=()=>false){
 if(document.getElementById('sommni-setup-guide'))return;
 let stored:ReturnType<typeof readGuideState>=null;try{stored=readGuideState(localStorage.getItem(KEY));}catch{}
 let step=stored?.step??0,active=false,intro=false,target:HTMLElement|null=null,frame=0,priorFocus:HTMLElement|null=null;
 const card=document.createElement('section');card.id='sommni-setup-guide';card.hidden=true;card.setAttribute('role','region');card.setAttribute('aria-label','Guided setup');
 const halo=document.createElement('div');halo.className='setup-halo';halo.hidden=true;halo.setAttribute('aria-hidden','true');
 const orb=document.createElement('div');orb.className='setup-orb';orb.hidden=true;orb.setAttribute('aria-hidden','true');
 document.body.append(halo,orb,card);
 const persist=(done=false)=>{stored={step,done};try{localStorage.setItem(KEY,JSON.stringify(stored));}catch{}};
 function detach(){if(!target)return;resizeObserver?.unobserve(target);target.classList.remove('setup-target');const ids=(target.getAttribute('aria-describedby')||'').split(' ').filter(x=>x&&x!=='setup-description');if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');target=null;}
 function close(done=false){active=false;persist(done);card.hidden=halo.hidden=orb.hidden=true;detach();priorFocus?.focus({preventScroll:true});}
 function home(){document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();}
 function find(){const s=SETUP_STEPS[step];return intro?document.querySelector<HTMLElement>('#tab-home [data-setup-guide]'):document.querySelector<HTMLElement>(s.target+':not([hidden])')||('fallback' in s?document.querySelector<HTMLElement>(s.fallback):null);}
 function position(){
  frame=0;if(!active)return;
  // Native modal dialogs own the top layer; let account/photo/notes work normally.
  const modal=document.querySelector('dialog[open]:not(.atlas-inline)');
  card.hidden=!!modal;halo.hidden=orb.hidden=!!modal;if(modal){detach();return;}
  const next=find();if(next!==target){detach();target=next;if(target){resizeObserver?.observe(target);target.classList.add('setup-target');target.setAttribute('aria-describedby',((target.getAttribute('aria-describedby')||'')+' setup-description').trim());}}
  const viewport=window.visualViewport,viewLeft=viewport?.offsetLeft??0,viewTop=viewport?.offsetTop??0,vw=viewport?.width??innerWidth,vh=viewport?.height??innerHeight;
  const nav=document.querySelector<HTMLElement>('.tab-bar'),navRect=nav?.getBoundingClientRect();
  const navTop=nav&&navRect&&getComputedStyle(nav).position==='fixed'&&navRect.top>viewTop&&navRect.bottom>=viewTop+vh-1?navRect.top:viewTop+vh;
  const view={left:viewLeft,top:viewTop,width:vw,height:Math.min(vh,navTop-viewTop)};
  // Measure after setting width, so wrapped text and larger accessibility fonts fit.
  card.style.width=Math.min(310,Math.max(1,vw-24))+'px';
  const r=target?.getBoundingClientRect();
  const placement=guidePlacement(view,intro?null:r??null,Math.max(card.scrollHeight,card.offsetHeight)||230);
  Object.assign(card.style,{width:placement.width+'px',maxHeight:placement.maxHeight+'px',left:placement.left+'px',top:placement.top+'px',bottom:''});
  if(!r){halo.hidden=orb.hidden=true;return;}
  const visible=r.bottom>viewTop&&r.top<viewTop+vh&&r.right>viewLeft&&r.left<viewLeft+vw;
  halo.hidden=orb.hidden=!visible;
  Object.assign(halo.style,{left:r.left-6+'px',top:r.top-6+'px',width:r.width+12+'px',height:r.height+12+'px'});
  Object.assign(orb.style,{left:Math.min(viewLeft+vw-20,Math.max(viewLeft+20,r.right-10))+'px',top:Math.min(viewTop+vh-20,Math.max(viewTop+20,r.top+12))+'px'});
 }
 const schedule=()=>{if(active&&!frame)frame=requestAnimationFrame(position);};
 const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
 resizeObserver?.observe(card);
 const content=document.getElementById('main-content');if(content)resizeObserver?.observe(content);
 function reveal(){home();const el=find();el?.scrollIntoView({block:'center',behavior:'auto'});schedule();}
 function render(focus=true){
  const s=SETUP_STEPS[step],linked=step===0&&isAccountLinked();card.hidden=false;
  card.scrollTop=0;
  card.innerHTML=`<button type="button" class="setup-close" aria-label="Dismiss guide">×</button><p class="setup-eyebrow">${intro?'A QUICK FIRST LAP':`GUIDED SETUP · ${step+1} / ${SETUP_STEPS.length}`}</p><h2>${intro?'Find your way around.':linked?'You’re already linked.':s.title}</h2><p id="setup-description">${intro?'Follow the soft gold signal to link your account, explore a place, and choose a bottle. A short practice run; you can skip any step.':linked?'Your account is connected. Continue to explore the Atlas and your bottles; there’s no need to pair again.':s.body}</p><div class="setup-actions balanced-actions">${intro?'<button type="button" data-guide-start>Show me around</button><button type="button" data-guide-dismiss>Skip for now</button>':`${'action' in s&&!linked?`<button type="button" data-guide-action>${s.action} ↗</button>`:''}<button type="button" data-guide-back>← Back</button><button type="button" data-guide-next>${step===SETUP_STEPS.length-1?'Finish guide':'Next step →'}</button>`}</div>${intro?'':'<button type="button" class="setup-skip" data-guide-dismiss>Skip guide</button>'}`;
  card.querySelector('.setup-close')!.addEventListener('click',()=>close());card.querySelector('[data-guide-dismiss]')?.addEventListener('click',()=>close());
  card.querySelector('[data-guide-start]')?.addEventListener('click',()=>{intro=false;render();reveal();});
  card.querySelector('[data-guide-next]')?.addEventListener('click',()=>{if(step===SETUP_STEPS.length-1){close(true);return;}step++;persist();render();reveal();});
  card.querySelector('[data-guide-back]')?.addEventListener('click',()=>{if(step===0)intro=true;else step--;persist();render();reveal();});
  card.querySelector('[data-guide-action]')?.addEventListener('click',()=>{
   const el=find();if(!el)return;
   if(step===1){el.focus();if(el instanceof HTMLSelectElement){if(typeof el.showPicker==='function'){try{el.showPicker();}catch{}}}else el.click();return;}
   if(step===3){close(true);el.click();return;}
   el.click();schedule();
  });
  if(focus)card.querySelector<HTMLButtonElement>('[data-guide-start], [data-guide-next]')?.focus({preventScroll:true});schedule();
 }
 function start(welcome=false){priorFocus=document.activeElement as HTMLElement;active=true;intro=welcome;step=0;render();reveal();}
 document.querySelectorAll('[data-setup-guide]').forEach(b=>b.addEventListener('click',()=>start()));
 document.addEventListener('keydown',e=>{if(active&&e.key==='Escape'&&!document.querySelector('dialog[open]:not(.atlas-inline)')){e.preventDefault();close();}});
 document.addEventListener('change',e=>{if(active&&!intro&&step===1&&(e.target as HTMLElement)?.id==='orbit-country'){step=2;persist();render();reveal();}});
 window.addEventListener('winelens-library-changed',()=>{if(active&&!intro&&step===0){render(false);schedule();}});
 window.addEventListener('sommni-account-linked',()=>{if(active&&!intro&&step===0){step=1;persist();render();reveal();}});
 document.addEventListener('click',e=>{if(active&&(e.target as HTMLElement).closest('.tab:not([data-tab="home"])'))close();});
 addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
 if(!stored&&(!location.hash||location.hash==='#home'))start(true);
}
