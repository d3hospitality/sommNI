import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.readyState='loading';
globalThis.CustomEvent=class extends Event{constructor(type,init){super(type);this.detail=init?.detail}};
const F=globalThis.__scrollFixture={pages:[],texts:[],images:[],context:null,epoch:0,owner:'catalog',queue:Promise.resolve(),delay:0,suspended:false};
F.serial=fn=>F.queue=F.queue.catch(()=>{}).then(fn);
const stubs={
 'research/label-glasses':`export const handleLabelGlasses=()=>false;export const openLabelGlasses=async()=>{};export const pauseLabelGlasses=()=>{};export const resumeLabelGlasses=async()=>{};`,
 'research/glasses-add':`export const handleAddWineGlasses=()=>false;export const openAddWineGlasses=async()=>{};export const pauseAddWineGlasses=async()=>{};export const resumeAddWineGlasses=async()=>{};`,
 'pairing-glasses':`export const handlePairingGlasses=()=>false;export const openPairingGlasses=async()=>{};`,
 'intelligence/glasses':`export const handleIntelligenceGlasses=()=>false;export const openDailyGlasses=async()=>{};export const openSommelierGlasses=async()=>{};export const pauseIntelligenceGlasses=()=>{};export const resumeIntelligenceGlasses=async()=>{};`,
 'history/glasses':`export const handleHistoryGlassesEvent=()=>false;export const openHistoryOnGlasses=async()=>{};export const pauseHistoryGlasses=()=>{};export const resumeHistoryGlasses=async()=>{};`,
 'study/glasses':`export const handleStudyGlassesEvent=()=>false;export const openStudyOnGlasses=async()=>{};`,
 'study/store':`export const flushStudyWrites=async()=>{};`,
 'sync':`export const getPairings=async()=>[];export const flushCompanionWrites=async()=>{};`,
 'ui':`export const log=()=>{};`,
 'artwork-store':`export const localWineArtwork=async w=>w;`,
 'catalog-anecdotes':`export const getCatalogAnecdote=()=>null;export const anecdotePublishers=()=>[];`,
 'reference-notes':`export const referenceNotes=w=>w.notes||'';`,
 'history/content':`export const textParagraphs=s=>[s||''];`,
 'intelligence/pour':`export const GLASS_WIDTH=144,GLASS_HEIGHT=144;`,
 'bottle-assets':`export const bottleImageUrl=id=>'/bottle/'+id;`,
 'bottle-raster':`export const stageCanvas=async()=>{};export const toGreenLevels=()=>[];export const ruleCanvas=()=>({getContext:()=>({getImageData:()=>({data:[]})})});`,
 'wine-context':`export const announceWineContext=c=>__scrollFixture.context=c;export const announceCatalogWine=id=>__scrollFixture.context={id};export const libraryContext=w=>({id:w.id});export const libraryPhoto=w=>w.image_url||null;`,
 'display':`export const displayOwner=()=>__scrollFixture.owner;export const claimDisplay=async(o,fn)=>{__scrollFixture.owner=o;__scrollFixture.release=fn};export const dropDisplay=()=>{__scrollFixture.owner='catalog'};export const releaseDisplay=async()=>{__scrollFixture.release?.()};export const suspendDisplay=()=>{};`,
 'image-utils':`import {validateGlassesPage} from ${JSON.stringify(resolve('src/glasses-page.ts'))};const f=__scrollFixture;
 export const invalidateImages=()=>{f.epoch++};export const currentImageEpoch=()=>f.epoch;
 export const sendSerial=(fn,epoch=f.epoch)=>f.serial(async()=>{if(!f.suspended&&epoch===f.epoch)await fn()});export const queueBridgeControl=fn=>f.serial(fn);export const imageIdle=()=>f.queue;
 export const rebuildGlassesPage=async(b,p)=>{validateGlassesPage(p);invalidateImages();return f.serial(async()=>{f.pages.push(p);return true})};
 export const pushGrayImage=async(b,id,name,w,h,data,epoch=f.epoch)=>sendSerial(async()=>{f.images.push({id,name,data:Array.from(data)})},epoch);
 export const suspendImages=v=>{f.suspended=v;invalidateImages()};export const handleContinuousReadingScroll=()=>false;
 export const pushLogoToGlasses=async()=>{};export const pushGlobeToGlasses=async()=>{};export const pushGrapeSpriteToGlasses=async()=>{};export const pushBottleSprite=async()=>{};export const pushTastingNotesImages=async()=>{};export const pushBottlePhoto=async()=>{};export const pauseHomePour=()=>{};export const resumeHomePour=async()=>{};`,
 'atlas-app':`export const handleAtlasGlassesEvent=()=>false;export const openAtlasOnGlasses=async()=>{};export const pauseAtlasGlasses=async()=>{};export const resumeAtlasGlasses=async()=>{};export const pushCatalogGlobe=async(b,c,o)=>{await o?.lead?.();return true};export const catalogBrowseScene=async(id)=>{const delay=__scrollFixture.delay;return {render:async()=>{await new Promise(r=>setTimeout(r,delay));return [[id||'map'],[id||'map']]}}};`,
};
const root=resolve('src'),dir=await mkdtemp(tmpdir()+'/sommni-scroll-');
const output=dir+'/test.mjs';
await build({stdin:{contents:`export * as E from './src/events';export * as G from './src/winebrary-glasses';export * as P from './src/pages';export * as C from './src/constants';export * as I from './src/identity';export {validateGlassesPage} from './src/glasses-page';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:output,plugins:[{name:'hardware-fixture',setup(b){b.onResolve({filter:/^\./},a=>{const path=resolve(a.resolveDir||dirname(a.importer),a.path);const key=path.startsWith(root+'/')?path.slice(root.length+1).replace(/\.ts$/,''):'';return key in stubs?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'ts',resolveDir:process.cwd()}));}}]});
const {E,G,P,C,I,validateGlassesPage}=await import(output);
let handler;const bridge={onEvenHubEvent:cb=>{handler=cb;return()=>{}},textContainerUpgrade:async t=>{F.texts.push(t);return true},setLocalStorage:async()=>{},getLocalStorage:async()=>'',shutDownPageContainer:async()=>true};
G.connectWinebraryGlasses(bridge,'https://fixture.invalid/');G.setWinebraryDeviceConnected(true);
const scene=id=>({anchorX:100,anchorY:100,render:async()=>{const delay=F.delay;await wait(delay);return [[id],[id]]}});
G.setWinePlacer(async wines=>new Map(wines.map(w=>[w.id,{type:'Red',country:'Italy',region:'Tuscany',mapped:true}])));G.setPlaceSceneBuilder(async()=>scene('map'));G.setWineSceneBuilder(async w=>scene(w.id));
const wines=Array.from({length:23},(_,i)=>({id:'wine-'+i,wine_name:'Wine '+i,producer:'Producer',vintage:2020+i,region:'Tuscany',metadata:{country:'Italy',color:'Red'},image_url:'photo-'+i}));
// One grouped wine offers two vintages; pagination remains reachable through the cursor.
wines[1].wine_name=wines[0].wine_name;
G.setLibrarySource(()=>({userId:'qa',loading:false,error:'',items:wines}));await G.openLibraryOnGlasses();
const libraryTap=async i=>{await wait(370);G.handleLibraryGlassesEvent(i===undefined?{sysEvent:{}}:{listEvent:{currentSelectItemIndex:i}});await wait(40);await F.queue};
const libraryMove=async direction=>{G.handleLibraryGlassesEvent({textEvent:{eventType:direction}});await wait(210);await F.queue};
await libraryTap(2);await libraryTap(0);await libraryTap(0);
let page=F.pages.at(-1);assert.equal(page.listObject?.length||0,0);assert.equal(page.textObject.find(x=>x.containerName==='library-list').isEventCapture,1);
const pageCount=F.pages.length;await libraryMove(2);assert.equal(F.images.at(-1).data[0],'wine-2');assert.equal(F.pages.length,pageCount,'hover never rebuilds or opens a page');assert.equal(F.context.id,'wine-2');
await libraryMove(1);assert.equal(F.images.at(-1).data[0],'wine-1','first group previews newest vintage');
await libraryTap();assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='library-vintages'));await libraryMove(2);assert.equal(F.images.at(-1).data[0],'wine-0');await libraryTap();assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='library-title'));
G.handleLibraryGlassesEvent({sysEvent:{eventType:3}});await wait(60);assert.match(F.pages.at(-1).textObject.find(t=>t.containerName==='library-vintages').content,/> 2020/);
G.handleLibraryGlassesEvent({sysEvent:{eventType:3}});await wait(60);
// Rapid direction changes only send the final selection.
F.images=[];G.handleLibraryGlassesEvent({textEvent:{eventType:2}});G.handleLibraryGlassesEvent({textEvent:{eventType:2}});G.handleLibraryGlassesEvent({textEvent:{eventType:1}});await wait(230);await F.queue;assert.ok(F.images.every(i=>i.data[0]==='wine-2'));
// Native firmware payload with omitted zero also restores the first wine.
G.handleLibraryGlassesEvent({listEvent:{eventType:1}});await wait(230);assert.equal(F.images.at(-1).data[0],'wine-1');
for(let i=0;i<18;i++)G.handleLibraryGlassesEvent({textEvent:{eventType:2}});await wait(230);assert.equal(F.images.at(-1).data[0],'map');await libraryTap();assert.match(F.pages.at(-1).textObject.find(t=>t.containerName==='library-header').content,/2\/2/);assert.match(F.pages.at(-1).textObject.find(t=>t.containerName==='library-list').content,/^> Wine 19/);
F.delay=250;G.handleLibraryGlassesEvent({textEvent:{eventType:2}});await wait(180);G.handleLibraryGlassesEvent({sysEvent:{eventType:3}});await wait(500);assert.ok(F.pages.at(-1).textObject.find(t=>t.containerName==='library-list').content.startsWith('> Wine 0'));assert.notEqual(F.images.at(-1).data[0],'wine-20','stale scene cannot overwrite Back');F.delay=0;
// View All is continuous, sorted by country/region and skips every heading on swipe.
G.setWinePlacer(async list=>new Map(list.map(w=>[w.id,{type:'Red',country:w.metadata.country,region:w.region,mapped:true}])));
wines.forEach((w,i)=>{w.metadata.country=i<5?'France':'Italy';w.region=i%2?'Tuscany':'Piedmont'});
await G.openLibraryOnGlasses();
assert.match(F.pages.at(-1).textObject.find(t=>t.containerName==='library-types').content,/^> View All/);
await libraryTap();
const allPageCount=F.pages.length;
const sorted=[...wines].sort((a,b)=>a.metadata.country.localeCompare(b.metadata.country)||a.region.localeCompare(b.region)||a.wine_name.localeCompare(b.wine_name)||(b.vintage??0)-(a.vintage??0));
let allText=F.pages.at(-1).textObject.find(t=>t.containerName==='library-all').content;
assert.match(allText,/   France/);assert.match(allText,/     Piedmont/);assert.equal(F.context.id,sorted[0].id);
for(let i=1;i<sorted.length;i++){
 await libraryMove(2);
 assert.equal(F.context.id,sorted[i].id,'each swipe selects the next wine, never a divider');
 assert.equal(F.images.at(-1).data[0],sorted[i].id);
 assert.match(F.texts.filter(t=>t.containerName==='map-caption').at(-1).content,new RegExp(sorted[i].region.toUpperCase()+'.*'+sorted[i].metadata.country),'origin caption follows every wine without rebuilding');
 const text=F.texts.filter(t=>t.containerName==='library-all').at(-1).content;
 assert.equal(text.split('\n').filter(l=>l.startsWith('>')).length,1,'highlight always visible');
 assert.ok(text.split('\n').length<=7);assert.doesNotMatch(text,/More/);
}
assert.equal(F.pages.length,allPageCount,'all wines scroll without paging');
await libraryTap();assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='library-title'));
G.handleLibraryGlassesEvent({sysEvent:{eventType:3}});await wait(70);
assert.ok(F.pages.at(-1).textObject.find(t=>t.containerName==='library-all').content.includes('> '+sorted.at(-1).wine_name),'Back retains selection');
await libraryMove(2);await libraryTap();assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='library-types'));
// Empty libraries still have a usable View All / Back, with no dead heading target.
G.setLibrarySource(()=>({userId:'qa',loading:false,error:'',items:[]}));await G.openLibraryOnGlasses();await libraryTap();
assert.equal(F.pages.at(-1).textObject.find(t=>t.containerName==='library-all').content,'> Back');await libraryTap();
validateGlassesPage(P.rebuildHomePage());
assert.deepEqual(P.HOME_LIST_ITEMS,['Winebrary','Atlas','Grapes','Find My Wine','Wine History','Study Today','Pairings','Link Account']);
await G.clearPrivateGlasses();F.owner='catalog';
E.registerEventHandlers(bridge,'https://fixture.invalid/');
const click=async index=>{await wait(520);handler(index===undefined?{sysEvent:{}}:{listEvent:{currentSelectItemIndex:index}});await wait(230);await F.queue};
handler({textEvent:{eventType:2}});handler({textEvent:{eventType:2}});await F.queue;
assert.match(F.texts.filter(t=>t.containerName==='home-list').at(-1).content,/> Grapes/);
await click();await click(0);
// France offers multiple grapes and several wines per grape.
for(let i=0;i<C.COUNTRIES.Red.indexOf('France');i++)handler({textEvent:{eventType:2}});await wait(230);await click();
assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='grapes'));const grapes=C.getGrapesForCountry('Red','France');
const first=I.getWineId('Red','France',C.getWinesForGrape('Red','France',grapes[0])[0].name);assert.equal(F.images.at(-1).data[0],first);
handler({textEvent:{eventType:2}});await wait(230);const second=I.getWineId('Red','France',C.getWinesForGrape('Red','France',grapes[1])[0].name);assert.equal(F.images.at(-1).data[0],second);
handler({textEvent:{eventType:1}});await wait(230);await click();
assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='wines'));const catalog=C.getWinesForGrape('Red','France',grapes[0]);assert.ok(catalog.length>1);
const winePages=F.pages.length;handler({textEvent:{eventType:2}});await wait(230);assert.equal(F.pages.length,winePages);assert.equal(F.images.at(-1).data[0],I.getWineId('Red','France',catalog[1].name));await click();assert.ok(F.pages.at(-1).textObject.some(t=>t.containerName==='notes'));
handler({sysEvent:{eventType:3}});await wait(250);assert.match(F.pages.at(-1).textObject.find(t=>t.containerName==='wines').content,/\n>/,'Back restores the selected wine');
// Page constraints hold for every catalog grape/wine screen, including long labels.
for(const type of C.WINE_TYPES)for(const country of C.COUNTRIES[type]){validateGlassesPage(P.buildGrapeListPage(type,country));for(const grape of C.getGrapesForCountry(type,country))validateGlassesPage(P.buildWineListPage(type,country,grape));}
F.images=[];handler({textEvent:{eventType:2}});handler({sysEvent:{eventType:7}});await wait(250);assert.equal(F.images.length,0,'no delayed preview after exit');
console.log('PASS: continuous grouped View All, nonselectable dividers, empty library, compact home menu, swipe previews, first-row omission, vintages, pagination, rapid gestures, stale-image cancellation, grape previews, note selection/Back, exit and all catalog page bounds.');
