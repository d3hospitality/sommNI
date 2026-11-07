/** Horizontal intent reveals actions; vertical movement remains ordinary page scrolling. */
export function bindWinebrarySwipe(root: HTMLElement) {
 let active:HTMLElement|null=null;
 const reveal=(row:HTMLElement,open:boolean)=>{
  if(open&&active&&active!==row)reveal(active,false);
  row.classList.toggle('actions-open',open);row.style.removeProperty('--swipe-x');
  const dock=row.querySelector<HTMLElement>('.wl-swipe-dock')!;dock.inert=!open;
  dock.setAttribute('aria-hidden',String(!open));
  row.querySelector('[data-row-actions]')?.setAttribute('aria-expanded',String(open));
  if(open){const details=row.querySelector('details')!;details.open=false;active=row;}else if(active===row)active=null;
 };
 root.querySelectorAll<HTMLElement>('.wl-compact-row').forEach(row=>{
  const surface=row.querySelector<HTMLElement>('.wl-swipe-content')!;
  row.querySelector('[data-row-actions]')?.addEventListener('click',()=>reveal(row,!row.classList.contains('actions-open')));
  row.querySelector('[data-close-actions]')?.addEventListener('click',()=>{reveal(row,false);row.querySelector<HTMLButtonElement>('[data-row-actions]')?.focus();});
  row.addEventListener('keydown',e=>{if(e.key==='Escape'&&row.classList.contains('actions-open')){e.preventDefault();reveal(row,false);row.querySelector<HTMLButtonElement>('[data-row-actions]')?.focus();}});
  let start:{x:number;y:number;id:number;open:boolean}|null=null,drag=false,suppress=false,dx=0;
  surface.addEventListener('pointerdown',e=>{
   if(e.button!==0||(e.target as HTMLElement).closest('button,input,a,.wl-row-expanded'))return;
   start={x:e.clientX,y:e.clientY,id:e.pointerId,open:row.classList.contains('actions-open')};drag=false;dx=0;
  });
  surface.addEventListener('pointermove',e=>{
   if(!start||e.pointerId!==start.id)return;
   dx=e.clientX-start.x;const dy=e.clientY-start.y;
   if(!drag&&Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){start=null;return;}
   if(!drag&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.4){drag=true;surface.setPointerCapture(e.pointerId);row.classList.add('is-swiping');}
   if(drag){e.preventDefault();row.style.setProperty('--swipe-x',`${Math.max(-156,Math.min(0,(start.open?-156:0)+dx))}px`);}
  });
  const finish=(e:PointerEvent)=>{if(!start||start.id!==e.pointerId)return;const opened=start.open;start=null;if(drag){suppress=true;row.classList.remove('is-swiping');reveal(row,e.type==='pointercancel'?opened:dx < -44?true:dx>44?false:opened);setTimeout(()=>suppress=false,0);}drag=false;};
  surface.addEventListener('pointerup',finish);surface.addEventListener('pointercancel',finish);
  surface.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopPropagation();}},true);
 });
}
