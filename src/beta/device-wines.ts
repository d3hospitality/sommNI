import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { LibraryWine } from '../winebrary';

type Record = { id:string; updated:string; wine?:LibraryWine };
const KEY='sommni-device-wines-v2';
let chain:Promise<unknown>=Promise.resolve();
const embedded=()=>typeof (window as any).flutter_inappwebview?.callHandler==='function';
const parse=(text:string|null):Record[]=>{if(!text)return [];const data=JSON.parse(text);if(!Array.isArray(data))throw Error('Device Winebrary backup is unreadable. Export it before resetting storage.');return data;};
async function read():Promise<Record[]>{
 if(embedded()){
  const bridge=await waitForEvenAppBridge(),manifest=await bridge.getLocalStorage(KEY);
  if(manifest){const {prefix,count}=JSON.parse(manifest);if(typeof prefix!=='string'||!Number.isInteger(count)||count<1||count>2000)throw Error('Device Winebrary backup is incomplete.');let text='';for(let i=0;i<count;i++)text+=await bridge.getLocalStorage(prefix+':'+i);return parse(text);}
  // Recover the previous build's native text snapshot when its WebView database vanished.
  const old=await bridge.getLocalStorage('winelens_library_cache_v1');
  if(old){const data=JSON.parse(old);if(data?.userId==='beta-local'&&Array.isArray(data.items))return data.items.map((wine:LibraryWine)=>({id:wine.id,updated:data.savedAt||'',wine}));}
 }
 return parse(localStorage.getItem(KEY));
}
async function write(rows:Record[]){
 const text=JSON.stringify(rows);
 if(embedded()){
  const bridge=await waitForEvenAppBridge(),prefix=KEY+':'+crypto.randomUUID(),count=Math.max(1,Math.ceil(text.length/48000));
  const old=await bridge.getLocalStorage(KEY);
  for(let i=0;i<count;i++)if(!await bridge.setLocalStorage(prefix+':'+i,text.slice(i*48000,(i+1)*48000)))throw Error('Wine saved in browser storage, but Even device backup failed. Keep the app open and retry.');
  if(!await bridge.setLocalStorage(KEY,JSON.stringify({prefix,count})))throw Error('Even device backup could not be committed. Retry saving.');
  // Pointer commits last: a closed WebView can never replace the last complete snapshot with half a bottle.
  if(old){try{const prior=JSON.parse(old);for(let i=0;i<prior.count;i++)await bridge.setLocalStorage(prior.prefix+':'+i,'');}catch{}}
 }else localStorage.setItem(KEY,text);
}
export async function recoverDeviceWines(existing:LibraryWine[]):Promise<LibraryWine[]>{
 await chain.catch(()=>{});const backup=await read(),map=new Map(existing.map(w=>[w.id,w]));
 for(const row of backup){const local=map.get(row.id);if(!local||row.updated>=String((local as any).updated_at||'')){if(row.wine)map.set(row.id,row.wine);else map.delete(row.id);}}
 return [...map.values()];
}
export function backupDeviceWine(wine:LibraryWine|undefined,id=wine!.id){
 const operation=chain.catch(()=>{}).then(async()=>{const rows=await read(),record={id,updated:new Date().toISOString(),...(wine?{wine}: {})};await write([...rows.filter(w=>w.id!==id),record]);});chain=operation;return operation;
}
