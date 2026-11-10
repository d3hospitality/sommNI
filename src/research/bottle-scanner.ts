import {boundedPng,photoData} from './photo-input';
import {researchAction} from './client';
import {artworkOwner} from '../artwork-store';
import {traceBottle,CameraLease,type BottleOutline} from './scan-tracker';
import {BottleScanSession} from './scan-session';
import type {WineDraft} from './add-session';
import './bottle-scanner.css';

let active:HTMLDialogElement|null=null;
type Options={research?:(photo:string,signal:AbortSignal)=>Promise<{draft:WineDraft}>;camera?:()=>Promise<MediaStream>;review?:(draft:WineDraft,photo:string)=>boolean;save?:(draft:WineDraft,photo:string,changed:(message:string)=>void)=>Promise<{message:string}>};
/** The phone owns the camera; G2 receives the saved wine through the existing Winebrary flow. */
export function openBottleScanner(options:Options={}){
 if(active?.open){active.focus();return;}
 const previous=document.activeElement as HTMLElement|null,scope=artworkOwner();
 const dialog=active=document.createElement('dialog');dialog.className='bottle-scanner';dialog.setAttribute('aria-labelledby','bottle-scanner-title');
 dialog.innerHTML=`<header><div><span class="scan-eyebrow">sommNI <span lang="ja">ソムニ</span></span><h2 id="bottle-scanner-title">Scan a Bottle</h2></div><button type="button" data-close aria-label="Close bottle scanner">×</button></header>
 <ol class="scan-steps" aria-label="Scan progress"><li data-scan-step="0">01 <span>Frame</span></li><li data-scan-step="1">02 <span>Identify</span></li><li data-scan-step="2">03 <span>Approve</span></li></ol>
 <div class="scan-view"><video muted playsinline aria-label="Live bottle camera"></video><img class="scan-still" hidden alt="Captured bottle to identify"><canvas class="scan-grid" aria-hidden="true"></canvas><div class="scan-view-label">Center one bottle · Keep the label readable</div><div class="scan-progress" hidden><span data-step></span><progress max="3" aria-label="Bottle identification progress"></progress><small>Capture → Research → Review</small></div></div>
 <p class="scan-status" role="status" aria-live="polite"></p>
 <section class="scan-result" hidden><span class="scan-eyebrow">Possible match · Check the label</span><h3></h3><p data-facts></p><p data-notes></p><details class="scan-check"><summary>Identification details</summary><p class="scan-caution"></p></details></section>
 <p class="scan-share" hidden>Approving saves this bottle to your Winebrary and contributes its wine details and photo to the collective catalog for review.</p>
 <footer class="scan-controls"><div class="scan-actions"><button type="button" class="scan-primary" data-capture disabled>Scan This Bottle</button><button type="button" class="scan-primary" data-approve hidden>Approve & Add to Winebrary</button><button type="button" data-review hidden>Edit Details</button><button type="button" data-retry hidden>Retry Lookup</button><button type="button" data-retake hidden>Scan Again</button><button type="button" data-stop hidden>Stop Lookup</button><button type="button" class="scan-primary" data-library hidden>Open Winebrary →</button></div>
 <div class="scan-alternatives"><label>Choose Photo<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose bottle photo"></label><label>Take Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take bottle photo"></label></div>
 <p class="scan-privacy">Live video stays on your phone. Only your capture is sent for AI research.</p></footer>`;
 document.body.append(dialog);
 const get=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
 const video=get<HTMLVideoElement>('video'),still=get<HTMLImageElement>('.scan-still'),canvas=get<HTMLCanvasElement>('.scan-grid'),status=get('.scan-status'),progress=get<HTMLProgressElement>('progress');
 const probe=document.createElement('canvas'),lease=new CameraLease();
 let closed=false,cameraReady=false,frame=0,lastProbe=0,outline:BottleOutline|null=null,misses=0,photoRevision=0,opening=false,saving=false;
 const session=new BottleScanSession({prepare:boundedPng,research:options.research||((photo,signal)=>researchAction({action:'research',query:'Identify this bottle from its label. Leave unreadable vintage unknown.',photo,request_id:crypto.randomUUID()},signal)),changed:paint});
 const stopCamera=()=>{lease.stop();cancelAnimationFrame(frame);video.srcObject=null;cameraReady=false;};
 const close=()=>{
  if(closed)return;closed=true;photoRevision++;session.cancel();stopCamera();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',close);window.removeEventListener('hashchange',close);window.removeEventListener('sommni-library-account-changing',close);
  dialog.close();dialog.remove();active=null;if(previous?.isConnected)previous.focus();
 };
 const visibility=()=>{if(document.hidden){stopCamera();opening=false;if(session.phase==='ready'){status.textContent='Camera paused while the app is in the background. Tap Scan Again to reopen it.';get('[data-retake]').hidden=false;get<HTMLButtonElement>('[data-capture]').disabled=true;}}};
 function paint(){
  if(closed)return;
  const busy=session.phase==='preparing'||session.phase==='researching',review=session.phase==='review',error=session.phase==='error';
  dialog.dataset.phase=session.phase;dialog.classList.toggle('scan-reviewing',review);
  const step=review?2:busy?1:0;dialog.querySelectorAll<HTMLElement>('[data-scan-step]').forEach((el,i)=>{el.classList.toggle('complete',i<step);if(i===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});get('#bottle-scanner-title').textContent=review?'Confirm Bottle':'Scan a Bottle';
  get('[data-capture]').hidden=busy||review||error;get<HTMLButtonElement>('[data-capture]').disabled=!cameraReady;
  get('[data-review]').hidden=!review;get('[data-approve]').hidden=!review;get('.scan-share').hidden=!review;get('[data-retake]').hidden=busy||(!review&&!error);get('[data-retry]').hidden=!error;get('[data-stop]').hidden=!busy;
  dialog.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=busy);
  get('.scan-progress').hidden=!busy;
  if(session.phase==='researching')progress.removeAttribute('value');else progress.value=review?3:1;
  get('[data-step]').textContent=review?'Research ready':session.phase==='preparing'?'1 / 3 · Preparing your photo':'2 / 3 · Reading label & finding notes';
  get('.scan-result').hidden=!review;
  if(busy)status.textContent='Reading the label and finding reference notes. You can stop at any time.';
  if(error)status.textContent=session.error;
  if(review&&session.draft){
   const wine=session.draft.result;get('.scan-result h3').textContent=wine.wine_name;
   get('[data-facts]').textContent=[wine.producer,wine.vintage??(wine.vintage_state==='non_vintage'?'Non-vintage':'Vintage not confirmed'),wine.region,wine.country].filter(Boolean).join(' · ');
   get('[data-notes]').textContent=String(wine.tasting_notes||'Open review to check the details and add your own tasting notes.').replace(/https?:\/\/\S+/g,'').slice(0,420);
   get('.scan-caution').textContent=wine.uncertainty||'AI-assisted identification. Confirm the producer, wine and year before adding.';
   status.textContent='Check the label and year before approving.';
  }
 }
 function drawGrid(){
  const box=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(box.width*ratio);canvas.height=Math.round(box.height*ratio);
  const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(ratio,ratio);
  const vw=video.videoWidth||still.naturalWidth||3,vh=video.videoHeight||still.naturalHeight||4,scale=Math.min(box.width/vw,box.height/vh),fw=vw*scale,fh=vh*scale,ox=(box.width-fw)/2,oy=(box.height-fh)/2;
  const o=outline||{left:.28,top:.09,width:.44,height:.82,rows:[.28,.28,.3,.62,.94,1,1,1,1,1,.98,.9]};
  const cx=ox+(o.left+o.width/2)*fw,y=oy+o.top*fh,w=o.width*fw,h=o.height*fh;
  if(session.phase==='preparing'||session.phase==='researching'||session.phase==='review'){
   ctx.save();ctx.beginPath();o.rows.forEach((r,i)=>{const xx=cx-r*w/2,yy=y+i/11*h;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)});for(let i=11;i>=0;i--)ctx.lineTo(cx+o.rows[i]*w/2,y+i/11*h);ctx.closePath();ctx.clip();
   const completed=session.phase==='review'?1:1/3;ctx.fillStyle='rgba(238,192,60,.14)';ctx.fillRect(cx-w/2,y+h*(1-completed),w,h*completed);ctx.restore();
  }
  ctx.strokeStyle=outline?'rgba(244,198,75,.88)':'rgba(255,255,255,.52)';ctx.lineWidth=1;ctx.setLineDash(outline?[]:[4,5]);
  for(const side of [-1,1]){ctx.beginPath();o.rows.forEach((r,i)=>{const x=cx+side*r*w/2,yy=y+i/11*h;i?ctx.lineTo(x,yy):ctx.moveTo(x,yy)});ctx.stroke();}
  ctx.setLineDash([]);ctx.globalAlpha=.45;
  for(let i=1;i<11;i++){ctx.beginPath();ctx.ellipse(cx,y+i/11*h,o.rows[i]*w/2,Math.min(7,h/50),0,0,Math.PI*2);ctx.stroke();}
  for(const f of [-.25,0,.25]){ctx.beginPath();o.rows.forEach((r,i)=>{const x=cx+f*r*w,yy=y+i/11*h;i?ctx.lineTo(x,yy):ctx.moveTo(x,yy)});ctx.stroke();}
 }
 function tick(now:number){
  if(closed||!lease.stream)return;
  if(video.readyState>=2&&now-lastProbe>180){
   lastProbe=now;probe.width=144;probe.height=Math.max(60,Math.min(256,Math.round(144*video.videoHeight/video.videoWidth)));
   const ctx=probe.getContext('2d',{willReadFrequently:true});
   if(ctx){ctx.drawImage(video,0,0,probe.width,probe.height);const next=traceBottle(ctx.getImageData(0,0,probe.width,probe.height).data,probe.width,probe.height);
    if(next){misses=0;if(outline){for(const k of ['left','top','width','height'] as const)next[k]=outline[k]*.55+next[k]*.45;}outline=next;}else if(++misses>3)outline=null;
    get('.scan-view-label').textContent=outline?'Edges found · Keep the label sharp':'Align one bottle · Plain background works best';drawGrid();}
  }
  frame=requestAnimationFrame(tick);
 }
 async function startCamera(){
  if(opening)return;opening=true;session.cancel();photoRevision++;outline=null;still.hidden=true;video.hidden=false;stopCamera();status.textContent='Opening your rear camera…';paint();
  try{
   if(!options.camera&&(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia))throw Error('Live camera is unavailable here. Use Take Photo or Choose Photo below.');
   const stream=await lease.open(options.camera||(()=>navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1920}}})));
   if(!stream||closed)return;video.srcObject=stream;await video.play();if(closed||lease.stream!==stream)return;
   cameraReady=true;status.textContent='Frame the whole bottle, then tap Scan This Bottle.';paint();frame=requestAnimationFrame(tick);
  }catch(error){if(closed)return;stopCamera();status.textContent=(error as Error).name==='NotAllowedError'?'Camera access wasn’t allowed. Use Take Photo or Choose Photo below.':(error as Error).message;get('[data-retake]').hidden=false;drawGrid();}
  finally{opening=false;}
 }
 async function scan(photo:string){
  stopCamera();still.onload=()=>{
   probe.width=144;probe.height=Math.max(60,Math.min(256,Math.round(144*still.naturalHeight/still.naturalWidth)));
   const ctx=probe.getContext('2d',{willReadFrequently:true});if(ctx){ctx.drawImage(still,0,0,probe.width,probe.height);outline=traceBottle(ctx.getImageData(0,0,probe.width,probe.height).data,probe.width,probe.height);}drawGrid();
  };still.src=photo;still.hidden=false;video.hidden=true;get('.scan-view-label').textContent='Captured photo · Check label and year';await session.scan(photo);if(!closed)drawGrid();
 }
 get('[data-capture]').onclick=()=>{
  if(!cameraReady||video.readyState<2)return;
  const capture=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));capture.width=Math.round(video.videoWidth*scale);capture.height=Math.round(video.videoHeight*scale);
  const ctx=capture.getContext('2d');if(!ctx)return;ctx.drawImage(video,0,0,capture.width,capture.height);void scan(capture.toDataURL('image/jpeg',.9));
 };
 for(const input of dialog.querySelectorAll<HTMLInputElement>('input'))input.onchange=async()=>{
   const file=input.files?.[0];input.value='';if(!file)return;const token=++photoRevision;session.cancel();stopCamera();opening=false;
  status.textContent='Preparing your bottle photo…';get<HTMLButtonElement>('[data-capture]').disabled=true;
  try{const photo=await photoData(file);if(closed||token!==photoRevision)return;outline=null;void scan(photo);}catch(error){if(!closed&&token===photoRevision){status.textContent=(error as Error).message;get('[data-retake]').hidden=false;}}
 };
 get('[data-stop]').onclick=()=>{session.cancel();status.textContent='Lookup stopped. No wine was added. You can retry this photo.';get('[data-capture]').hidden=true;get('[data-retry]').hidden=false;get('[data-retake]').hidden=false;};
 get('[data-retry]').onclick=()=>{if(session.photo)void scan(session.photo);};
 get('[data-retake]').onclick=()=>void startCamera();
 get('[data-approve]').onclick=async()=>{
  if(saving||!session.draft)return;
  if(artworkOwner()!==scope){status.textContent='Your account changed. Close and scan again in your current Winebrary.';return;}
  const approvedDraft=session.draft,approvedPhoto=session.photo;
  saving=true;dialog.dataset.phase='saving';dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(el=>el.disabled=true);get<HTMLButtonElement>('[data-close]').disabled=false;
  status.textContent='Saving your approved wine… You can close this view; saving will continue.';get('.scan-progress').hidden=false;progress.removeAttribute('value');get('[data-step]').textContent='Saving to Winebrary';
  try{
   const save=options.save||(await import('./scan-save')).saveScannedWine;
   if(artworkOwner()!==scope)throw Error('Account changed before saving. Scan again in your current Winebrary.');
   const result=await save(approvedDraft,approvedPhoto,message=>{if(!closed){status.textContent=message;get('[data-step]').textContent=message;}});
   if(closed)return;dialog.dataset.phase='saved';get('#bottle-scanner-title').textContent='Bottle Added';get('.scan-result .scan-eyebrow').textContent='In your Winebrary';status.textContent=result.message;get('[data-step]').textContent='Wine saved';progress.value=3;
   get('[data-approve]').hidden=true;get('[data-review]').hidden=true;get('[data-retake]').hidden=true;get('.scan-alternatives').hidden=true;get('.scan-share').hidden=true;get('[data-library]').hidden=false;get<HTMLButtonElement>('[data-library]').disabled=false;
  }catch(error){if(!closed){dialog.dataset.phase='review';status.textContent=(error as Error).message;get('.scan-progress').hidden=true;dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(el=>el.disabled=false);}}
  finally{saving=false;}
 };
 get('[data-library]').onclick=()=>{close();document.querySelector<HTMLButtonElement>('.tab[data-tab="winebrary"]')?.click();};
 get('[data-review]').onclick=()=>{
  if(!session.draft)return;if(artworkOwner()!==scope){status.textContent='Your account changed. Close and scan again in your current Winebrary.';return;}
  const accepted=options.review?options.review(session.draft,session.photo):!window.dispatchEvent(new CustomEvent('sommni-review-draft',{cancelable:true,detail:{draft:{...session.draft,scan_photo:session.photo},source:'camera'}}));
  if(accepted)close();else status.textContent='Another wine task is running. Finish it, then return here to review this scan.';
 };
 get('[data-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',close);
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',close);window.addEventListener('hashchange',close);window.addEventListener('sommni-library-account-changing',close);
 dialog.showModal();void startCamera();
 return {close,session};
}
