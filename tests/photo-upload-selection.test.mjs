import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const {parseHTML}=await import(process.env.SOMMNI_TEST_DOM_PATH ? pathToFileURL(process.env.SOMMNI_TEST_DOM_PATH).href : 'linkedom');
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const {window}=parseHTML('<html><body><button class="tab" data-tab="home">Home</button><button class="tab" data-tab="winebrary">Winebrary</button><button id="wl-account"></button><span id="home-library"></span><section id="winebrary-content"></section><section id="wine-history"></section></body></html>');
Object.assign(globalThis,{window,Node:window.Node,document:window.document,HTMLElement:window.HTMLElement,CustomEvent:window.CustomEvent,Event:window.Event,matchMedia:()=>({matches:true})});
window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.focus=function(){document.__focused=this};window.HTMLElement.prototype.showModal=function(){this.open=true;this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.open=false;this.removeAttribute('open')};window.HTMLElement.prototype.reset=function(){};
Object.defineProperty(window.HTMLElement.prototype,'elements',{get(){return {namedItem:n=>this.querySelector(`[name="${n}"]`)}}});
globalThis.FormData=class extends Map{constructor(form){super();for(const input of form.querySelectorAll('input,select,textarea')){if(!input.name||input.disabled||(input.type==='checkbox'&&!input.checked))continue;this.set(input.name,input.type==='checkbox'?'on':input.value||'')}}};
const saved=[
 {id:'a',wine_name:'Barolo',producer:'Fixture A',vintage:2020,region:'Piedmont',metadata:{country:'Italy',grape:'Nebbiolo',color:'Red',vintage_state:'year'},notes:'Personal note'},
 {id:'b',wine_name:'Chablis',producer:'Fixture B',vintage:2022,region:'Burgundy',metadata:{country:'France',grape:'Chardonnay',color:'White',vintage_state:'year'},notes:''},
 {id:'c',wine_name:'Barolo',producer:'Fixture A',vintage:2018,region:'Piedmont',metadata:{country:'Italy',grape:'Nebbiolo',color:'Red',vintage_state:'year'},notes:'Older vintage'},
];
const draft={id:'new-draft',result:{wine_name:'Estate Cabernet',producer:'Fixture C',vintage:2019,vintage_state:'year',region:'Napa',country:'United States',grape:'Cabernet Sauvignon',color:'Red',tasting_notes:'NOSE: Cassis. PALATE: Firm tannins.'},report:'Fixture research.',evidence:{sources:[]}};

const requests=[];let bottleCalls=0;globalThis.__choiceCount=0;
const png='data:image/png;base64,uploaded-photo';
globalThis.__uploadFixture={photo:png,research:async body=>{requests.push(body);if(body.action==='status')return {research:true};if(body.action==='confirm')return {duplicate:true,item:{id:'existing',...draft.result,image_url:'old-photo.png',metadata:{}}};if(body.action==='attach_bottle')return {item:{id:'existing',...draft.result,image_url:body.photo,metadata:{}}};throw Error('Unexpected action');}};
const mock={
 'bottle-allowance':`export const getBottleAllowance=async()=>({remaining:10,limit:10,unlimited:false})`,
 'batch-phone':'export const mountBatchResearch=()=>()=>{}',
 'cloud-library':'export const isGuestLibrary=()=>true',
 'bottle-jobs':`export const findBottleCandidates=async()=>[1,2,3].map(i=>({id:String(i),photo:'data:image/png;base64,option'+i,provenance:{vintage_binding:'label shows '+(2018+i)}}));export const clipBottleCandidate=async p=>{globalThis.__choiceCount++;return {url:p.photo,provenance:p.provenance}};export const prepareBottleArtwork=()=>new Promise(()=>{})`,
 'artwork-store':`export const artworkOwner=()=> 'beta-local'`,
 'wine-contributions':`export const shareWineControl=()=>'';export const finishWineArtwork=async(...args)=>{globalThis.__artworkArgs=args;return 'Saved locally.'}`,
 'config':`export const FREE_BETA=true`,
 'client':`export const researchAction=b=>__uploadFixture.research(b);export const escape=v=>String(v??'')`,
 'notes':`export const mountWineNotesExport=()=>{}`,
 'bottles':`export const catalogBottleCandidates=()=>[];export const catalogBottleDraft=()=>null;export const bottleCutoutEndpoint=()=> 'https://fixture.invalid';export const bottleCutoutHosted=()=>true;export const createBottleCutout=async()=>({url:__uploadFixture.photo,provenance:{}});export const photoData=async()=>'';export const inlineBottle=async b=>b.url;export const bottleIdentity=()=>({})`,
 'account-client':`export const account={auth:{onAuthStateChange(){}}}`,
 'account-config':`export const ACCOUNT_SITE='https://fixture.invalid'`,
};
const dir=await mkdtemp(tmpdir()+'/sommni-upload-'),outfile=dir+'/upload.mjs';
await build({entryPoints:['src/research/phone.ts'],bundle:true,format:'esm',platform:'node',outfile,loader:{'.css':'empty'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{if(!/\/research\/(phone|photo-choices)\.ts$/.test(a.importer))return;const name=a.path.split('/').at(-1);if(name in mock)return {path:name,namespace:'fixture'}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mock[a.path],loader:'ts'}));}}]});
const {initResearchPanel}=await import(outfile);initResearchPanel();
const tick=()=>new Promise(r=>setTimeout(r,10));const $=s=>document.querySelector(s);
window.dispatchEvent(new CustomEvent('sommni-review-draft',{cancelable:true,detail:{draft}}));await tick();
assert.equal(document.querySelectorAll('[data-photo-option]').length,3);assert.equal(document.querySelectorAll('[data-photo-option][aria-pressed=true]').length,0);assert.equal(globalThis.__choiceCount,0,'no background removal until user chooses');
const upload=$('#research-bottle-file');Object.defineProperty(upload,'files',{value:[new File(['photo'],'bottle.jpg',{type:'image/jpeg'})]});
upload.dispatchEvent(new Event('change',{bubbles:true}));await tick();
assert.equal($('[name="use_bottle"]').checked,true,'uploaded image is selected without a hidden extra step');
assert.equal($('#research-bottle-preview img').getAttribute('src'),png);
assert($('#research-bottle-preview').classList.contains('sommni-arrived'));
assert.match($('#research-bottle-status').textContent,/selected and will save/);
$('[name="confirmed"]').checked=true;
$('#research-confirm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
const attached=requests.find(r=>r.action==='attach_bottle');assert(attached,'manual photo replaces a duplicate wine photo');assert.equal(attached.only_if_missing,false);assert.equal(attached.photo,png);
assert.equal($('#research-saved-notes')!==null,true);assert.equal($('.research-saved-bottle').getAttribute('src'),png);
assert.equal(globalThis.__artworkArgs[3],false,'saving does not silently choose a different search image');
console.log('PASS: uploaded photo selected and highlighted, duplicate wine replacement attached, saved preview uses new photo.');
