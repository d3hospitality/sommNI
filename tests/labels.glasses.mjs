import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {LabelQueue} from '../src/research/label-queue.ts';
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.readyState='loading';
const pages=[],photos=[],text=[],listeners=[];let saved=[],searches=0,backs=0;
const tick=()=>new Promise(r=>setTimeout(r,15));
const s=new LabelQueue([{id:'a',wine_name:'Bottle A',producer:'Estate',vintage:2020}],{current:()=>true,changed:()=>listeners.forEach(f=>f()),search:async()=>{searches++;return [1,2,3].map(i=>({id:String(i),photo:'photo'+i,provenance:{}}));},polish:async p=>({url:p.photo+'-cut'}),save:async(w,d)=>{saved.push(d.url);return w}});
globalThis.labelFixture={s,listeners,pages,photos,text,back:()=>backs++};
const mocks={
 './label-session':`export const labelSession=()=>labelFixture.s;export const startLabels=()=>{};export const labelProgress=()=> '1/1 searched';export const subscribeLabels=f=>labelFixture.listeners.push(f)`,
 '../display':`export const claimDisplay=async()=>{};export const dropDisplay=()=>{}`,
 '../winebrary-glasses':`export const openLibraryOnGlasses=async()=>labelFixture.back();export const readLibrary=()=>({items:[]})`,
 '../image-utils':`import {validateGlassesPage} from ${JSON.stringify(resolve('src/glasses-page.ts'))};export const rebuildGlassesPage=async(b,p)=>{validateGlassesPage(p);labelFixture.pages.push(p);return true};export const pushBottlePhoto=async(b,p)=>labelFixture.photos.push(p);export const invalidateImages=()=>{};export const imageIdle=async()=>{};export const sendSerial=async f=>f()`,
};
const dir=await mkdtemp(tmpdir()+'/sommni-label-g2-');await build({entryPoints:['src/research/label-glasses.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/test.mjs',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd(),loader:'ts'}));}}]});
const g=await import(dir+'/test.mjs');g.connectLabelGlasses({textContainerUpgrade:async p=>{text.push(p.content);return true}});s.start();await tick();await g.openLabelGlasses();await tick();
assert.deepEqual(g.labelActions(s).slice(1,4),['View photo 1 of 3','View photo 2 of 3','View photo 3 of 3']);
assert.equal(pages.at(-1).listObject[0].itemContainer.itemCount,7);assert.equal(photos.at(-1),'photo1');
await new Promise(r=>setTimeout(r,360));const count=pages.length;g.handleLabelGlasses({listEvent:{currentSelectItemIndex:3}});await tick();assert.equal(s.current.choice,2);assert.equal(photos.at(-1),'photo3');assert.equal(pages.length,count,'choice updates image/status without rebuilding and resetting list focus');assert.equal(saved.length,0);
g.handleLabelGlasses({listEvent:{}});await tick();assert.deepEqual(saved,['photo3-cut'],'omitted protobuf index 0 uses the reviewed third photo');
await new Promise(r=>setTimeout(r,360));g.handleLabelGlasses({listEvent:{currentSelectItemIndex:4}});await tick();assert.equal(searches,2);assert.equal(s.current.work,'idle');
g.pauseLabelGlasses();const before=photos.length;g.handleLabelGlasses({listEvent:{currentSelectItemIndex:2}});await tick();assert.equal(photos.length,before);await g.resumeLabelGlasses();
s.acceptSaved({id:'a',wine_name:'Bottle A',image_url:'phone-upload-cutout'});await tick();assert.equal(photos.at(-1),'phone-upload-cutout','phone upload reaches the active glasses review');assert.equal(g.labelActions(s)[0],'Saved · next wine');
g.handleLabelGlasses({sysEvent:{eventType:3}});await tick();assert.equal(backs,1);assert.equal(g.handleLabelGlasses({sysEvent:{}}),false);
console.log('PASS: G2 page limits, three numbered photos, correct selected-image save, no rebuild on photo switch, search again, pause/resume, double-tap back.');
