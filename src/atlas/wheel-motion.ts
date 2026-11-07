export const WHEEL_ROW = 44;
export const wheelIndex = (position:number, count:number) => Math.max(0,Math.min(count-1,Math.round(position/WHEEL_ROW)));

/** Velocity is scroll pixels/ms. Firm flicks coast 7–9 rows; slow drags stay precise. */
export function wheelLanding(position:number, velocity:number, count:number){
 const travel=Math.abs(velocity)<.12?0:Math.max(-9*WHEEL_ROW,Math.min(9*WHEEL_ROW,velocity*500));
 const target=wheelIndex(position+travel,count)*WHEEL_ROW;
 return {target,duration:Math.min(1100,Math.max(220,300+Math.abs(target-position)*2))};
}

/** Short recent samples make a pause before release cancel the flick. */
export class WheelVelocity {
 private samples:{position:number,time:number}[]=[];
 add(position:number,time:number){
  this.samples.push({position,time});
  this.samples=this.samples.filter(s=>time-s.time<=100);
 }
 value(position:number,time:number){
  this.add(position,time);
  const first=this.samples[0],elapsed=time-first.time;
  return elapsed>=16?(position-first.position)/elapsed:0;
 }
}

export function attachWheelMotion(track:HTMLElement,count:()=>number,paint:(index:number)=>void){
 const controller=new AbortController(),signal=controller.signal;
 let frame=0,wheelTimer:ReturnType<typeof setTimeout>|null=null,suppressClick=false;
 let drag:{id:number,y:number,start:number,moved:boolean,velocity:WheelVelocity}|null=null;
 const clamp=(position:number)=>Math.max(0,Math.min(Math.max(0,count()-1)*WHEEL_ROW,position));
 function position(value:number){track.scrollTop=clamp(value);paint(wheelIndex(track.scrollTop,count()));}
 function stop(){
  if(frame)cancelAnimationFrame(frame);frame=0;
  if(wheelTimer!==null)clearTimeout(wheelTimer);wheelTimer=null;
  const id=drag?.id;drag=null;
  if(id!==undefined&&track.hasPointerCapture(id))track.releasePointerCapture(id);
  track.classList.remove('is-coasting','is-dragging');
 }
 function settle(velocity=0){
  stop();const from=track.scrollTop,{target,duration}=wheelLanding(from,velocity,count());
  if(Math.abs(target-from)<.5||matchMedia('(prefers-reduced-motion: reduce)').matches){position(target);return;}
  const start=performance.now();track.classList.add('is-coasting');
  const tick=(now:number)=>{
   const progress=Math.min(1,(now-start)/duration);
   // Cubic deceleration ends at an exact row: the last few pixels pull into the center band.
   position(from+(target-from)*(1-Math.pow(1-progress,3)));
   if(progress<1)frame=requestAnimationFrame(tick);
   else{frame=0;position(target);track.classList.remove('is-coasting');}
  };
  frame=requestAnimationFrame(tick);
 }
 track.addEventListener('pointerdown',event=>{
  if(!event.isPrimary){suppressClick=true;stop();settle();return;}
  if(event.button!==0)return;
  const wasMoving=!!frame;stop();suppressClick=wasMoving;
  const velocity=new WheelVelocity();velocity.add(track.scrollTop,event.timeStamp);
  drag={id:event.pointerId,y:event.clientY,start:track.scrollTop,moved:false,velocity};
 },{signal});
 track.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  const delta=drag.y-event.clientY;
  if(!drag.moved&&Math.abs(delta)<4)return;
  drag.moved=true;suppressClick=true;event.preventDefault();
  if(!track.hasPointerCapture(event.pointerId))track.setPointerCapture(event.pointerId);
  track.classList.add('is-dragging');position(drag.start+delta);drag.velocity.add(track.scrollTop,event.timeStamp);
 },{signal});
 track.addEventListener('pointerup',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  const velocity=drag.velocity.value(track.scrollTop,event.timeStamp),moved=drag.moved;
  stop();if(moved||suppressClick)settle(velocity);
 },{signal});
 for(const type of ['pointercancel','lostpointercapture'])track.addEventListener(type,()=>{if(drag){suppressClick=true;stop();settle();}},{signal});
 track.addEventListener('click',event=>{if(suppressClick&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}}, {capture:true,signal});
 track.addEventListener('wheel',event=>{
  if(event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
  event.preventDefault();stop();
  position(track.scrollTop+event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?track.clientHeight:1));
  wheelTimer=setTimeout(()=>{wheelTimer=null;settle();},120);
 },{passive:false,signal});
 track.addEventListener('dragstart',event=>event.preventDefault(),{signal});
 return {stop,destroy(){stop();controller.abort();}};
}
