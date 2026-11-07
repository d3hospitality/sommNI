const PRIMARY=new Set(['home','cellar','winebrary']);

/** Mobile navigation delegates to the existing routes; account and glasses state stay owned there. */
export function initPhoneShell(){
 const nav=document.querySelector<HTMLElement>('.tab-bar');if(!nav||document.getElementById('phone-more'))return;
 const mobile=matchMedia('(max-width:760px)');
 const status=document.querySelector<HTMLElement>('.wl-sidebar .status-bar'),header=document.querySelector<HTMLElement>('.header'),statusHome=document.createComment('glasses status');status?.before(statusHome);
 const more=document.createElement('button');more.id='phone-more';more.type='button';more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-expanded','false');more.innerHTML='<span aria-hidden="true" class="phone-more-icon">···</span><span>More</span>';
 nav.append(more);
 const sheet=document.createElement('dialog');sheet.id='phone-more-sheet';sheet.setAttribute('aria-labelledby','phone-more-title');
 sheet.innerHTML='<header><h2 id="phone-more-title">More to explore</h2><button type="button" aria-label="Close navigation">×</button></header><div class="phone-more-routes"></div>';
 const routes=sheet.querySelector<HTMLElement>('.phone-more-routes')!;
 const tabs=[...nav.querySelectorAll<HTMLButtonElement>('.tab')];
 for(const tab of tabs.filter(tab=>!PRIMARY.has(tab.dataset.tab!))){
  const button=document.createElement('button');button.type='button';button.dataset.route=tab.dataset.tab;button.innerHTML=tab.innerHTML;
  button.addEventListener('click',()=>{sheet.close();tab.click();document.getElementById('main-content')?.focus({preventScroll:true});});routes.append(button);
 }
 document.body.append(sheet);document.body.classList.add('phone-shell-ready');
 function sync(){
  const active=tabs.find(tab=>tab.classList.contains('active'))?.dataset.tab||'home',secondary=!PRIMARY.has(active);
  more.classList.toggle('active',secondary);if(secondary)more.setAttribute('aria-current','page');else more.removeAttribute('aria-current');
  more.setAttribute('aria-label',secondary?`More · ${tabs.find(t=>t.dataset.tab===active)?.textContent?.trim()}`:'More');
  routes.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if(b.dataset.route===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 }
 function resize(){if(status&&header){if(mobile.matches)header.prepend(status);else statusHome.after(status);}more.hidden=!mobile.matches;if(!mobile.matches&&sheet.open)sheet.close();sync();}
 more.addEventListener('click',()=>{sync();sheet.showModal();more.setAttribute('aria-expanded','true');});
 sheet.querySelector('header button')!.addEventListener('click',()=>sheet.close());
 sheet.addEventListener('close',()=>more.setAttribute('aria-expanded','false'));
 // Arrow navigation follows only visible primary buttons, including More.
 nav.addEventListener('keydown',event=>{
  if(!mobile.matches)return;
  const visible=[...tabs.filter(t=>PRIMARY.has(t.dataset.tab!)),more],index=visible.indexOf(event.target as HTMLButtonElement);
  if(index<0)return;
  const next=event.key==='ArrowRight'||event.key==='ArrowDown'?(index+1)%visible.length:event.key==='ArrowLeft'||event.key==='ArrowUp'?(index+visible.length-1)%visible.length:event.key==='Home'?0:event.key==='End'?visible.length-1:null;
  if(next===null)return;event.preventDefault();event.stopImmediatePropagation();visible[next].focus();
 },true);
 window.addEventListener('sommni-tab-changed',sync);mobile.addEventListener('change',resize);resize();
}
