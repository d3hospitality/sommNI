/** Bottle-only gestures: vertical movement remains native page scrolling. */
export function attachBottleSwipe(bottle:HTMLElement,step:(delta:number)=>void){
 let swipe:{id:number,x:number,y:number}|null=null,suppressClick=false;
 const reset=()=>{swipe=null;bottle.style.removeProperty('--swipe-x');};
 bottle.addEventListener('dragstart',event=>event.preventDefault());
 bottle.addEventListener('pointerdown',event=>{
  if(!event.isPrimary){reset();suppressClick=true;return;}
  if(event.button!==0)return;
  swipe={id:event.pointerId,x:event.clientX,y:event.clientY};suppressClick=false;
  bottle.setPointerCapture(event.pointerId);
 });
 bottle.addEventListener('pointermove',event=>{
  if(!swipe||event.pointerId!==swipe.id)return;
  const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
  if(Math.hypot(dx,dy)>10)suppressClick=true;
  if(Math.abs(dx)>Math.abs(dy)*1.15)bottle.style.setProperty('--swipe-x',Math.max(-32,Math.min(32,dx*.3))+'px');
 });
 const end=(event:PointerEvent)=>{
  if(!swipe||event.pointerId!==swipe.id)return;
  const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;reset();
  if(bottle.hasPointerCapture(event.pointerId))bottle.releasePointerCapture(event.pointerId);
  if(event.type==='pointercancel'){suppressClick=true;return;}
  if(Math.abs(dx)>=28&&Math.abs(dx)>Math.abs(dy)*1.15){suppressClick=true;step(dx<0?1:-1);}
 };
 bottle.addEventListener('pointerup',end);bottle.addEventListener('pointercancel',end);
 bottle.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
 bottle.addEventListener('keydown',event=>{suppressClick=false;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);}});
}
