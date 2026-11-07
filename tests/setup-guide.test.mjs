import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const {parseHTML}=await import('linkedom');
const fixture='<html><body><button class="tab" data-tab="home">Home</button><button id="wl-account">Link account</button><section id="tab-home"><button data-setup-guide>Guide</button><button data-wl-add>Add wine</button></section><select id="orbit-country"><option>Italy</option></select><button id="orbit-country-wheel">Italy ↕</button><canvas id="dot-explorer"></canvas><button id="orbit-bottle">Bottle</button><button class="tab" data-tab="settings">Settings</button></body></html>';
const {window}=parseHTML(fixture);
let linked=false,saved=null,links=0,adds=0,wheels=0;const queue=[];
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,HTMLSelectElement:window.HTMLSelectElement,MutationObserver:window.MutationObserver,location:{hash:'#home'},innerWidth:390,innerHeight:740,localStorage:{getItem:()=>saved,setItem:(k,v)=>saved=v},requestAnimationFrame:f=>{queue.push(f);return queue.length},addEventListener:(...a)=>window.addEventListener(...a)});
window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.focus=function(){};window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:15,top:90,right:250,bottom:130,width:235,height:40}};
const $=s=>document.querySelector(s);$('#orbit-country-wheel').onclick=()=>wheels++;$('#wl-account').onclick=()=>links++;$('[data-wl-add]').onclick=()=>adds++;
const dir=await mkdtemp(tmpdir()+'/sommni-guide-');await build({entryPoints:['src/setup-guide.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/guide.mjs',loader:{'.css':'empty'}});const g=await import(dir+'/guide.mjs');
const flush=()=>{while(queue.length)queue.shift()()};
assert.equal(g.readGuideState('{broken'),null);assert.equal(g.readGuideState('{"step":8,"done":false}'),null);
g.initSetupGuide(()=>linked);flush();assert.match($('#sommni-setup-guide').textContent,/Find your way/);assert.equal(links,0,'no forced account modal');
$('[data-guide-dismiss]').click();flush();assert.equal($('#sommni-setup-guide').hidden,true,'welcome is skippable');assert.ok(saved,'skip is persisted');$('[data-setup-guide]').click();flush();assert.match($('#wl-account').getAttribute('aria-describedby'),/setup-description/);$('[data-guide-action]').click();assert.equal(links,1);
const modal=document.createElement('dialog');modal.setAttribute('open','');document.body.append(modal);await new Promise(r=>setTimeout(r,0));flush();assert.equal($('#sommni-setup-guide').hidden,true,'native dialogs keep focus and top layer');modal.remove();await new Promise(r=>setTimeout(r,0));flush();
$('[data-guide-next]').click();flush();assert.match($('#sommni-setup-guide').textContent,/Pick a place/);assert.equal($('#wl-account').hasAttribute('aria-describedby'),false);
assert.match($('#orbit-country-wheel').getAttribute('aria-describedby'),/setup-description/);$('[data-guide-action]').click();assert.equal(wheels,1,'guide opens visible country wheel');
$('#orbit-country').dispatchEvent(new window.Event('change',{bubbles:true}));flush();assert.match($('#sommni-setup-guide').textContent,/Flick through/);assert.match($('#orbit-bottle').getAttribute('aria-describedby'),/setup-description/);
$('[data-guide-next]').click();flush();$('[data-guide-action]').click();assert.equal(adds,1);assert.equal(JSON.parse(saved).done,true);assert.equal($('#sommni-setup-guide').hidden,true);
$('[data-setup-guide]').click();flush();assert.match($('#sommni-setup-guide').textContent,/Your wines, with you/,'completed tour restarts at first step');
$('.tab[data-tab=settings]').click();assert.equal($('#sommni-setup-guide').hidden,true);assert.equal(document.querySelectorAll('.setup-target').length,0);
for(let step=0;step<4;step++){
 $('[data-setup-guide]').click();flush();
 for(let i=0;i<step;i++){$('[data-guide-next]').click();flush();}
 assert.equal($('[data-guide-dismiss]').textContent,'Skip guide');$('[data-guide-dismiss]').click();flush();
 assert.equal($('#sommni-setup-guide').hidden,true);assert.equal(document.querySelectorAll('.setup-target').length,0);
 $('[data-setup-guide]').click();flush();assert.match($('#sommni-setup-guide').textContent,/Your wines, with you/,'restart begins at step one after skipping any step');
 $('[data-guide-dismiss]').click();flush();
}
// Restored sessions must not require another pairing event or account modal.
linked=true;$('[data-setup-guide]').click();flush();
assert.match($('#sommni-setup-guide').textContent,/already linked/);
assert.equal($('[data-guide-action]'),null,'linked accounts have no redundant pairing action');
assert.equal($('[data-guide-next]').textContent,'Next step →');
$('[data-guide-back]').click();flush();assert.match($('#sommni-setup-guide').textContent,/Find your way/);
$('[data-guide-start]').click();flush();
for(let i=0;i<3;i++){$('[data-guide-next]').click();flush();assert.ok($('[data-guide-back]'));}
for(let i=0;i<3;i++){$('[data-guide-back]').click();flush();}
assert.match($('#sommni-setup-guide').textContent,/already linked/);
linked=false;window.dispatchEvent(new window.Event('winelens-library-changed'));flush();
assert.ok($('[data-guide-action]'),'sign out restores the optional link action');
linked=true;window.dispatchEvent(new window.Event('winelens-library-changed'));flush();
assert.equal($('[data-guide-action]'),null,'late session restoration updates the current card');
$('[data-guide-next]').click();flush();assert.match($('#sommni-setup-guide').textContent,/Pick a place/);
$('[data-guide-back]').click();flush();window.dispatchEvent(new window.Event('sommni-account-linked'));flush();
assert.match($('#sommni-setup-guide').textContent,/Pick a place/,'new pairing still advances');
$('[data-guide-dismiss]').click();flush();
console.log('PASS: restored and late account sessions, no redundant pairing, Next/Back on every step, first-step Back, sign-out refresh, new pairing progression.');
const reloaded=parseHTML(fixture).window;
Object.assign(globalThis,{window:reloaded,document:reloaded.document,HTMLElement:reloaded.HTMLElement,HTMLSelectElement:reloaded.HTMLSelectElement,MutationObserver:reloaded.MutationObserver,addEventListener:(...a)=>reloaded.addEventListener(...a)});
g.initSetupGuide(()=>linked);flush();assert.equal($('#sommni-setup-guide').hidden,true,'reload does not force a skipped tutorial');
console.log('PASS: skip welcome, skip every step, remembered skip after reload, restart from step one;  optional welcome, account action, modal coexistence, country progression, target cleanup, add-wine action, persistence, restart, tab dismissal.');
