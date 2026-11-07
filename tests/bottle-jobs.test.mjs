import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const rows=new Map(),wines=new Map();let owner='a',lookups=0,cutouts=0,submissions=0,attachments=0,blocked=false,lookupWait;
globalThis.window=new EventTarget();globalThis.CustomEvent=class extends Event{constructor(n,o){super(n);this.detail=o?.detail}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});globalThis.setInterval=()=>0;
globalThis.fixture={owner:()=>owner,store:async(action,value)=>{if(action==='getAll')return [...rows.values()];if(action==='get')return rows.get(value);if(action==='put'){rows.set(value.id,structuredClone(value));return;}if(action==='delete')rows.delete(value)},
 candidates:w=>w.id==='catalog'?[{}]:[],catalog:()=>({url:'data:image/png;base64,fixture',provenance:{catalog_id:'known'}}),cutout:async()=>{cutouts++;return {url:'data:image/png;base64,cutout',provenance:{}}},
 lookup:async()=>{lookups++;if(blocked)throw Error('No confidently matching photograph');if(lookupWait)await lookupWait;return {photo:'data:image/png;base64,fixture',provenance:{source_page:'https://example.com/wine'}}},
 attach:async body=>{attachments++;const wine=wines.get(body.collection_id);if(!wine)throw Error('No longer saved');assert.equal(body.only_if_missing,true);if(!wine.image_url)wine.image_url=body.photo;return {item:wine}},
 submit:async()=>{submissions++},
};
const mocks={
 '../artwork-store':`export const artworkOwner=()=>fixture.owner();export const artworkStore=(a,v)=>fixture.store(a,v);export const recalledBottle=async()=>null;export const rememberProcessedBottle=async()=>{};export const processedBottleKey=async w=>w.wine_name`,
 './bottles':`export const catalogBottleCandidates=w=>fixture.candidates(w);export const catalogBottleDraft=()=>fixture.catalog();export const createBottleCutout=p=>fixture.cutout(p);export const inlineBottle=async d=>d.url;export const bottleIdentity=w=>({wine_name:w.wine_name,producer:w.producer,vintage:w.vintage})`,
 '../beta/client':`export const betaProvider=()=>fixture.lookup()`,
 './client':`export const researchAction=b=>fixture.attach(b)`,
 '../wine-contributions':`export const finishWineArtwork=()=>fixture.submit()`,
};
const dir=await mkdtemp(tmpdir()+'/sommni-bottle-job-');await build({entryPoints:['src/research/bottle-jobs.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/jobs.mjs',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'ts'}));}}]});
const jobs=await import(dir+'/jobs.mjs');jobs.initBottleJobs(async()=>[...wines.values()]);await jobs.runBottleJobs();
const add=id=>{const w={id,wine_name:'Estate Cabernet '+id,producer:'Estate',vintage:2020,metadata:{},notes:'PRIVATE'};wines.set(id,w);return w};
await jobs.queueBottleArtwork(add('catalog'),'a');await jobs.runBottleJobs();assert.equal(lookups,0);assert.equal(submissions,1);assert.ok(wines.get('catalog').image_url);
await jobs.queueBottleArtwork(add('new'),'a');await jobs.runBottleJobs();assert.equal(lookups,1);assert.equal(cutouts,1);assert.equal(submissions,2);assert.equal(wines.get('new').notes,'PRIVATE');
await jobs.queueBottleArtwork(wines.get('new'),'a',true);assert.equal(attachments,2);
blocked=true;await jobs.queueBottleArtwork(add('uncertain'),'a');await jobs.runBottleJobs();assert.equal(wines.get('uncertain').image_url,undefined);assert.match((await jobs.bottleJobStatuses()).get('uncertain').message,/No confidently/);
owner='b';assert.equal((await jobs.bottleJobStatuses()).size,0);assert.equal(submissions,2);
owner='a';blocked=false;
const shared=add('shared');let finishLookup;lookupWait=new Promise(resolve=>{finishLookup=resolve});
const preview=jobs.prepareBottleArtwork(shared,'a');await new Promise(r=>setImmediate(r));const beforeLookups=lookups,beforeCuts=cutouts;
assert.equal(jobs.prepareBottleArtwork({...shared},'a'),preview);
await jobs.queueBottleArtwork(shared,'a');const pendingJob=jobs.runBottleJobs();
assert.equal(shared.image_url,undefined);assert.equal(lookups,beforeLookups);
finishLookup();await preview;await pendingJob;lookupWait=undefined;
assert.equal(lookups,beforeLookups);assert.equal(cutouts,beforeCuts+1);assert.ok(shared.image_url);
blocked=true;const retryWine=add('retry');await assert.rejects(jobs.prepareBottleArtwork(retryWine,'a'),/No confidently/);
blocked=false;await jobs.prepareBottleArtwork(retryWine,'a');
owner='b';const beforeOwnerLookup=lookups;await jobs.prepareBottleArtwork(shared,'b');assert.equal(lookups,beforeOwnerLookup+1);
owner='a';let finishSwitch;lookupWait=new Promise(resolve=>{finishSwitch=resolve});const switchPending=jobs.prepareBottleArtwork(add('switch'),'a');owner='b';finishSwitch();await assert.rejects(switchPending,/Account changed/);lookupWait=undefined;
console.log('PASS: shared pre-save preparation with queued attachment, one lookup and cutout, failure retry, account isolation and in-flight account guard; exact catalog reuse, searched-photo cutout attachment, master submission, notes preserved, existing images preserved, uncertain matches remain empty with status, account-scoped jobs.');
