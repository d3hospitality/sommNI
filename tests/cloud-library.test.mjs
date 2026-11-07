import {build} from 'esbuild';
import assert from 'node:assert/strict';
let localRows=[],cache=new Map(),submitted=[];
let owner='owner',session={user:{id:'owner'},access_token:'test'},rows=[],signed=[],race=false,changeOnRead=false;
const q=()=>{const filters=[];let action='select',payload;const query={select(){return query},eq(k,v){filters.push(r=>r[k]===v);return query},order(){return query},limit(){return query},insert(v){action='insert';payload=v;return query},update(v){action='update';payload=v;return query},delete(){action='delete';return query},single(){return run(true)},then(a,b){return run(false).then(a,b)}};
 async function run(single){let result=rows.filter(r=>filters.every(f=>f(r)));if(action==='insert'){const row={id:crypto.randomUUID(),...structuredClone(payload)};rows.push(row);if(race){race=false;return {error:{code:'23505'}}}result=[row];}if(action==='update')for(const r of result)Object.assign(r,payload);if(action==='delete')rows=rows.filter(r=>!result.includes(r));if(changeOnRead){owner='other';changeOnRead=false}return {data:structuredClone(single?result[0]:result)}}return query;};
globalThis.__cloudFixture={account:{auth:{getSession:async()=>({data:{session}})},from:q,storage:{from:()=>({createSignedUrl:async path=>{signed.push(path);return {data:{signedUrl:'https://example.com/'+path}}}})}},artworkOwner:()=>owner,artworkStore:async(action,value)=>{if(action==='get')return cache.get(value);if(action==='put')cache.set(value.id,value);},localWines:async()=>structuredClone(localRows),localStore:async(store,action,value)=>{if(action==='put'){localRows=localRows.filter(w=>w.id!==value.id);localRows.push(structuredClone(value));}},queueWineSubmission:async(w,scope)=>{submitted.push({id:w.id,scope});}};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});globalThis.location={origin:'http://localhost'};
const bundle=await build({entryPoints:['src/cloud-library.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^\.\/(account-client|account-config|artwork-store|identity|beta\/store|wine-contributions)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='./beta/store'?'export const {localWines,localStore}=globalThis.__cloudFixture;export const localCollection=()=>{throw Error("Unexpected local write")};':a.path==='./wine-contributions'?'export const {queueWineSubmission}=globalThis.__cloudFixture;':a.path==='./account-client'?'export const account=globalThis.__cloudFixture.account;':a.path==='./account-config'?"export const ACCOUNT_URL='https://example.com',ACCOUNT_PUBLIC_KEY='public';":a.path==='./identity'?'export const registerSharedWines=()=>{};export const lookupWineById=id=>(globalThis.__catalogFixture||[]).find(w=>w.id===id||w.legacyId===id)||null,allCatalogWines=()=>globalThis.__catalogFixture||[];':'export const {artworkOwner,artworkStore}=globalThis.__cloudFixture;export const blobData=()=>{},bottlePhoto=()=>{};',loader:'js'}));b.onResolve({filter:/^\.\/research\/bottles$/},()=>({path:'cutout',namespace:'fixture-cutout'}));b.onLoad({filter:/.*/,namespace:'fixture-cutout'},()=>({contents:"export const createBottleCutout=async()=>({url:'https://example.com/cutout.png'});export const inlineBottle=async draft=>{if(draft.url!=='https://example.com/cutout.png')throw Error('Unexpected image');return 'data:image/png;base64,fixture'};",loader:'js'}));}}]});
const {cloudCollection,canonicalWineId,importGuestWine,syncGuestWines}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const a={wine_name:'Estate Reserve',producer:'Estate',vintage:2020,vintage_state:'year',notes:'my notes',metadata:{tasting_notes:'reference notes',image_path:'other/private.png'}};
assert.equal(await canonicalWineId(a),await canonicalWineId({...a,wine_name:'Réserve'}));
const first=await cloudCollection('/api/collection','POST',a);assert.equal(first.item.user_id,'owner');assert.equal(first.item.metadata.image_path,undefined);assert.equal(signed.length,0);
const duplicate=await cloudCollection('/api/collection','POST',a);assert(duplicate.duplicate);assert.equal(duplicate.item.id,first.item.id);assert.equal(rows.length,1);
await cloudCollection('/api/collection','POST',{...a,vintage:2021});assert.equal(rows.length,2);
race=true;assert((await cloudCollection('/api/collection','POST',{...a,vintage:2022})).duplicate);assert.equal(rows.length,3);
const guest={...a,id:'guest-local-id',image_url:null,metadata:{vintage_state:'year',tasting_notes:'guest reference'}};const untouched=structuredClone(guest);await importGuestWine(guest);assert.deepEqual(guest,untouched);assert.equal(rows.length,3);assert.equal(rows[0].notes,'my notes');
rows.push({id:'private',user_id:'other',wine_id:'other',wine_name:'secret',metadata:{image_path:'other/private.png'}});
assert.equal((await cloudCollection('/api/collection')).items.length,3);assert.equal(signed.length,0);
changeOnRead=true;await assert.rejects(cloudCollection('/api/collection'),/Account changed/);
owner='beta-local';await assert.rejects(cloudCollection('/api/collection'),/Link your account/);
owner='owner';session=null;await assert.rejects(cloudCollection('/api/collection'),/Link your account/);
console.log('PASS: canonical producer/name; preserved vintages; duplicate/race reuse; private-path rejection; local import preserved; account filtering and account-change guard.');

// Website -> account collection -> companion photo: keep canonical IDs and exact reference text.
owner='owner';session={user:{id:'owner'},access_token:'test'};
globalThis.__catalogFixture=[{id:'wl_shared',legacyId:'w0',wine:{name:'Estate Reserve – Estate',nose:'Fresh fruit',palate:'Dry',finish:'Long'}}];
rows=[{id:'website-save',user_id:'owner',wine_id:'wl_shared',wine_name:'Estate Reserve',producer:'Estate',vintage:null,notes:'',metadata:{country:'Italy',color:'Red',tasting_notes:'Website reference notes'}}];
const websiteWine=(await cloudCollection('/api/collection')).items[0];
assert.equal(websiteWine.image_url,'./bottles/w0.png?v=photographic-v3');assert.equal(websiteWine.metadata.tasting_notes,'Website reference notes');assert.equal(websiteWine.metadata.country,'Italy');
assert.equal(await canonicalWineId({wine_id:'w0'}),'wl_shared');
rows.push({id:'website-photo',user_id:'owner',wine_id:'discovery-new',wine_name:'New bottle',metadata:{image_path:'owner/bottle.png',tasting_notes:'Bottle-specific reference'}});
const custom=(await cloudCollection('/api/collection')).items.find(w=>w.id==='website-photo');assert.equal(custom.image_url,'https://example.com/owner/bottle.png');assert.equal(custom.metadata.tasting_notes,'Bottle-specific reference');
console.log('PASS: website catalog saves resolve the bundled photographic asset; legacy IDs canonicalize; custom account photos receive owner-scoped signed URLs; notes and origin survive the handoff.');

localRows=[{id:'guest-recover',wine_name:'Recovered wine',producer:'Estate',vintage:2023,notes:'my observation',metadata:{vintage_state:'year',color:'Red'}}];
await cloudCollection('/api/collection');assert(localRows[0].cloud_id);assert.equal(localRows[0].sync_owner,'owner');const count=rows.length;await cloudCollection('/api/collection');assert.equal(rows.length,count);
const restored=rows.find(w=>w.id===localRows[0].cloud_id);assert.equal(restored.notes,'my observation');assert(submitted.some(w=>w.id===restored.id));
owner='other';session={user:{id:'other'},access_token:'test'};await syncGuestWines('other');assert.equal(rows.length,count,'claimed guest wines do not cross accounts');
console.log('PASS: guest import keeps local backup and personal notes, submits public facts, repeats safely, and never imports into a second account.');

// A hosted cutter returns a URL; attachment requires inline PNG, including pairing imports.
owner='owner';session={user:{id:'owner'},access_token:'test'};
const attachmentRequests=[];
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);attachmentRequests.push(body);assert.equal(body.photo,'data:image/png;base64,fixture');const item=rows.find(w=>w.id===body.collection_id);item.metadata={...item.metadata,image_path:'owner/saved.png'};return {ok:true,json:async()=>({item:{...item,image_url:'https://example.com/saved.png'}})};};
const uploaded=await cloudCollection('/api/collection','PATCH',{id:rows[0].id,image_path:'data:image/jpeg;base64,original'});
assert.equal(uploaded.item.image_url,'https://example.com/saved.png');
const imported=await importGuestWine({id:'photo-guest',wine_name:'Guest photo wine',producer:'Estate',vintage:2024,metadata:{},image_url:'data:image/jpeg;base64,original'});
assert.equal(imported.item.image_url,'https://example.com/saved.png');assert.equal(attachmentRequests.length,2);
console.log('PASS: camera JPEG and guest import inline hosted cutouts before attachment; returned wines include the saved image.');
