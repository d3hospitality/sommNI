export class Fault extends Error { constructor(public status:number,message:string){super(message)} }
export function text(value:unknown,max:number,required=false):string { if(typeof value!=='string' || value.trim().length>max || (required&&!value.trim())) throw new Fault(400,'Check the text fields and try again.');return value.trim(); }
export function uuid(value:unknown):string {if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Fault(400,'Invalid request ID.');return value;}
export function review(value:any) {
 if(!value||typeof value!=='object')throw new Fault(400,'Review the wine first.');
 const state=value.vintage_state;
 if(!['year','unknown','non_vintage'].includes(state))throw new Fault(400,'Choose a vintage state.');
 const vintage=state==='year'?value.vintage:null;
 if(state==='year'&&(!Number.isInteger(vintage)||vintage<1800||vintage>new Date().getUTCFullYear()+1))throw new Fault(400,'Check the vintage.');
 const color=text(value.color??'',20);if(!['','Red','White','Sparkling','Rosé','Orange','Dessert','Sake'].includes(color))throw new Fault(400,'Choose a wine style.');
 return {wine_name:text(value.wine_name,200,true),producer:text(value.producer??'',200),vintage,vintage_state:state,region:text(value.region??'',200),country:text(value.country??'',100),grape:text(value.grape??'',200),color,sake_classification:text(value.sake_classification??'',200),sake_style:text(value.sake_style??'',200),rice_variety:text(value.rice_variety??'',200),tasting_notes:text(value.tasting_notes??'',2000)};
}
export function photo(value:unknown):{bytes:Uint8Array;data:string}|null {
 if(value==null||value==='')return null;
 if(typeof value!=='string'||value.length>4194304||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value))throw new Fault(400,'Use a JPEG photo under 3 MB.');
 const data=value.split(',')[1],bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
 if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new Fault(400,'Invalid JPEG photo.');
 return {bytes,data};
}
export function safeUrl(value:unknown):string|null {try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export function grounding(candidate:any) {
 const metadata=candidate?.groundingMetadata;
 const sources=(metadata?.groundingChunks??[]).flatMap((chunk:any,index:number)=>{const url=safeUrl(chunk.web?.uri);return url?[{index,title:String(chunk.web.title??'Source').slice(0,200),url}]:[]}).slice(0,30);
 const supports=(metadata?.groundingSupports??[]).map((support:any)=>({text:String(support.segment?.text??'').slice(0,2000),sources:(support.groundingChunkIndices??[]).filter((i:any)=>sources.some((s:any)=>s.index===i))}));
 return {sources,supports,search_html:String(metadata?.searchEntryPoint?.renderedContent??'').slice(0,50000)};
}
export async function hash(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
export function narration(wine:any) {
 const notes=wine.metadata?.tasting_notes || wine.notes;
 if(!notes)throw new Fault(400,'Save tasting notes before making audio.');
 return `${wine.wine_name}. ${wine.producer||''}. ${wine.vintage?`Vintage ${wine.vintage}.`:wine.metadata?.vintage_state==='non_vintage'?'Non-vintage.':'Vintage unconfirmed.'} ${wine.region||''}. ${wine.metadata?.tasting_notes?'Reviewed reference tasting notes.':'Your tasting notes.'} ${String(notes).slice(0,2000)}`;
}
