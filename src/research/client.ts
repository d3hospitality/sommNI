import { referenceNotes } from '../reference-notes';
import { getCatalogAnecdote } from '../catalog-anecdotes';
import { isGuestLibrary, accountResearch } from '../cloud-library';
import { FREE_BETA } from '../beta/config';
import { betaResearch } from '../beta/client';
import { account } from '../account-client';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from '../account-config';
export async function researchAction(body:Record<string,unknown>,signal?:AbortSignal) {
 if(FREE_BETA){if(body.action==='attach_bottle'&&!isGuestLibrary())return accountResearch(body,signal);return betaResearch(body,signal);}
 const session=(await account.auth.getSession()).data.session;
 if(!session)throw new Error('Sign in to your sommNI account first.');
 const response=await fetch(`${ACCOUNT_URL}/functions/v1/winelens-research`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ACCOUNT_PUBLIC_KEY,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body),signal});
 const result=await response.json().catch(()=>({}));
 const current=(await account.auth.getSession()).data.session;
 if(current?.user.id!==session.user.id)throw new Error('Account changed. Please start again.');
 if(!response.ok)throw new Error(result.error||'Wine research is unavailable. Please try again.');
 return result;
}
export const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function wineNotesText(wine:any):string {
 const anecdote=wine.wine_id?getCatalogAnecdote(wine.wine_id):undefined;
 const content=[wine.wine_name,[wine.producer,wine.region,wine.vintage??wine.metadata?.vintage_state].filter(Boolean).join(' · '),'','REVIEWED REFERENCE NOTES',referenceNotes(wine.metadata?.tasting_notes||''), '', 'YOUR NOTES',wine.notes||'', '', ...(anecdote?['BEHIND THE WINE',anecdote.title,anecdote.anecdote,anecdote.scope==='producer'?'Producer history':'Wine history',anecdote.identity_note,'']:[]),'AI-assisted research, reviewed before saving. Exact-vintage claims still depend on source evidence.'].join('\n');
 return content;
}
export function downloadNotes(wine:any) {
 const url=URL.createObjectURL(new Blob([wineNotesText(wine)],{type:'text/plain;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=`${wine.wine_name.replace(/[^a-z0-9 -]/gi,'').slice(0,70)||'wine'}-notes.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
