import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {traceBottle,CameraLease}=await load('src/research/scan-tracker.ts');
const {BottleScanSession}=await load('src/research/scan-session.ts');
const draft={id:'fixture',result:{wine_name:'Test wine',vintage_state:'unknown'}};
const tick=()=>new Promise(r=>setTimeout(r,0));
function frame(offset=0,contrast=true){
 const w=144,h=216,p=new Uint8ClampedArray(w*h*4).fill(255);
 if(contrast)for(let y=20;y<198;y++)for(let x=0;x<w;x++){
  const half=y<65?8:y<88?8+(y-65)*.65:23;
  if(Math.abs(x-72-offset)<half){const i=(y*w+x)*4;const label=y>112&&y<160&&Math.abs(x-72-offset)<18;p[i]=p[i+1]=p[i+2]=label?230:30;}
 }
 return p;
}
const first=traceBottle(frame(),144,216),moved=traceBottle(frame(20),144,216);
assert(first);assert(moved.left>first.left+.1);assert(first.rows[0]<first.rows[8]);
assert.equal(traceBottle(frame(0,false),144,216),null);
const filled=new Uint8ClampedArray(144*216*4).fill(40);assert.equal(traceBottle(filled,144,216),null);
let stop=0,grant;const camera=new CameraLease(),stream={getTracks:()=>[{stop(){stop++}}]};
const pending=camera.open(()=>new Promise(r=>grant=r));camera.stop();grant(stream);assert.equal(await pending,null);assert.equal(stop,1);
await camera.open(async()=>stream);camera.stop();camera.stop();assert.equal(stop,2);
let signal,resolve;const phases=[];
const session=new BottleScanSession({prepare:async p=>p,research:(_,s)=>{signal=s;return new Promise(r=>resolve=r)},changed:()=>phases.push(session.phase)});
const request=session.scan('photo');await tick();session.cancel();resolve({draft});await request;assert(signal.aborted);assert.equal(session.draft,null);assert.equal(session.phase,'ready');
const next=session.scan('next');await tick();resolve({draft});await next;assert.equal(session.phase,'review');assert.equal(session.photo,'next');assert(phases.includes('preparing'));assert(phases.includes('researching'));
let called=0;
const invalid=new BottleScanSession({prepare:async()=>{throw Error('Invalid image')},research:async()=>{called++;return {draft}},changed(){}});
await invalid.scan('bad');assert.equal(invalid.phase,'error');assert.equal(called,0);
const malformed=new BottleScanSession({prepare:async p=>p,research:async()=>({draft:{result:{}}}),changed(){}});await malformed.scan('photo');assert.equal(malformed.phase,'error');
const requests=[];const race=new BottleScanSession({prepare:async p=>p,research:p=>new Promise(r=>requests.push({p,r})),changed(){}});
const a=race.scan('old');await tick();const b=race.scan('new');await tick();requests[1].r({draft:{...draft,id:'new'}});await b;requests[0].r({draft});await a;assert.equal(race.draft.id,'new');
console.log('PASS: moving bottle contour, no false lock on blank frame, pending camera cleanup, abort/late result, retry, invalid image, malformed identification and concurrent lookup isolation.');
const {fittedBottle}=await load('src/research/scan-tracker.ts');
const silhouette={top:.03,bottom:.91,left:Array.from({length:12},(_,i)=>.4-i*.01),right:Array.from({length:12},(_,i)=>.5+i*.005)};
const fit=fittedBottle(silhouette);assert(fit);assert(fit.centers[0]!==fit.centers[11]);assert(fit.rows[0]<fit.rows[11]);
assert.equal(fittedBottle({...silhouette,top:-1}),null);assert.equal(fittedBottle({...silhouette,right:[.5]}),null);assert.equal(fittedBottle({...silhouette,right:Array(12).fill(.1)}),null);
console.log('PASS: asymmetric bottle centers and shoulder widths; malformed/out-of-image contours rejected.');
