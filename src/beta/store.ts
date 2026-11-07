import { bottleImageUrl } from '../bottle-assets';
import { backupDeviceWine, recoverDeviceWines } from './device-wines';
import { artworkOwner, bottlePhoto, blobData } from '../artwork-store';
import type { LibraryWine } from '../winebrary';
import { lookupWineById } from '../identity';
const databases=new Map<string,Promise<IDBDatabase>>();
function database(scope='guest'){if(!databases.has(scope))databases.set(scope,new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open(scope==='guest'?'winelens-free-beta':'sommni-drafts-'+scope,1);
 request.onupgradeneeded=()=>{request.result.createObjectStore('wines',{keyPath:'id'});request.result.createObjectStore('drafts',{keyPath:'id'});request.result.createObjectStore('audio',{keyPath:'id'});};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Device storage is unavailable. Enable storage to save wines.'));
}));return databases.get(scope)!;}
async function idbStore<T=any>(store:string,action:'get'|'getAll'|'put'|'delete',value?:any):Promise<T>{
 const scope=store==='wines'?'guest':artworkOwner()||'beta-local';
 const db=await database(scope==='beta-local'?'guest':scope);
 return new Promise((resolve,reject)=>{const tx=db.transaction(store,action==='get'||action==='getAll'?'readonly':'readwrite');const request=(tx.objectStore(store)[action] as any).call(tx.objectStore(store),value);let result:T;request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('Could not save on this device. Your storage may be full.'));});
}
let wineWrites:Promise<unknown>=Promise.resolve();
export async function localStore<T=any>(store:string,action:'get'|'getAll'|'put'|'delete',value?:any):Promise<T>{
 if(store!=='wines')return idbStore<T>(store,action,value);
 if(action==='get'||action==='getAll'){
  await wineWrites.catch(()=>{});
  const rows=await recoverDeviceWines(await idbStore<LibraryWine[]>('wines','getAll').catch(()=>[]));
  return (action==='getAll'?rows:rows.find(w=>w.id===value)) as T;
 }
 const operation=wineWrites.catch(()=>{}).then(async()=>{
  const result=await idbStore<T>(store,action,value);
  await backupDeviceWine(action==='put'?value:undefined,action==='put'?value.id:value);
  if(action==='put')await (await import('../wine-contributions')).queueWineSubmission(value,'beta-local');
  return result;
 });wineWrites=operation;return operation;
}
/** Serialize the read and write, including the native backup, so late artwork cannot overwrite a manual photo. */
export async function updateLocalWine(id:string,update:(wine:any)=>any):Promise<any>{
 const operation=wineWrites.catch(()=>{}).then(async()=>{
  const rows=await recoverDeviceWines(await idbStore<LibraryWine[]>('wines','getAll').catch(()=>[]));
  const result=update(rows.find(w=>w.id===id));await idbStore('wines','put',result);await backupDeviceWine(result);
  await (await import('../wine-contributions')).queueWineSubmission(result,'beta-local');return result;
 });wineWrites=operation;return operation;
}
export async function localWines():Promise<LibraryWine[]>{return (await localStore<any[]>('wines','getAll')).sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));}
export async function localCollection(path:string,method:string,body:any={}) {
 if(path.startsWith('/api/collection')) {
  if(method==='GET')return {items:await localWines()};
  if(method==='DELETE'){const id=new URL(path,location.origin).searchParams.get('id');await localStore('wines','delete',id);await localStore('audio','delete',id);return {ok:true};}
  const previous=method==='PATCH'?await localStore<LibraryWine>('wines','get',body.id):null;
  if(method==='PATCH'&&!previous)throw new Error('This wine is no longer saved on this device.');
  const found=lookupWineById(body.wine_id||previous?.wine_id);
  const metadata={...previous?.metadata,...body.metadata};
  for(const key of ['vintage_state','country','grape','color','sake_classification','sake_style','rice_variety','image_source'])if(key in body)metadata[key]=body[key];
  if(found&&!metadata.tasting_notes)metadata.tasting_notes=[found.wine.nose,found.wine.palate,found.wine.finish].join('\n');
  if(found)metadata.reference_kind='catalogue';
  const item={...previous,id:previous?.id||crypto.randomUUID(),wine_name:body.wine_name??previous?.wine_name,producer:body.producer??previous?.producer??null,region:body.region??previous?.region??null,vintage:body.vintage_state==='year'?Number(body.vintage):body.vintage_state?null:previous?.vintage??null,notes:body.notes??previous?.notes??'',wine_id:body.wine_id??previous?.wine_id,metadata,updated_at:new Date().toISOString(),image_url:body.image_path??previous?.image_url??(found?.legacyId ? bottleImageUrl('./',found.legacyId) : undefined)};
  if(!item.wine_name?.trim())throw new Error('Enter a wine name.');
  if(item.image_url&&!item.image_url.startsWith('data:')){try{item.image_url=await blobData(await bottlePhoto(item.image_url));}catch{/* Keep the reference and let the artwork status explain offline availability. */}}
  if(!previous)await (await import('../bottle-allowance')).checkBottleAllowance(item);
  await localStore('wines','put',item);return {item};
 }
 if(path==='/api/bottle-image')return {draft:{path:body.data_url,url:body.data_url,source:'photograph'}};
 throw new Error('This service is not available in this beta.');
}
