import { BOTTLE_ASSET_VERSION } from './bottle-assets';
/** Persistent bottle assets and a public-wine submission outbox; private keys are account-scoped. */
let opening:Promise<IDBDatabase>|undefined;
let owner:string|null=null;
export const setArtworkOwner=(value:string|null)=>{owner=value};
export const artworkOwner=()=>owner;
export async function artworkStore<T=any>(action:'get'|'getAll'|'put'|'delete',value?:any):Promise<T>{
 if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sommni-artwork',1);r.onupgradeneeded=()=>r.result.createObjectStore('assets',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Bottle storage is unavailable on this device.'));}).catch(e=>{opening=undefined;throw e});
 const db=await opening;return new Promise((resolve,reject)=>{const tx=db.transaction('assets',action==='get'||action==='getAll'?'readonly':'readwrite'),r=(tx.objectStore('assets')[action] as any)(value);let result:T;r.onsuccess=()=>{result=r.result};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('Could not save bottle artwork. Device storage may be full.'));});
}
export const artworkHash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function bottleCacheKey(source:string):Promise<string|null>{
 const scope=owner;if(source.startsWith('data:image/')){const hash=await artworkHash(source);return scope&&scope===owner?`${scope}:photo:${hash}`:null;}
 try{const u=new URL(source,location.href);if(u.origin==='https://mcmtasetompygfktzhpr.supabase.co'&&u.pathname.startsWith('/storage/v1/object/sign/sommni-master-bottles/'))return 'community-photo:'+u.pathname;const base=new URL(import.meta.env.BASE_URL,location.href);if(u.origin===base.origin&&new RegExp('^'+base.pathname.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'bottles/w\\d+\\.png$').test(u.pathname)){const version=u.searchParams.get('v')||BOTTLE_ASSET_VERSION;u.hash='';u.search='';u.searchParams.set('v',version);return 'catalog:'+u.href;}}catch{}
 return null;
}
export async function bottlePhoto(source:string):Promise<Blob>{
 const scope=owner,key=await bottleCacheKey(source);
 const prior=key?await artworkStore('get',key).catch(()=>null):null;if(prior?.blob)return prior.blob;
 const response=await fetch(key?.startsWith('catalog:')?key.slice(8):source);if(!response.ok)throw Error('Bottle photograph unavailable');const blob=await response.blob();
 if(key&&(key.startsWith('catalog:')||key.startsWith('community-photo:')||scope===owner))await artworkStore('put',{id:key,kind:'photo',scope:key.startsWith('catalog:')||key.startsWith('community-photo:')?'catalog':scope,blob}).catch(()=>{});
 return blob;
}
export async function clearArtworkOwner(scope:string){
 if(owner===scope)owner=null;
 for(const row of await artworkStore<any[]>('getAll'))if(row.scope===scope&&row.kind!=='submission')await artworkStore('delete',row.id);
}
export const blobData=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('Could not read bottle image.'));r.readAsDataURL(blob)});
/** Handles expiring account URLs without ever sharing them or keeping another account's pixels. */
export async function localWineArtwork<T extends {id:string;image_url?:string;metadata:any}>(wine:T,scope:string,cacheOnly=false):Promise<T>{
 if(owner!==scope||(!wine.image_url&&!wine.metadata?.image_path))return wine;
 const source=wine.image_url,version=wine.metadata?.image_path||(source?await artworkHash(source):null),id=`${scope}:wine:${wine.id}`;
 const prior=await artworkStore('get',id);let data=prior&&(prior.version===version||source===prior.data)?prior.data:null;
 if(!data){if(cacheOnly||!source)return wine;data=await blobData(await bottlePhoto(source));if(owner!==scope)return wine;await artworkStore('put',{id,kind:'wine',scope,version,data});}
 return {...wine,image_url:data};
}
/** Resolve ordinary catalog <img> elements through the same persisted photos as the G2 renderer. */
export function initOfflineBottleImages(){
 const attach=(img:HTMLImageElement)=>{const source=img.getAttribute('src')||'';if(!/\/bottles\/w\d+\.png|^\.\/bottles\/w\d+\.png/.test(source))return;if(img.dataset.offlineBottle===source)return;img.dataset.offlineBottle=source;
  void bottleCacheKey(source).then(async key=>{if(!key)return;const blob=await bottlePhoto(source);if(img.getAttribute('src')===source)img.src=await blobData(blob);}).catch(()=>{});
 };
 const scan=(node:Node)=>{if(node instanceof HTMLImageElement)attach(node);if(node instanceof Element)node.querySelectorAll('img').forEach(attach)};
 scan(document.documentElement);new MutationObserver(records=>records.forEach(r=>{if(r.type==='attributes')scan(r.target);else r.addedNodes.forEach(scan)})).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
}
