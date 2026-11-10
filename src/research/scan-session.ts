import type {WineDraft} from './add-session';
export type ScanPhase='ready'|'preparing'|'researching'|'review'|'error';
export class BottleScanSession {
 phase:ScanPhase='ready';photo='';draft:WineDraft|null=null;error='';
 private revision=0;private request:AbortController|null=null;
 constructor(private deps:{prepare:(photo:string)=>Promise<string>;research:(photo:string,signal:AbortSignal)=>Promise<{draft:WineDraft}>;changed:()=>void}){}
 cancel(){this.revision++;this.request?.abort();this.request=null;this.phase='ready';this.draft=null;this.error='';this.deps.changed();}
 async scan(photo:string){
  this.cancel();const revision=this.revision,request=this.request=new AbortController();
  this.photo=photo;this.phase='preparing';this.deps.changed();
  const timeout=setTimeout(()=>request.abort(),120000);
  try{
   const prepared=await this.deps.prepare(photo);if(revision!==this.revision)return;request.signal.throwIfAborted();
   this.photo=prepared;this.phase='researching';this.deps.changed();
   const {draft}=await this.deps.research(prepared,request.signal);if(revision!==this.revision)return;request.signal.throwIfAborted();
   if(!draft?.id||!draft.result?.wine_name?.trim())throw Error('No clear wine label found. Move closer or choose a sharper photo.');
   this.draft=draft;this.phase='review';
  }catch(error){if(revision!==this.revision)return;this.phase='error';this.error=request.signal.aborted?'The lookup took too long. Retry when connected.':error instanceof Error?error.message:'Could not read this label. Try another photo.';}
  finally{clearTimeout(timeout);if(revision===this.revision){this.request=null;this.deps.changed();}}
 }
}
