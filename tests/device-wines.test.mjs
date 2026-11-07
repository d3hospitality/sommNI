import {build} from 'esbuild';
import assert from 'node:assert/strict';
const native=new Map(),browser=new Map();let failAt=-1,writes=0;
globalThis.window={flutter_inappwebview:{callHandler(){}}};
globalThis.localStorage={getItem:k=>browser.get(k)||null,setItem:(k,v)=>browser.set(k,v)};
globalThis.__bridge={getLocalStorage:async k=>native.get(k)||'',setLocalStorage:async(k,v)=>{if(++writes===failAt)return false;native.set(k,v);return true;}};
const output=await build({entryPoints:['src/beta/device-wines.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'bridge',setup(b){b.onResolve({filter:/^@evenrealities/},()=>({path:'sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const waitForEvenAppBridge=async()=>globalThis.__bridge;'}))}}]});
const source='data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64');
let lib=await import(source+'#first');
const wine={id:'machete',wine_name:'Machete',producer:'Orin Swift',vintage:2022,notes:'private observations',metadata:{color:'Red'},image_url:'data:image/png;base64,'+'a'.repeat(140000)};
await lib.backupDeviceWine(wine);
// New module + empty browser storage models restarting/replacing the Even WebView origin.
lib=await import(source+'#restart');assert.deepEqual(await lib.recoverDeviceWines([]),[wine]);
const pointer=native.get('sommni-device-wines-v2');failAt=writes+2;
await assert.rejects(lib.backupDeviceWine({...wine,notes:'incomplete'}),/backup failed/);
assert.equal(native.get('sommni-device-wines-v2'),pointer);assert.equal((await lib.recoverDeviceWines([]))[0].notes,'private observations');
failAt=-1;await lib.backupDeviceWine(undefined,wine.id);assert.deepEqual(await lib.recoverDeviceWines([wine]),[]);
await Promise.all([lib.backupDeviceWine({...wine,id:'a'}),lib.backupDeviceWine({...wine,id:'b'})]);assert.equal((await lib.recoverDeviceWines([])).length,2);
// Older releases had only a native text snapshot; recover it without erasing anything.
native.clear();native.set('winelens_library_cache_v1',JSON.stringify({userId:'beta-local',savedAt:'2026-10-20',items:[wine]}));assert.deepEqual(await lib.recoverDeviceWines([]),[wine]);
window.flutter_inappwebview=undefined;await lib.backupDeviceWine(wine);lib=await import(source+'#browser-reopen');assert.equal((await lib.recoverDeviceWines([]))[0].id,'machete');
console.log('PASS native WebView restart, full photo recovery, interrupted-write atomicity, deletion tombstone, concurrent writes, old cache recovery, browser reload.');
