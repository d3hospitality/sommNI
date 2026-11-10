import {publicContent} from './public-content.ts';
/** Only public progress and final output leave the service; reference URLs remain backend-only. */
export function researchStream(work:(progress:(value:Record<string,unknown>)=>void)=>Promise<unknown>,headers:Record<string,string>,failure:(error:unknown)=>unknown){
 const encoder=new TextEncoder();let stopped=false,timer:ReturnType<typeof setInterval>|undefined;
 const stream=new ReadableStream<Uint8Array>({start(controller){
  const send=(type:string,value:unknown)=>{if(!stopped)controller.enqueue(encoder.encode(JSON.stringify({type,value:publicContent(value)})+'\n'));};
  timer=setInterval(()=>send('keepalive',null),10000);
  void (async()=>{try{send('keepalive',null);send('result',await work(value=>send('progress',value)));}catch(error){send('error',failure(error));}finally{clearInterval(timer);if(!stopped){stopped=true;controller.close();}}})();
 },cancel(){stopped=true;clearInterval(timer);}});
 return new Response(stream,{headers:{...headers,'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'}});
}
