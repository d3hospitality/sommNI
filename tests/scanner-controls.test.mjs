import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from 'esbuild';
const {window}=parseHTML('<html><body></body></html>');globalThis.window=window;globalThis.document=window.document;window.matchMedia=()=>({matches:true});
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
window.HTMLElement.prototype.showModal=function(){this.open=true};window.HTMLElement.prototype.close=function(){this.open=false};window.HTMLElement.prototype.getBoundingClientRect=()=>({width:300,height:320});
window.HTMLElement.prototype.getContext=()=>null;
const b=await build({entryPoints:['src/research/bottle-scanner.ts'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'dependencies',setup(b){
 const stubs={'./bottles':'export const catalogBottleCandidates=()=>[];export const catalogBottleDraft=()=>({url:""})','./client':'export const researchAction=async()=>{throw Error("Test lookup failed")}', '../artwork-store':'export const artworkOwner=()=>"test"', './photo-input':'export const boundedPng=async p=>p;export const photoData=async()=>"photo";export const labelCrop=()=>({left:0,top:0,width:1,height:1});export const labelResearchDetail=async()=>"detail"', './native-photo':'export const usesEvenPhotoPicker=()=>true;export const pickEvenPhoto=async()=>null', './scan-save':'export const saveScannedWine=async()=>({message:"fixture"})'};
 b.onResolve({filter:/.*/},a=>a.importer.endsWith('/bottle-scanner.ts')&&a.path in stubs?{path:a.path,namespace:'test'}:undefined);b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:stubs[a.path]}));
}}]});
const {openBottleScanner}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const picks=[];const ui=openBottleScanner({nativePhoto:async source=>{picks.push(source);return null},research:async()=>{throw Error('Try a label hint')}});
await new Promise(r=>setImmediate(r));assert.deepEqual(picks,['camera']);
await ui.session.scan('photo');assert.equal(document.querySelector('.scan-name-hint').hidden,false);
document.querySelector('[data-focus]').click();assert.equal(document.querySelector('.scan-focus').hidden,false);assert.equal(ui.session.phase,'ready');assert.equal(document.querySelector('[data-read-label]').hidden,false);
const hint=document.querySelector('.scan-name-hint input');hint.value='Casanova di Neri Irrosso';hint.dispatchEvent(new window.Event('click',{cancelable:true}));hint.dispatchEvent(new window.Event('change'));await new Promise(r=>setImmediate(r));
assert.equal(hint.value,'Casanova di Neri Irrosso');assert.deepEqual(picks,['camera'],'typing a hint must never open the native album');
document.querySelector('[data-read-label]').click();await new Promise(r=>setImmediate(r));assert.equal(ui.session.phase,'error');assert.equal(ui.session.photo,'photo','retry must preserve the original photograph');
const choose=document.querySelector('input[type=file]');const click=new window.Event('click',{cancelable:true});choose.dispatchEvent(click);await new Promise(r=>setImmediate(r));assert(click.defaultPrevented);assert.deepEqual(picks,['camera','album']);
ui.close();assert.equal(document.querySelector('dialog'),null);
console.log('PASS: failed scan keeps a usable text hint; typing does not open native picker or clear the hint; file chooser still routes to album; close cleans up.');

let finish;const pending=openBottleScanner({nativePhoto:async()=>null,research:()=>new Promise(resolve=>finish=resolve)});await new Promise(r=>setImmediate(r));const request=pending.session.scan('original');await new Promise(r=>setImmediate(r));assert.equal(pending.session.phase,'researching');document.querySelector('[data-focus]').click();assert.equal(pending.session.phase,'ready');finish({draft:{id:'late',result:{wine_name:'Stale result'}}});await request;assert.equal(pending.session.draft,null);assert.equal(document.querySelector('[data-read-label]').hidden,false);document.querySelector('[data-reset-focus]').click();assert.equal(document.querySelector('[data-retry]').hidden,false);assert.equal(document.querySelector('[data-capture]').hidden,true);pending.close();
console.log('PASS: adjusting a pending scan cancels its lookup; late results cannot replace focus; full-photo retry remains available.');
const artUi=openBottleScanner({nativePhoto:async()=>null,research:async()=>({draft:{id:'art',result:{wine_name:'Palermo',producer:'Orin Swift',vintage:null,vintage_state:'unknown',recognition_basis:'artwork',visual_evidence:'Skeleton portrait',uncertainty:'Artwork-based suggestion'}}})});await new Promise(r=>setImmediate(r));await artUi.session.scan('art');assert.equal(document.querySelector('.scan-result .scan-eyebrow').textContent,'Artwork Match · Please Confirm');assert.match(document.querySelector('.scan-status').textContent,/Suggested from label artwork/);assert.match(document.querySelector('[data-facts]').textContent,/Vintage not confirmed/);artUi.close();
console.log('PASS: artwork-only candidates show a visible suggestion warning and unconfirmed vintage before approval.');
