import {account} from './account-client';
import {ACCOUNT_URL,ACCOUNT_PUBLIC_KEY} from './account-config';
export type BottleAllowance={unlimited:boolean;limit:number|null;used?:number;remaining:number|null;resets_at:string};
export async function bottleAccessHeaders(scope?:string){
 const session=(await account.auth.getSession()).data.session;
 return {'Content-Type':'application/json',apikey:ACCOUNT_PUBLIC_KEY,...(session&&(!scope||scope===session.user.id||scope==='beta-local')?{Authorization:'Bearer '+session.access_token}:{})};
}
export function announceBottleAllowance(allowance?:BottleAllowance){if(allowance)window.dispatchEvent(new CustomEvent('sommni-bottle-allowance',{detail:allowance}));}
async function request(wine?:any,signal?:AbortSignal){
 if(!navigator.onLine)throw Error('Connect to check your daily bottle allowance before adding a wine. Your saved Winebrary stays available.');
 const response=await fetch(ACCOUNT_URL+'/functions/v1/winelens-beta',{method:'POST',signal,headers:await bottleAccessHeaders(),body:JSON.stringify(wine?{action:'bottle_allow',wine}:{action:'bottle_allowance'})});
 const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Could not check your daily allowance.'),{code:result.code});announceBottleAllowance(result.allowance);return result.allowance as BottleAllowance;
}
export const checkBottleAllowance=(wine:any,signal?:AbortSignal)=>request(wine,signal);
export const getBottleAllowance=()=>request();
