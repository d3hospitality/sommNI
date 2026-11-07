import bundled from './data/catalog-anecdotes.json';
import { lookupWineById } from './identity';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY } from './account-config';

export interface CatalogAnecdote {
 wine_id:string; title:string; anecdote:string; scope:'wine'|'producer';
 identity_note:string; sources:{title:string;url:string}[];
 generated_at:string; prompt_version:string;
}
const records=new Map<string,CatalogAnecdote>();
/** Only canonical catalog content is replaced. Personal notes are never edited. */
export function installCatalogAnecdotes(values:unknown):number {
 if(!Array.isArray(values))return 0;
 let count=0;
 for(const value of values){
  if(!value||typeof value.wine_id!=='string'||typeof value.anecdote!=='string'||value.anecdote.length<150||value.anecdote.length>850||!['wine','producer'].includes(value.scope)||typeof value.title!=='string'||typeof value.identity_note!=='string'||!Number.isFinite(Date.parse(value.generated_at)))continue;
  const entry=lookupWineById(value.wine_id);if(!entry||entry.id!==value.wine_id)continue;
  const prior=records.get(entry.id);if(prior&&Date.parse(prior.generated_at)>Date.parse(value.generated_at))continue;
  const record:CatalogAnecdote={wine_id:entry.id,title:value.title,anecdote:value.anecdote,scope:value.scope,identity_note:value.identity_note,sources:[],generated_at:value.generated_at,prompt_version:String(value.prompt_version)};
  records.set(entry.id,record);entry.wine.anecdote=record.anecdote;count++;
 }
 return count;
}
installCatalogAnecdotes(bundled);
export function getCatalogAnecdote(id:string):CatalogAnecdote|undefined {const entry=lookupWineById(id);return entry?records.get(entry.id):undefined;}
export function anecdotePublishers(_id:string):string[]{return [];}
export async function syncCatalogAnecdotes():Promise<void>{
 try{
  const response=await fetch(`${ACCOUNT_URL}/functions/v1/winelens-beta`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ACCOUNT_PUBLIC_KEY},body:JSON.stringify({action:'catalog_anecdotes'}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)return;
  const data=await response.json();installCatalogAnecdotes(data.anecdotes);
 }catch{/* Bundled, sourced anecdotes remain available without a connection. */}
}
/** Evidence is retained by the backend, never rendered in the companion. */
export function anecdoteSourcesHtml(_record:CatalogAnecdote):string { return ''; }
