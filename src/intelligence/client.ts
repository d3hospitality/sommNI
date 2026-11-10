import { betaProvider } from '../beta/client';
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
export const LANGUAGES={en:'English',es:'Español',fr:'Français',it:'Italiano',de:'Deutsch',pt:'Português',ja:'日本語',zh:'中文',ko:'한국어'} as const;
export type Locale=keyof typeof LANGUAGES;
let locale:Locale='en';
const host=()=>typeof (window as any).flutter_inappwebview?.callHandler==='function';
let writes=Promise.resolve();
export const saved={
 async get<T>(key:string,fallback:T):Promise<T>{try{await writes.catch(()=>{});const raw=host()?await (await waitForEvenAppBridge()).getLocalStorage('wl_intel:'+key):localStorage.getItem('wl_intel:'+key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}},
 async set(key:string,value:unknown){const run=writes.catch(()=>{}).then(async()=>{const data=JSON.stringify(value);if(host()){if(!await (await waitForEvenAppBridge()).setLocalStorage('wl_intel:'+key,data))throw Error('Even Hub could not save this.');}else localStorage.setItem('wl_intel:'+key,data);});writes=run;return run;},
};
export const getLocale=()=>locale;
export async function loadLocale(){const value=await saved.get<Locale>('language','en');locale=Object.prototype.hasOwnProperty.call(LANGUAGES,value)?value:'en';window.dispatchEvent(new Event('winelens-language'));}
export async function setLocale(value:Locale){if(!Object.prototype.hasOwnProperty.call(LANGUAGES,value))return;await saved.set('language',value);locale=value;window.dispatchEvent(new Event('winelens-language'));}
export async function intelligence(body:Record<string,unknown>,signal?:AbortSignal){try{return await betaProvider({locale,...body},signal);}catch(error){if((error as Error).message.includes('Unknown beta action'))throw Error('The cloud upgrade is not live yet. Saved notes and reference practice remain available.');throw error;}}
export async function translateTexts(texts:string[]):Promise<string[]>{
 if(locale==='en'||!texts.length)return texts;
 const target=locale;
 const raw=new TextEncoder().encode(JSON.stringify([target,texts]));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
 const cached=await saved.get<string[]|null>('translation:'+hash,null);if(cached)return cached;
 const result=await intelligence({action:'translate',locale:target,texts});
 if(!Array.isArray(result.texts)||result.texts.length!==texts.length)throw Error('The translation was incomplete.');
 // Translation caching is a convenience; failure must not replace a valid result.
 await saved.set('translation:'+hash,result.texts).catch(()=>{});return result.texts;
}
export const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
