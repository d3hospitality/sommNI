import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {parseHTML} from 'linkedom';
const {window}=parseHTML('<html><body><div id="app"><main class="wl-workspace"><button class="tab" data-tab="winebrary">Winebrary</button><div id="anchor"></div></main></div></body></html>');
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,CustomEvent:window.CustomEvent});
let navigated=0;document.querySelector('.tab').onclick=()=>navigated++;
window.HTMLElement.prototype.scrollIntoView=function(){};
const row={wine:{wine_name:'Test wine',vintage:2020},state:'ready',work:'idle',options:[],choice:0,message:'Ready'};
const makeSession=()=>({current:row,rows:[row],settled:1,saved:0,busy:false});
globalThis.labelFixture={session:makeSession(),listeners:[]};
const mocks={
 'label-session':`export const labelSession=()=>labelFixture.session;export const labelProgress=()=>labelFixture.session.saved+' saved';export const subscribeLabels=cb=>labelFixture.listeners.push(cb);export const startLabels=()=>{};`,
 'label-glasses':`export const openLabelGlasses=async()=>{}`,
 'winebrary-glasses':`export const canShowWine=()=>false`,
 'client':`export const escape=s=>String(s??'')`,
 'arrival':`export const highlightArrival=()=>{}`,
};
const dir=await mkdtemp(tmpdir()+'/sommni-notice-');
await build({entryPoints:['src/research/label-phone.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/test.mjs',loader:{'.css':'empty'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1);if(name in mocks)return {path:name,namespace:'fixture'}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
const {initLabelReview}=await import(dir+'/test.mjs');initLabelReview(document.querySelector('#anchor'));
const $=s=>document.querySelector(s),notify=()=>labelFixture.listeners.forEach(cb=>cb());
assert.equal($('.label-nib').hidden,false);
$('.label-nib-dismiss').click();assert.equal($('.label-nib').hidden,true);assert.equal(navigated,0);
assert.equal($('#wl-label-review').hidden,false,'dismiss leaves the review available');
labelFixture.session.saved=1;notify();assert.equal($('.label-nib').hidden,true,'progress does not resurrect a dismissed notification');
window.dispatchEvent(new window.Event('sommni-glasses-connection'));assert.equal($('.label-nib').hidden,true);
labelFixture.session=makeSession();notify();assert.equal($('.label-nib').hidden,false,'a new batch gets its own notification');
$('.label-nib-open').click();assert.equal(navigated,1,'review link still navigates');
labelFixture.session=null;notify();assert.equal($('.label-nib').hidden,true);assert.equal($('#wl-label-review').hidden,true);
console.log('PASS: dismiss retains review and work, stays dismissed through progress/reconnect, new batch reappears, review link navigates, account clear hides it.');
