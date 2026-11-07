import {Liquid,VESSELS,type Pose} from './fluid';
import {paintVessel,g2Sprite,paintG2,DESTINATIONS} from './render';
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const glass=$<HTMLCanvasElement>('#glass'),g2=$<HTMLCanvasElement>('#g2'),webGlass=$<HTMLCanvasElement>('#web-glass');
const sprite=document.createElement('canvas');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const savedKey='sommni-home-directions-favorites-v1';
let favorites=new Set<string>();try{const saved=JSON.parse(localStorage.getItem(savedKey)??'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(x=>typeof x==='string'&&VESSELS.some(v=>v.id===x)));}catch{/* The study works even when storage is unavailable. */}
const requested=new URLSearchParams(location.search).get('direction');
let selected=Math.max(0,VESSELS.findIndex(v=>v.id===requested)),liquid=new Liquid(VESSELS[selected]);
let pose:Pose={roll:0,pitch:0},view='object',paused=reduced.matches,dirty=true,lastPaint=0,lastG2=-1000,simulationTime=0,lastClock=performance.now();
let swirlStarted:number|null=null,filterFavorites=false,selection=0,deviceOn=false;
const radians=(n:number)=>n*Math.PI/180,degrees=(n:number)=>n*180/Math.PI;
function labels(){
  const r=degrees(pose.roll),p=degrees(pose.pitch);
  $<HTMLInputElement>('#roll').value=String(r);$<HTMLInputElement>('#pitch').value=String(p);
  $('#roll-value').textContent=`${r.toFixed(0)}°`;$('#pitch-value').textContent=`${p.toFixed(0)}°`;
  $('#pose-readout').textContent=`${r.toFixed(0)}° / ${p.toFixed(0)}°`;
}
function setPose(next:Pose){pose={roll:Math.max(-.3665,Math.min(.3665,next.roll)),pitch:Math.max(-.2443,Math.min(.2443,next.pitch))};liquid.setPose(pose,simulationTime);labels();dirty=true;}
function motionStatus(message?:string){$('#motion-status').textContent=message??(paused?'Motion paused':deviceOn?'Device tilt connected':swirlStarted!==null?'A swirl, then a natural settle':liquid.active()?'Liquid settling':'Drag the glass to tilt');}
function favoriteUI(){
  const v=VESSELS[selected],active=favorites.has(v.id);$('#favorite').setAttribute('aria-pressed',String(active));$('#favorite').textContent=active?'♥ In your shortlist':'♡ Add to shortlist';$('#favorite-count').textContent=String(favorites.size);
  document.querySelectorAll<HTMLElement>('.card').forEach(card=>{const id=card.dataset.direction!;card.hidden=filterFavorites&&!favorites.has(id);card.querySelector('.favorite-mark')!.textContent=favorites.has(id)?'♥':'';});
  $('#empty-favorites').hidden=!filterFavorites||favorites.size>0;
}
function choose(index:number){
  selected=(index+VESSELS.length)%VESSELS.length;const v=VESSELS[selected];liquid=new Liquid(v);liquid.reset(simulationTime);liquid.setPose(pose,simulationTime);
  document.documentElement.style.setProperty('--accent',v.accent);document.documentElement.style.setProperty('--paper',v.paper);document.documentElement.style.setProperty('--object-ink',v.ink);
  $('#direction-name').textContent=v.name;$('#direction-subtitle').textContent=v.subtitle;$('#direction-description').textContent=v.description;$('#home-description').textContent=v.home;
  $('#stage-number').textContent=`${v.id} / 10`;$('.ambient-word').textContent=v.id;$('#object-tag').textContent=v.subtitle.toUpperCase();$('#web-shell').dataset.layout=String(v.layout);
  document.querySelectorAll<HTMLElement>('.card').forEach(card=>card.setAttribute('aria-pressed',String(card.dataset.direction===v.id)));
  document.title=`sommNI — ${v.id} ${v.name} · Home in motion`;
  const url=new URL(location.href);url.searchParams.set('direction',v.id);history.replaceState(null,'',url);
  $('#save-status').textContent='Compare first. Your beta app stays as it is.';favoriteUI();dirty=true;lastPaint=lastG2=-1000;
}
const cards=$('#cards');
VESSELS.forEach((v,index)=>{
  const button=document.createElement('button');button.className='card';button.dataset.direction=v.id;button.setAttribute('aria-label',`${v.id} ${v.name} — ${v.subtitle}`);button.setAttribute('aria-pressed','false');button.style.setProperty('--card-paper',v.paper);button.style.setProperty('--card-ink',v.ink);
  button.innerHTML=`<div class="card-image"><canvas width="360" height="420" aria-hidden="true"></canvas><div class="card-top"><span>${v.id} / ${v.finish==='cut'?'CUT CRYSTAL':v.finish==='smoke'?'SMOKED CRYSTAL':v.finish==='fluted'?'RIBBED CRYSTAL':'CLEAR CRYSTAL'}</span><span class="favorite-mark"></span></div></div><div class="card-title">${v.name}<span>↗</span></div><div class="card-subtitle">${v.subtitle}</div>`;
  const model=new Liquid(v);const previewPose={roll:index%2?.06:-.06,pitch:0};model.setPose(previewPose,0);model.advance(10000);paintVessel(button.querySelector('canvas')!,v,previewPose,model.surface(),{compact:true});
  button.onclick=()=>{choose(index);$('#top').scrollIntoView({behavior:reduced.matches?'instant':'smooth'});};cards.append(button);
});
$('#previous').onclick=()=>choose(selected-1);$('#next').onclick=()=>choose(selected+1);
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.onclick=()=>{
  view=button.dataset.view!;document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  for(const name of ['object','g2','web'])$(`#${name}-view`).hidden=view!==name;
  $('#stage-material').textContent=view==='object'?'LIVE CRYSTAL STUDY':view==='g2'?'NATIVE PIXELS / CADENCE PREVIEW':'COMPANION HOME STUDY';dirty=true;lastPaint=lastG2=-1000;
});
function stopDevice(){window.removeEventListener('deviceorientation',deviceTilt);deviceOn=false;$('#device').textContent='Use my device tilt ↗';}
function manual(){swirlStarted=null;stopDevice();motionStatus();}
$<HTMLInputElement>('#roll').oninput=e=>{manual();setPose({...pose,roll:radians(Number((e.target as HTMLInputElement).value))});};
$<HTMLInputElement>('#pitch').oninput=e=>{manual();setPose({...pose,pitch:radians(Number((e.target as HTMLInputElement).value))});};
$('#reset').onclick=()=>{manual();liquid.reset(simulationTime);setPose({roll:0,pitch:0});motionStatus('Recentered');};
function pause(next:boolean){paused=next;$('#pause').textContent=paused?'▷ Resume':'Ⅱ Pause';$('#pause').setAttribute('aria-pressed',String(paused));if(paused){swirlStarted=null;stopDevice();}motionStatus();dirty=true;}
$('#pause').onclick=()=>pause(!paused);
$('#nudge').onclick=()=>{stopDevice();pause(false);swirlStarted=simulationTime;motionStatus();};
let pointer:number|null=null,origin={x:0,y:0,roll:0,pitch:0};
$('#stage').addEventListener('pointerdown',event=>{
  if((event.target as HTMLElement).closest('button'))return;
  manual();pointer=event.pointerId;origin={x:event.clientX,y:event.clientY,...pose};$('#stage').setPointerCapture(pointer);
});
$('#stage').addEventListener('pointermove',event=>{if(pointer!==event.pointerId)return;setPose({roll:origin.roll+(event.clientX-origin.x)*.0023,pitch:origin.pitch+(event.clientY-origin.y)*.002});});
$('#stage').addEventListener('pointerup',()=>{pointer=null;});$('#stage').addEventListener('pointercancel',()=>{pointer=null;});
$('#stage').addEventListener('keydown',event=>{
  if((event.target as HTMLElement).closest('button'))return;
  if(event.code==='Space'){event.preventDefault();pause(!paused);return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();manual();
  if(view==='g2'&&['ArrowUp','ArrowDown'].includes(event.key)){moveMenu(event.key==='ArrowUp'?-1:1);return;}
  setPose({roll:pose.roll+(event.key==='ArrowLeft'?-.035:event.key==='ArrowRight'?.035:0),pitch:pose.pitch+(event.key==='ArrowUp'?-.025:event.key==='ArrowDown'?.025:0)});
});
function moveMenu(by:number){selection=(selection+by+7)%7;$('#menu-label').textContent=DESTINATIONS[selection];dirty=true;lastG2=-1000;}
$('#menu-prev').onclick=()=>moveMenu(-1);$('#menu-next').onclick=()=>moveMenu(1);
const descriptions=['Your saved bottles, vintages & tasting notes','Your preferences, explored one question at a time','Find a bottle for what is on the table','Daily questions, with explanations worth remembering','Italy · places, people & the wines they make','Explore familiar grapes and discover a new favorite','The people and moments behind the bottle'];
document.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach(button=>button.onclick=()=>{
  const index=Number(button.dataset.destination);$('#web-feature-label').textContent='PREVIEW FOCUS';$('#web-feature-name').textContent=DESTINATIONS[index];$('#web-feature-description').textContent=descriptions[index];document.querySelectorAll('[data-destination]').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.destination===String(index)));
});
$('#favorite').onclick=()=>{
  const id=VESSELS[selected].id;if(favorites.has(id))favorites.delete(id);else favorites.add(id);
  try{localStorage.setItem(savedKey,JSON.stringify([...favorites]));$('#save-status').textContent='Shortlist saved on this device.';}catch{$('#save-status').textContent='Shortlist kept for this session. Device storage is unavailable.';}favoriteUI();
};
$('#filter-favorites').onclick=()=>{filterFavorites=true;$('#filter-favorites').setAttribute('aria-pressed','true');$('#all-directions').setAttribute('aria-pressed','false');favoriteUI();};
$('#all-directions').onclick=()=>{filterFavorites=false;$('#filter-favorites').setAttribute('aria-pressed','false');$('#all-directions').setAttribute('aria-pressed','true');favoriteUI();};
let briefUrl:string|undefined;
$('#save-choice').onclick=()=>{
  const v=VESSELS[selected],text=`sommNI / ソムニ — Home direction\n\n${v.id} / ${v.name}\n${v.subtitle}\n\n${v.description}\n\nHome: ${v.home}\n\nShortlist: ${VESSELS.filter(x=>favorites.has(x.id)).map(x=>`${x.id} ${x.name}`).join(', ')||'None saved'}\n\nImplementation notes:\nFixed-fill 3D modal surface with conserved sampled volume. Roll and pitch input. No pouring or narration. G2: 128 × 144 sparse sprite, 550 ms cadence preview. Preserve the existing bridge serialization and IMU lifecycle. Validate selected composition in native simulator and hardware before beta integration.\n\nPrototype only; does not modify beta.\n`;
  if(briefUrl)URL.revokeObjectURL(briefUrl);briefUrl=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  const link=$<HTMLAnchorElement>('#download-brief');link.href=briefUrl;link.download=`sommNI-home-${v.id}-${v.name.toLowerCase()}.txt`;
  $<HTMLTextAreaElement>('#brief-text').value=text;$('#brief-status').textContent='';$<HTMLDialogElement>('#brief-dialog').showModal();
};
$('#close-brief').onclick=()=>$<HTMLDialogElement>('#brief-dialog').close();
$('#download-brief').onclick=()=>{$('#brief-status').textContent='Download requested. If your browser does not save it, select and copy the brief above.';};
let neutral:{beta:number;gamma:number}|null=null;
function deviceTilt(event:DeviceOrientationEvent){
  if(!deviceOn||event.beta===null||event.gamma===null)return;
  if(!neutral)neutral={beta:event.beta,gamma:event.gamma};
  const orientation=screen.orientation?.angle??0,deltaB=(event.beta-neutral.beta),deltaG=(event.gamma-neutral.gamma),angle=radians(orientation);
  setPose({roll:radians(deltaG*Math.cos(angle)+deltaB*Math.sin(angle)),pitch:radians(deltaB*Math.cos(angle)-deltaG*Math.sin(angle))});motionStatus();
}
$('#device').onclick=async()=>{
  if(deviceOn){stopDevice();motionStatus();return;}
  if(!('DeviceOrientationEvent'in window)){motionStatus('No tilt sensor here — use drag or the sliders.');return;}
  try{
    const Orientation=DeviceOrientationEvent as typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<string>};
    if(Orientation.requestPermission&&await Orientation.requestPermission()!=='granted'){motionStatus('Tilt permission declined — drag still works.');return;}
    neutral=null;swirlStarted=null;pause(false);deviceOn=true;window.addEventListener('deviceorientation',deviceTilt);$('#device').textContent='Stop device tilt ×';motionStatus('Waiting for your device sensor…');
    setTimeout(()=>{if(deviceOn&&!neutral){stopDevice();motionStatus('No sensor readings — use drag or the sliders.');}},2200);
  }catch{stopDevice();motionStatus('Device tilt unavailable — use drag or the sliders.');}
};
reduced.addEventListener('change',event=>{if(event.matches)pause(true);});
document.addEventListener('visibilitychange',()=>{lastClock=performance.now();if(document.hidden){stopDevice();swirlStarted=null;}else{liquid.reset(simulationTime);liquid.setPose(pose,simulationTime);liquid.advance(simulationTime+10000);simulationTime+=10000;dirty=true;}});
function frame(now:number){
  requestAnimationFrame(frame);const elapsed=Math.min(80,now-lastClock);lastClock=now;if(document.hidden)return;
  if(!paused){simulationTime+=elapsed;
    if(swirlStarted!==null){const t=(simulationTime-swirlStarted)/1000;if(t>2.8){swirlStarted=null;setPose({roll:0,pitch:0});}else{const envelope=Math.sin(Math.PI*t/2.8);setPose({roll:.23*Math.sin(t*4.5)*envelope,pitch:.13*Math.sin(t*4.5+1.1)*envelope});}}
    const wasActive=liquid.active();liquid.advance(simulationTime);dirty ||= wasActive;
  }
  const cadence=view==='g2'?550:1000/45;if(!dirty||now-lastPaint<cadence)return;
  const state=liquid.surface(),v=VESSELS[selected];
  if(view==='object')paintVessel(glass,v,pose,state);
  if(view==='web')paintVessel(webGlass,v,pose,state,{compact:true});
  if(view==='g2'&&now-lastG2>=550){g2Sprite(v,pose,state,sprite);paintG2(g2,sprite,v,selection);lastG2=now;}
  lastPaint=now;dirty=false;motionStatus();
  // Read-only diagnostics in the DOM for review and quality checks.
  $('#stage').dataset.volumeError=state.volumeError.toExponential(3);$('#stage').dataset.active=String(liquid.active());$('#stage').dataset.direction=v.id;$('#stage').dataset.view=view;$('#stage').dataset.paused=String(paused);
}
choose(selected);pause(paused);labels();requestAnimationFrame(frame);
