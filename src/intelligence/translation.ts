import { getLocale, translateTexts } from './client';
import type { ReadingDocument } from '../reading/phone';
export async function localizedDocument(doc:ReadingDocument):Promise<ReadingDocument>{
 if(getLocale()==='en')return doc;
 const texts=await translateTexts(doc.sections.flatMap(s=>[s.label,s.text,s.context??'']));
 return {...doc,sections:doc.sections.map((s,i)=>({...s,label:texts[i*3],text:texts[i*3+1],context:texts[i*3+2]}))};
}
/** Translate an already visible note without mutating the saved personal original. */
export async function localizeNotes(host:HTMLElement){
 if(getLocale()==='en')return;
 const nodes=[...host.querySelectorAll<HTMLElement>('.wl-notes')];if(!nodes.length)return;
 const status=document.createElement('p');status.className='translation-status';status.setAttribute('role','status');status.textContent='Translating notes…';nodes[0].before(status);
 try{const result=await translateTexts(nodes.map(n=>n.textContent||''));if(!status.isConnected)return;nodes.forEach((node,i)=>{if(node.isConnected)node.textContent=result[i];});status.textContent='Translated view · your original notes are unchanged.';}
 catch(error){if(status.isConnected)status.textContent=(error as Error).message+' Showing original notes.';}
}
