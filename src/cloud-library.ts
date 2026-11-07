import {cleanLocations,wineLocations,addLocation} from './saved-locations';
import {localWines,localStore,localCollection} from './beta/store';
import {queueWineSubmission} from './wine-contributions';
import {account} from './account-client';
import {ACCOUNT_URL,ACCOUNT_PUBLIC_KEY} from './account-config';
import {artworkStore,artworkOwner,blobData,bottlePhoto} from './artwork-store';
import {bottleImageUrl} from './bottle-assets';
import {lookupWineById,allCatalogWines} from './identity';
import type {LibraryWine} from './winebrary';
export const isGuestLibrary=()=>!artworkOwner()||artworkOwner()==='beta-local';
const norm=(v:unknown)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export async function canonicalWineId(w:any){
 const existing=lookupWineById(w.wine_id);if(existing)return existing.id;
 const producer=norm(w.producer);let name=norm(w.wine_name);if(producer&&name.startsWith(producer+' '))name=name.slice(producer.length+1);if(producer&&name.endsWith(' '+producer))name=name.slice(0,-producer.length-1);
 const catalog=allCatalogWines().find(e=>{const [n,p]=e.wine.name.split(' – ');return norm(n)===name&&norm(p)===producer});
 if(catalog)return catalog.id;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(producer+'|'+name));return 'discovery-'+[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function accountResearch(body:any,signal?:AbortSignal){
 const session=(await account.auth.getSession()).data.session;if(!session)throw Error('Link your account first.');
 let res:Response;
 try{res=await fetch(ACCOUNT_URL+'/functions/v1/winelens-research',{method:'POST',headers:{'Content-Type':'application/json',apikey:ACCOUNT_PUBLIC_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal});}
 catch(error){if(signal?.aborted)throw Error('Saving timed out. Retry Use This Photo; your selected cutout is kept.');throw Error('Could not reach your account’s bottle storage. Check your connection and retry Use This Photo. Your selected cutout is kept.');}
 const data=await res.json().catch(()=>({error:'Bottle storage returned an unreadable response. Retry saving your selected photo.'}));
 if((await account.auth.getSession()).data.session?.user.id!==session.user.id)throw Error('Account changed.');if(!res.ok)throw Error(data.error||'Could not save the bottle.');return data;
}
export async function cloudCollection(path:string,method='GET',body:any={}):Promise<any>{
 const session=(await account.auth.getSession()).data.session,owner=session?.user.id;if(!owner||artworkOwner()!==owner)throw Error('Link your account first.');
 const current=()=>{if(artworkOwner()!==owner)throw Error('Account changed.');};
 const check=(r:any)=>{current();if(r.error)throw r.error;return r.data;};
 const table=()=>account.from('user_collection');
 const decorate=async(w:any)=>{
  if(w.wine_id?.startsWith('community-')&&!lookupWineById(w.wine_id))await (await import('./shared-catalog')).refreshSharedCatalog();
  const file=w.metadata?.image_path;if(typeof file==='string'&&file.startsWith(owner+'/')){const signed=await account.storage.from('winelens-bottles').createSignedUrl(file,3600);w={...w,image_url:signed.data?.signedUrl};}
  else {const entry=lookupWineById(w.wine_id);if(entry?.legacyId)w={...w,image_url:bottleImageUrl('./',entry.legacyId)};else if(entry?.imageUrl)w={...w,image_url:entry.imageUrl};}current();return w;
 };
 if(path==='/api/bottle-image')return {draft:{path:body.data_url||'data:image/png;base64,'+body.png,url:body.data_url||'data:image/png;base64,'+body.png,source:'photograph'}};
 if(!path.startsWith('/api/collection'))throw Error('This account action is unavailable.');
 if(method==='GET'){
  await syncGuestWines(owner);current();
  const pending=(await localWines()).filter(w=>(w as any).sync_owner===owner&&!(w as any).cloud_id);
  const offline=async()=>{const cache=await artworkStore('get',owner+':collection');current();return {items:[...pending,...(cache?.items||[])],offline:true};};
  if(!navigator.onLine)return offline();
  const response=await table().select('*').eq('user_id',owner).order('created_at',{ascending:false}).limit(500);current();if(response.error){const backup=await offline();if(backup.items.length)return backup;throw response.error;}const rows=check(response);const items=await Promise.all(rows.map(decorate));current();await artworkStore('put',{id:owner+':collection',scope:owner,kind:'collection',items});return {items:[...pending,...items]};
 }
 const device=await localWines();const localId=method==='DELETE'?new URL(path,location.origin).searchParams.get('id'):body.id;
 if(method!=='POST'&&localId&&device.some(w=>w.id===localId&&(w as any).sync_owner===owner&&!(w as any).cloud_id))return localCollection(path,method,body);
 if(method==='POST'&&!navigator.onLine){const result=await localCollection(path,method,body);await localStore('wines','put',{...result.item,sync_owner:owner});return result;}
 if(method==='DELETE'){const id=new URL(path,location.origin).searchParams.get('id');check(await table().delete().eq('id',id!).eq('user_id',owner));const cache=await artworkStore('get',owner+':collection');if(cache)await artworkStore('put',{...cache,items:cache.items.filter((w:any)=>w.id!==id)});return {ok:true};}
 const previous=method==='PATCH'?check(await table().select('*').eq('id',body.id).eq('user_id',owner).single()):null;
 const metadata={...previous?.metadata,...body.metadata,...(typeof body.add_saved_location==='string'?addLocation(previous||{metadata:null},body.add_saved_location):{})};if('saved_locations' in metadata)metadata.saved_locations=cleanLocations(metadata.saved_locations);for(const k of ['vintage_state','country','grape','color','sake_classification','sake_style','rice_variety','image_source'])if(k in body)metadata[k]=body[k];
 // Private storage paths are only attached through the authenticated image endpoint.
 if(!previous)delete metadata.image_path;else metadata.image_path=previous.metadata?.image_path;
 const found=lookupWineById(body.wine_id||previous?.wine_id);if(found&&!metadata.tasting_notes)metadata.tasting_notes=[found.wine.nose,found.wine.palate,found.wine.finish].join('\n');if(found)metadata.reference_kind='catalogue';
 const row={user_id:owner,wine_name:body.wine_name??previous?.wine_name,producer:body.producer??previous?.producer??null,region:body.region??previous?.region??null,notes:body.notes??previous?.notes??'',vintage:body.vintage_state==='year'?Number(body.vintage):body.vintage_state?null:body.vintage??previous?.vintage??null,metadata,wine_id:body.wine_id??previous?.wine_id};
 if(!row.wine_name?.trim())throw Error('Enter a wine name.');row.wine_id=await canonicalWineId(row);current();
 async function mergeLocations(existing:any){if(!metadata.saved_locations?.length)return existing;return check(await table().update({metadata:{...existing.metadata,saved_locations:cleanLocations([...wineLocations(existing),...metadata.saved_locations])}}).eq('id',existing.id).eq('user_id',owner).select().single());}
 if(method!=='PATCH'){
  const found=check(await table().select('*').eq('user_id',owner).limit(500));
  const identities=await Promise.all(found.map((w:any)=>canonicalWineId(w)));current();
  const duplicate=found.find((w:any,i:number)=>identities[i]===row.wine_id&&w.vintage===row.vintage&&(w.metadata?.vintage_state==='non_vintage')===(metadata.vintage_state==='non_vintage'));
  if(duplicate){const merged=await mergeLocations(duplicate);await queueWineSubmission(merged,owner);return {item:await decorate(merged),duplicate:true};}
 }
 let saved=method==='PATCH'?await table().update(row).eq('id',body.id).eq('user_id',owner).select().single():await table().insert(row).select().single();
 if(saved.error?.code==='23505'&&method!=='PATCH'){const rows=check(await table().select('*').eq('user_id',owner).eq('wine_id',row.wine_id));const same=rows.find((w:any)=>w.vintage===row.vintage&&(w.metadata?.vintage_state==='non_vintage')===(metadata.vintage_state==='non_vintage'));if(same)return {item:await decorate(await mergeLocations(same)),duplicate:true};throw Error('This wine is already saved with an unconfirmed vintage. Edit its existing entry to confirm the vintage.');}
 let item=await decorate(check(saved));
 const remember=async()=>{const cached=await artworkStore('get',owner+':collection');current();await artworkStore('put',{id:owner+':collection',scope:owner,kind:'collection',items:[item,...(cached?.items||[]).filter((w:any)=>w.id!==item.id)]});};
 await remember();await queueWineSubmission(item,owner);
 if(typeof body.image_path==='string'&&body.image_path.startsWith('data:image/')){
  let photo=body.image_path;if(!photo.startsWith('data:image/png')){const {createBottleCutout,inlineBottle}=await import('./research/bottles');photo=await inlineBottle(await createBottleCutout(photo));}
  current();item=(await accountResearch({action:'attach_bottle',collection_id:item.id,expected:{wine_name:item.wine_name,producer:item.producer,vintage:item.vintage},photo,provenance:body.provenance||metadata.bottle_provenance})).item;
 }
 current();await remember();return {item};
}
export async function importGuestWine(w:LibraryWine){
 const result=await cloudCollection('/api/collection','POST',{...w,vintage_state:w.metadata?.vintage_state|| (w.vintage?'year':'unknown')});
 if(!result.item.metadata?.image_path&&w.image_url){let photo=w.image_url.startsWith('data:')?w.image_url:await blobData(await bottlePhoto(w.image_url));if(!photo.startsWith('data:image/png')){const {createBottleCutout,inlineBottle}=await import('./research/bottles');photo=await inlineBottle(await createBottleCutout(photo));}result.item=(await accountResearch({action:'attach_bottle',collection_id:result.item.id,expected:{wine_name:result.item.wine_name,producer:result.item.producer,vintage:result.item.vintage},photo,only_if_missing:true,provenance:w.metadata?.bottle_provenance})).item;}
 return result;
}

let importing:Promise<void>|undefined;
/** Pairing claims local wines once. Keep local copies, never silently import them into another account. */
export function syncGuestWines(owner:string){
 if(importing)return importing;
 importing=(async()=>{if(!navigator.onLine)return;for(const wine of await localWines()){
  if(artworkOwner()!==owner)return;
  const record=wine as any;if(record.cloud_id||(record.sync_owner&&record.sync_owner!==owner))continue;
  try{
   const claimed={...wine,sync_owner:owner};await localStore('wines','put',claimed);
   const result=await importGuestWine(claimed);if(artworkOwner()!==owner)return;
   await localStore('wines','put',{...claimed,cloud_id:result.item.id});
  }catch(error){console.warn('[sommNI] Device wine sync pending:',error); /* Keep this device wine visible and retry on the next refresh. */ }
 }})().finally(()=>{importing=undefined});return importing;
}
