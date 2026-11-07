import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';
const {parseHTML}=await import('linkedom');
const {window}=parseHTML('<html><body><main></main></body></html>');Object.assign(globalThis,{window,document:window.document,CustomEvent:window.CustomEvent});
Object.defineProperty(window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked')},set(value){value?this.setAttribute('checked',''):this.removeAttribute('checked')}});
globalThis.FormData=class extends Map{constructor(form){super();for(const input of form.querySelectorAll('textarea,input'))this.set(input.name,input.value)}};
let queries=[],saves=0;globalThis.batchFixture={action:async body=>{if(body.action==='research'){queries.push(body.query);return {draft:{id:body.query,result:{wine_name:body.query,producer:'Estate',vintage:2022,vintage_state:'year'}}};}if(body.action==='confirm'){saves++;return {item:{id:body.draft_id,image_url:'photo'}}}},menu:async()=>({entries:[{query:'Menu Bottle 2022',source_text:'Menu Bottle 2022',needs_review:false,page:1,section:'Red'}]})};
const modules={
 '../beta/client':'export const betaProvider=(...args)=>globalThis.batchFixture.menu(...args);',
 '../artwork-store':'export const artworkOwner=()=>"guest:test";',
 './client':`export const researchAction=(...args)=>globalThis.batchFixture.action(...args);export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));`,
 './bottle-jobs':'export const prepareBottleArtwork=async()=>({url:"photo"});',
 './bottles':'export const bottleIdentity=()=>({});export const inlineBottle=async()=>"photo";',
 '../wine-contributions':'export const finishWineArtwork=async()=>"Saved and queued";export const shareWineControl=()=>"";',
 '../reference-notes':'export const referenceNotes=v=>v;',
 './arrival':'export const highlightArrival=()=>{};',
};
const dir=await mkdtemp(tmpdir()+'/sommni-menu-batch-');await build({entryPoints:['src/research/batch-phone.ts'],bundle:true,platform:'node',format:'esm',outfile:dir+'/ui.mjs',loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},args=>args.path in modules?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
const {mountBatchResearch}=await import(dir+'/ui.mjs');const host=document.querySelector('main'),reset=mountBatchResearch(host),$=s=>host.querySelector(s);const tick=()=>new Promise(r=>setImmediate(r));
$('[name=wines]').value='First Bottle\nSecond Bottle';$('.batch-form').onsubmit({preventDefault(){}});await tick();assert.deepEqual(queries,['First Bottle','Second Bottle']);assert.equal($('.batch-review').hidden,false);assert.equal($('.batch-input').hidden,true);assert.equal(saves,0);assert.equal($('[data-save]').disabled,false);
await $('[data-save]').onclick();await tick();assert.equal(saves,2);reset();assert.equal($('.batch-input').hidden,false);
$('[name=menu-link]').value='https://example.com/menu.pdf';await $('[data-menu-form]').onsubmit({preventDefault(){}});assert.equal(queries.length,2);$('[data-menu-research]').onclick();await tick();assert.equal(queries.at(-1),'Menu Bottle 2022');assert.equal($('.batch-rows').children.length,1);assert.equal(saves,2);reset();
console.log('PASS: typed batch and extracted menu both start research, use correct forms, wait for explicit save, and reset cleanly.');
