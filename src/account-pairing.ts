import {account,accountAction,embeddedHost} from './account-client';
import {ACCOUNT_SITE} from './account-config';
import {waitForEvenAppBridge} from '@evenrealities/even_hub_sdk';
import {localWines} from './beta/store';
import {syncGuestWines} from './cloud-library';
const key='sommni-pending-pair-v1';
export type PendingPair={id:string;proof:string;code:string;expires_at:string};
let pending:PendingPair|null=null,running=false,ready=false;let listener:((message:string)=>void)|null=null;
async function exportDeviceLibrary(){const wines=await localWines();const url=URL.createObjectURL(new Blob([JSON.stringify({format:1,app:'sommNI',exported_at:new Date().toISOString(),wines},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='sommNI-device-winebrary.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function stored(value?:PendingPair|null){
 if(value!==undefined){const text=value?JSON.stringify(value):'';if(embeddedHost()&&!await (await waitForEvenAppBridge()).setLocalStorage(key,text))throw Error('Could not save the pairing request on this device. Please retry.');if(text)localStorage.setItem(key,text);else localStorage.removeItem(key);return value;}
 let text=localStorage.getItem(key);if(embeddedHost())text=await (await waitForEvenAppBridge()).getLocalStorage(key)||text;
 try{return text?JSON.parse(text) as PendingPair:null}catch{return null}
}
export async function beginPairing(fresh=false):Promise<PendingPair>{
 if(!ready){pending=await stored();ready=true;}
 if(fresh||!pending||Date.parse(pending.expires_at)<=Date.now()){pending=await accountAction<PendingPair>('link',{action:'start'},true);await stored(pending);}
 void pollPairing();return pending!;
}
export async function pollPairing(){
 if(running)return;running=true;
 try{
  if(!ready){pending=await stored();ready=true;}
  if(pending){
   if(Date.parse(pending.expires_at)<=Date.now()){listener?.('Code expired. Choose New code.');return;}
   const p=pending;

   const result=await accountAction('link',{action:'poll',id:p.id,proof:p.proof},true);
   if(pending?.id!==p.id)return;
   if(result.status==='linked'){pending=null;await stored(null);listener?.('This code was already used. Choose New code to connect again.');return;}
   if(result.status==='approved'&&result.token_hash){
    const {error}=await account.auth.verifyOtp({token_hash:result.token_hash,type:'email'});if(error)throw Error('Could not finish sign-in: '+error.message);
    await accountAction('link',{action:'register',id:p.id,proof:p.proof});if(pending?.id!==p.id)return;localStorage.setItem('sommni-linked-device-id',p.id);pending=null;await stored(null);listener?.('Account linked. Your Winebrary is ready.');window.dispatchEvent(new Event('sommni-account-linked'));
   }
  }
 }catch(e){listener?.((e as Error).message);}finally{running=false;}
}
let lastValidation=0;
async function validateLink(){if(Date.now()-lastValidation<30000)return;lastValidation=Date.now();if(!(await account.auth.getSession()).data.session)return;try{await accountAction('link',{action:'status'});}catch(e){if(/unlinked|Sign in again/.test((e as Error).message))await account.auth.signOut({scope:'local'});}}
export function initAccountPairing(){void pollPairing();setInterval(()=>{if(!document.hidden){void pollPairing();void validateLink();}},4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){void pollPairing();void validateLink();}});}
export async function showAccountPairing(){
 let modal=document.querySelector<HTMLDialogElement>('#sommni-pair-dialog');if(!modal){modal=document.createElement('dialog');modal.id='sommni-pair-dialog';modal.className='wl-dialog';modal.setAttribute('aria-label','Link your account');document.body.append(modal);}
 modal.innerHTML='<button class="wl-close" aria-label="Continue on this device">×</button><p class="wl-kicker">FREE WINEBRARY · YOUR WINES, EVERYWHERE.</p><h2>Keep your wines. Link sommNI.</h2><p>Open the website, sign in with Google or create an account with your email, then confirm this code. Return here to finish linking.</p><output class="sommni-pair-code">Getting your code…</output><p class="pair-expiry"></p><div class="wl-hero-actions"><a class="wl-primary" data-open-pair target="_blank" rel="noopener noreferrer" aria-disabled="true">Link with website ↗</a><button class="wl-outline" data-copy-pair>Copy link</button><button class="wl-outline" data-show-pair>Show on glasses</button><button class="wl-text-button" data-new-pair>New code</button></div><label class="pair-fallback" hidden>Copy this link<input readonly></label><p role="status" class="pair-status"></p><p class="wl-muted small">Continue free on this device, or link a free D3 account for recovery and sync. Linking backs up your device wines into your account. Public wine details join the master catalog either way; personal notes stay private.</p><button class="wl-text-button" data-export-device>Export device Winebrary ↓</button>';
 modal.querySelector<HTMLButtonElement>('[data-export-device]')!.onclick=()=>void exportDeviceLibrary().catch(e=>listener?.(e.message));
 modal.querySelector<HTMLButtonElement>('.wl-close')!.onclick=()=>modal!.close();if(!modal.open)modal.showModal();
 listener=message=>{if(modal?.open)modal.querySelector('.pair-status')!.textContent=message;};
 const show=async(fresh=false)=>{try{const p=await beginPairing(fresh);modal!.querySelector('output')!.textContent=p.code;const link=modal!.querySelector<HTMLAnchorElement>('[data-open-pair]')!;link.href=ACCOUNT_SITE+'/link?pair='+p.code.replace('-','');link.removeAttribute('aria-disabled');modal!.querySelector('.pair-expiry')!.textContent='Valid until '+new Date(p.expires_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch(e){listener?.((e as Error).message)}};
 modal.querySelector<HTMLButtonElement>('[data-new-pair]')!.onclick=()=>void show(true);
 modal.querySelector<HTMLButtonElement>('[data-copy-pair]')!.onclick=()=>void(async()=>{const p=await beginPairing();const url=ACCOUNT_SITE+'/link?pair='+p.code.replace('-','');const fallback=modal!.querySelector<HTMLElement>('.pair-fallback')!;fallback.hidden=false;fallback.querySelector('input')!.value=url;try{await navigator.clipboard.writeText(url);listener?.('Link copied. Paste it into Safari or Chrome.');}catch{listener?.('Press and hold the link below to copy it.');}})();
 modal.querySelector<HTMLButtonElement>('[data-show-pair]')!.onclick=()=>void import('./pairing-glasses').then(m=>m.openPairingGlasses()).catch(e=>listener?.(e.message));
 await show();
}
export async function showCloudAccount(){
 const session=(await account.auth.getSession()).data.session;if(!session)return showAccountPairing();
 let modal=document.querySelector<HTMLDialogElement>('#sommni-cloud-dialog');if(!modal){modal=document.createElement('dialog');modal.id='sommni-cloud-dialog';modal.className='wl-dialog';document.body.append(modal);}
 modal.innerHTML='<button class="wl-close" aria-label="Close account">×</button><p class="wl-kicker">ACCOUNT LINKED</p><h2>Your Winebrary, connected.</h2><p class="account-email"></p><p>Wines and bottle images sync with your D3 account. Device wines automatically sync into the first account you link; local copies remain on this device.</p><div class="guest-import"></div><p><a class="wl-outline" href="https://d3hospitality.com/sommNI/link" target="_blank" rel="noopener">Manage linked devices ↗</a></p><button class="wl-text-button" data-account-out>Unlink this app</button><p class="pair-status" role="status"></p>';
 modal.querySelector('.account-email')!.textContent=session.user.email||'Signed in';modal.querySelector<HTMLButtonElement>('.wl-close')!.onclick=()=>modal!.close();modal.showModal();
 const guests=(await localWines()).filter(w=>!(w as any).sync_owner||(w as any).sync_owner===session.user.id);if(guests.length){const host=modal.querySelector('.guest-import')!;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Review ${guests.length} device backup wines`;details.append(summary);const list=document.createElement('ul');for(const w of guests){const li=document.createElement('li');li.textContent=[w.wine_name,w.producer,w.vintage].filter(Boolean).join(' · ');list.append(li);}details.append(list);host.append(details);const button=document.createElement('button');button.className='wl-primary';button.textContent='Retry device wine sync';host.append(button);button.onclick=()=>void(async()=>{button.disabled=true;try{if((await account.auth.getSession()).data.session?.user.id!==session.user.id)throw Error('Account changed.');await syncGuestWines(session.user.id);const remaining=(await localWines()).filter(w=>(!(w as any).sync_owner||(w as any).sync_owner===session.user.id)&&!(w as any).cloud_id).length;modal!.querySelector('.pair-status')!.textContent=remaining?`${remaining} device wines still waiting to sync. Your local copies are safe; reconnect and retry.`:'Device wines synced. Existing vintages were reused.';window.dispatchEvent(new CustomEvent('winelens-research-saved',{detail:{}}));}catch(e){modal!.querySelector('.pair-status')!.textContent=(e as Error).message+' Your local copies are safe; you can retry.';}finally{button.disabled=false;}})();}
 modal.querySelector<HTMLButtonElement>('[data-account-out]')!.onclick=()=>void(async()=>{try{await accountAction('link',{action:'unlink'});await account.auth.signOut({scope:'local'});localStorage.removeItem('sommni-linked-device-id');modal!.close();}catch(e){modal!.querySelector('.pair-status')!.textContent=(e as Error).message;}})();
}
