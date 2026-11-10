import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/research/scan-save.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'scan-save-fixtures',setup(b){
 b.onResolve({filter:/^\.\.?\//},a=>a.importer.endsWith('scan-save.ts')?{path:a.path,namespace:'fixture'}:null);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('client')?'export const researchAction=(...args)=>globalThis.fixture.action(...args)':a.path.endsWith('artwork-store')?'export const artworkOwner=()=>globalThis.fixture.owner':a.path.endsWith('wine-contributions')?'export const queueWineSubmission=(...a)=>globalThis.fixture.queue(...a);export const finishWineArtwork=(...a)=>globalThis.fixture.finish(...a)':'export const createBottleCutout=(...a)=>globalThis.fixture.cutout(...a);export const inlineBottle=async b=>b.url;export const bottleIdentity=w=>({wine_name:w.wine_name,producer:w.producer,vintage:w.vintage})'}));
}}]});
const {saveScannedWine}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.window={dispatchEvent(){}};
const draft={id:'scan',result:{wine_name:'Estate',producer:'Maker',vintage:2020,vintage_state:'year',tasting_notes:'Reference notes'}};
let calls=[];
function setup({duplicate=false,photo=false,cutoutFail=false,attachFail=false,confirmFail=false,changeAccount=false}={}){
 calls=[];const item={id:'wine',wine_name:'Estate',producer:'Maker',vintage:2020,...(photo?{image_url:'existing.png'}:{})};
 globalThis.fixture={owner:'guest',action:async body=>{calls.push(body);if(body.action==='confirm'){if(confirmFail)throw Error('Offline');return {item,duplicate}}if(attachFail)throw Error('Image upload interrupted');return {item:{...item,image_url:body.photo}}},queue:async()=>{calls.push('queued');return 'Shared upload queued.'},finish:async()=>{calls.push('artwork-queued');return 'Artwork queued.'},cutout:async()=>{calls.push('cutout');if(changeAccount)globalThis.fixture.owner='different';if(cutoutFail)throw Error('Model unavailable');return {url:'transparent.png',provenance:{pipeline:'cutout'}}}};
}
setup();let result=await saveScannedWine(draft,'original.png',()=>{});assert.equal(calls[0].action,'confirm');assert.equal(calls[0].confirmed,true);assert.equal(calls[1],'queued');assert.equal(calls[3].action,'attach_bottle');assert.equal(calls[3].photo,'transparent.png');assert.equal(calls[3].only_if_missing,true);assert.equal(calls[4],'artwork-queued');assert.equal(result.item.image_url,'transparent.png');
setup({duplicate:true,photo:true});result=await saveScannedWine(draft,'original.png',()=>{});assert(result.duplicate);assert(!calls.includes('cutout'));assert.equal(result.item.image_url,'existing.png');
setup({cutoutFail:true});result=await saveScannedWine(draft,'original.png',()=>{});assert.equal(result.item.image_url,'original.png');assert.match(result.message,/Original photo retained/);
setup({attachFail:true});result=await saveScannedWine(draft,'original.png',()=>{});assert.match(result.message,/Saved to your Winebrary/);assert.match(result.message,/Image upload interrupted/);assert(calls.includes('queued'));
setup({confirmFail:true});await assert.rejects(saveScannedWine(draft,'original.png',()=>{}),/Offline/);assert.equal(calls.length,1);
setup({changeAccount:true});result=await saveScannedWine(draft,'original.png',()=>{});assert.match(result.message,/Account changed/);assert(!calls.some(c=>c.action==='attach_bottle'));
console.log('PASS: explicit approval, confirm before image work, durable contribution queue, duplicate photo protection, original-photo fallback, partial-save messaging, and account isolation.');
