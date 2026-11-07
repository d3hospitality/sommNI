import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const checks=[],pages=[],mic=[],calls=[];let peak=0,inflight=0,releaseDisplay,sourceUser='beta-local',researchResponse;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const draft={id:'qa-draft',result:{wine_name:'Vasse Felix Cabernet Sauvignon',producer:'Vasse Felix',vintage:2019,vintage_state:'year',region:'Margaret River',country:'Australia',grape:'Cabernet Sauvignon',tasting_notes:'NOSE: Blackcurrant and cedar. PALATE: Fine tannins and refreshing acidity.'}};
globalThis.document=new EventTarget();globalThis.document.readyState='loading';globalThis.window=new EventTarget();globalThis.CustomEvent=class extends Event{constructor(type,init){super(type);this.detail=init?.detail}};
globalThis.__addFixture={
 pages, async operation(fn){inflight++;peak=Math.max(peak,inflight);await wait(2);try{return await fn()}finally{inflight--}},
 async research(body,signal){calls.push(body);if(body.action==='research'){if(researchResponse)return researchResponse;return {draft}}if(body.action==='confirm')return {item:{id:'qa-saved',wine_name:draft.result.wine_name,metadata:{}}};},
 async transcribe(){assert.equal(mic.at(-1),false);return {text:'Vasse Felix Cabernet 2019'}},
 claim:async(name,release)=>{if(releaseDisplay)await releaseDisplay();releaseDisplay=release},
 source:()=>({userId:sourceUser,items:[],loading:false,error:''}),
 back:async()=>{checks.push('returned to Winebrary')},owner:()=>sourceUser,
};
const stubs={
 './label-glasses':`export const openLabelGlasses=async wines=>{__addFixture.labelWines=wines}`, 
 '../image-utils':`import {validateGlassesPage} from ${JSON.stringify(resolve('src/glasses-page.ts'))};export const queueBridgeControl=task=>task();export const imageIdle=async()=>{};export const rebuildGlassesPage=async(b,p)=>{validateGlassesPage(p);return __addFixture.operation(()=>{__addFixture.pages.push(p);return true})}`,
 '../display':`export const claimDisplay=(n,r)=>__addFixture.claim(n,r);export const dropDisplay=()=>{}`,
 './client':`export const researchAction=(b,s)=>__addFixture.research(b,s)`,
 '../beta/client':`export const betaProvider=(b,s)=>__addFixture.transcribe(b,s)`,
 '../intelligence/client':`export const getLocale=()=> 'en'`,
 '../winebrary-glasses':`export const readLibrary=()=>__addFixture.source();export const openLibraryOnGlasses=()=>__addFixture.back()`,
 '../wine-contributions':`export const finishWineArtwork=async(...args)=>{__addFixture.artworkArgs=args;return ''}`, 
 '../artwork-store':`export const artworkOwner=()=>__addFixture.owner()`,
};
const dir=await mkdtemp(tmpdir()+'/sommni-add-'),outfile=dir+'/glasses.mjs';
await build({entryPoints:['src/research/glasses-add.ts'],bundle:true,format:'esm',platform:'node',outfile,plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>a.importer.endsWith('/research/glasses-add.ts')&&a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],resolveDir:process.cwd(),loader:'ts'}));}}]});
const g=await import(outfile);g.connectAddWineGlasses({audioControl:open=>__addFixture.operation(()=>{mic.push(open);return true})});
const body=()=>pages.at(-1).textObject?.map(b=>b.content).join('\n')||pages.at(-1).listObject?.[0].itemContainer.itemName.join('\n');
const tap=async()=>{await wait(370);g.handleAddWineGlasses({sysEvent:{}});await wait(30)};
const back=async()=>{g.handleAddWineGlasses({sysEvent:{eventType:3}});await wait(30)};
await g.openAddWineGlasses();assert.match(body(),/ADD A WINE/);await tap();assert.equal(mic.at(-1),true);
g.handleAddWineGlasses({audioEvent:{audioPcm:new Uint8Array(6400)}});await tap();assert.equal(mic.at(-1),false);assert.match(body(),/REVIEW YOUR WINE/);assert.equal(calls.filter(c=>c.action==='confirm').length,0);checks.push('speech closes mic, researches, and stops at review');
await tap();assert.ok(pages.at(-1).listObject);await wait(370);g.handleAddWineGlasses({listEvent:{}});await wait(40);assert.match(body(),/SAVED TO WINEBRARY/);assert.equal(calls.filter(c=>c.action==='confirm').length,1);checks.push('protobuf omitted index 0 saves the reviewed wine');
assert.equal(__addFixture.artworkArgs[3],false);await tap();assert.equal(__addFixture.labelWines[0].id,'qa-saved');checks.push('saved wine opens explicit on-glasses photo choice without automatic image selection');
await back();await g.openAddWineGlasses();await tap();await back();assert.equal(mic.at(-1),false);assert.match(body(),/ADD A WINE/);checks.push('double tap closes capture and returns to add introduction');
await tap();await g.pauseAddWineGlasses();assert.equal(mic.at(-1),false);const old=pages.length;g.handleAddWineGlasses({audioEvent:{audioPcm:new Uint8Array(6400)}});g.handleAddWineGlasses({sysEvent:{}});await wait(30);assert.equal(pages.length,old);await g.resumeAddWineGlasses();assert.match(body(),/ADD A WINE/);checks.push('background stops audio and ignores input until resume');
let finish;researchResponse=new Promise(r=>finish=r);await tap();g.handleAddWineGlasses({audioEvent:{audioPcm:new Uint8Array(6400)}});await tap();assert.match(body(),/FINDING YOUR WINE/);await back();const n=pages.length;finish({draft});await wait(30);assert.equal(pages.length,n);checks.push('late research after cancel cannot replace the introduction');researchResponse=null;
await tap();sourceUser=null;window.dispatchEvent(new Event('winelens-library-changed'));await wait(30);assert.equal(mic.at(-1),false);checks.push('account change closes microphone and leaves add flow');
assert.equal(peak,1);checks.push('bridge pages and audio controls are serialized');
const result={passed:true,checks,validPages:pages.length,micCalls:mic,bridgePeak:peak};
await writeFile(resolve(dir,'glasses-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
// The real Winebrary entry point must offer Add even with an empty collection.
const libraryStubs={
 './beta/client':`export const betaProvider=async()=>({text:''})`,
 './intelligence/client':`export const getLocale=()=>'en'`,
 './research/label-glasses':`export const openLabelGlasses=async()=>{}`,
 './wine-context':`export const announceWineContext=()=>{};export const libraryContext=()=>({});export const libraryPhoto=()=>null`,
 './research/glasses-add':`export const openAddWineGlasses=async()=>{__addFixture.openedAdd=true}`,
 './artwork-store':`export const localWineArtwork=async w=>w`,
 './catalog-anecdotes':`export const getCatalogAnecdote=()=>null;export const anecdotePublishers=()=>[]`,
 './history/content':`export const textParagraphs=s=>[s]`,
 './image-utils':`import {validateGlassesPage} from ${JSON.stringify(resolve('src/glasses-page.ts'))};export const rebuildGlassesPage=async(b,p)=>{validateGlassesPage(p);__addFixture.pages.push(p);return true};export const queueBridgeControl=task=>task();export const invalidateImages=()=>{};export const currentImageEpoch=()=>0;export const pushBottlePhoto=async()=>{};export const pushLogoToGlasses=async()=>{};export const pushGrayImage=async()=>{}`,
 './wine-scene':`export const SCENE_X=250,MAP_Y=40,TILE_W=288,TILE_H=120,CAPTION_MIN_X=250;export const captionBox=()=>({x:250,width:200})`,
 './bottle-raster':`export const ruleCanvas=()=>{};export const toGreenLevels=()=>{};export const stageCanvas=async()=>{}`,
 './identity':`export const lookupWineById=()=>null;export const allCatalogWines=()=>[];export const catalogPhoto=()=>null`,
 './display':`export const claimDisplay=async()=>{};export const dropDisplay=()=>{}`,
 './pages':`export const rebuildHomePage=()=>({})`,
};
await build({entryPoints:['src/winebrary-glasses.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/library.mjs',plugins:[{name:'library-fixture',setup(b){b.onResolve({filter:/.*/},a=>a.importer.endsWith('/src/winebrary-glasses.ts')&&a.path in libraryStubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:libraryStubs[a.path],resolveDir:process.cwd(),loader:'ts'}));}}]});
const library=await import(dir+'/library.mjs');library.connectWinebraryGlasses({getLocalStorage:async()=>''},'https://fixture.invalid/');library.setLibrarySource(()=>({userId:'beta-local',loading:false,error:'',items:[]}));await library.openLibraryOnGlasses();assert.match(pages.at(-1).textObject.map(t=>t.content).join('\n'),/Add Wine/);await wait(370);library.handleLibraryGlassesEvent({listEvent:{currentSelectItemIndex:1}});await wait(20);assert.equal(__addFixture.openedAdd,true);checks.push('empty Winebrary exposes voice add and omitted first index opens it');
library.setLibrarySource(()=>({userId:'beta-local',loading:false,error:'',items:[{id:'entry',wine_name:'Chianti',producer:'Fixture',region:'Tuscany',vintage:2021,notes:'',metadata:{color:'Red',country:'Italy'}}]}));await library.openLibraryOnGlasses();await wait(370);library.handleLibraryGlassesEvent({listEvent:{currentSelectItemIndex:2}});await wait(20);assert.ok(pages.at(-1).listObject[0].itemContainer.itemName.some(s=>s.includes('Italy')));checks.push('existing wine types still open the correct country after the Add row');
await writeFile(resolve(dir,'glasses-checks.json'),JSON.stringify({...result,checks,validPages:pages.length},null,2));console.log('Winebrary entry checks passed.');
