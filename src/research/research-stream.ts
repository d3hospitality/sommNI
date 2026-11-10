export type ResearchProgress={stage:'identified'|'references';wine_name?:string;producer?:string;bottle_outline?:unknown};
/** Incremental lines keep the original response contract; a broken stream is never a saved draft. */
export async function readResearchStream(response:Response,progress:(value:ResearchProgress)=>void){
 const reader=response.body?.getReader();if(!reader)throw Error('The scan connection closed. Retry your saved photo.');
 const decoder=new TextDecoder();let buffer='',result:any,complete=false;
 const line=(raw:string)=>{if(!raw.trim())return;const event=JSON.parse(raw);if(event.type==='error')throw Object.assign(new Error(event.value?.error||'The scan could not finish. Retry your photo.'),{code:event.value?.code});if(event.type==='result'){result=event.value;complete=true;}else if(event.type==='progress'&&!complete&&['identified','references'].includes(event.value?.stage)){progress(event.value);}};
 try{for(;;){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length>6_000_000)throw Error('Scan response was too large.');let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(done)break;}if(buffer.trim())line(buffer);if(!complete)throw Error('The scan connection ended before a match was ready. Retry this photo.');return result;}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
