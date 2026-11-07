import { artworkStore } from './artwork-store';
import { registerSharedWines } from './identity';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from './account-config';
let running:Promise<void>|undefined,last=0;
export function refreshSharedCatalog(){
 if(running)return running;
 running=(async()=>{
  if(!navigator.onLine)return;
  const rows:any[]=[];let after:string|null=null;
  do{
   const response:Response=await fetch(ACCOUNT_URL+'/functions/v1/winelens-beta',{method:'POST',headers:{'Content-Type':'application/json',apikey:ACCOUNT_PUBLIC_KEY},body:JSON.stringify({action:'shared_catalog',after}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Shared catalog refresh paused.');const data:{items:any[];next:string|null}=await response.json();rows.push(...data.items);after=data.next;
  }while(after);
  await artworkStore('put',{id:'catalog:community',scope:'catalog',kind:'catalog',items:rows});registerSharedWines(rows);last=Date.now();window.dispatchEvent(new Event('sommni-catalog-updated'));
 })().catch(error=>console.warn('[sommNI catalog]',error)).finally(()=>{running=undefined});return running;
}
export async function initSharedCatalog(){
 const saved=await artworkStore('get','catalog:community').catch(()=>null);if(saved?.items){registerSharedWines(saved.items);window.dispatchEvent(new Event('sommni-catalog-updated'));}
 void refreshSharedCatalog();window.addEventListener('online',()=>void refreshSharedCatalog());
 window.addEventListener('sommni-contribution-status',()=>{if(Date.now()-last>5000)void refreshSharedCatalog();});
 setInterval(()=>{if(!document.hidden)void refreshSharedCatalog();},60000);
}
