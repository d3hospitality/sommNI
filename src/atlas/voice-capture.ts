export type CaptureState='idle'|'opening'|'listening'|'transcribing';
type Dependencies={control:(open:boolean)=>Promise<boolean>;state:(state:CaptureState)=>Promise<void>;transcribe:(pcm:Uint8Array,signal:AbortSignal)=>Promise<string>;result:(text:string)=>Promise<void>;error:(error:Error)=>Promise<void>};
/** One explicit six-second utterance. Audio is discarded after recognition or cancellation. */
export class AtlasVoiceCapture {
 state:CaptureState='idle';
 private generation=0;
 private chunks:Uint8Array[]=[];
 private bytes=0;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private abort:AbortController|null=null;
 constructor(private deps:Dependencies,private duration=6000){}
 async start(){
  if(this.state!=='idle')return;
  const generation=++this.generation;this.chunks=[];this.bytes=0;this.abort=new AbortController();this.state='opening';
  try{
   await this.deps.state('opening');if(generation!==this.generation)return;
   if(!await this.deps.control(true))throw Error('Microphone unavailable. Try voice search again.');
   if(generation!==this.generation)return;
   this.state='listening';await this.deps.state('listening');if(generation!==this.generation)return;
   this.timer=setTimeout(()=>void this.finish(),this.duration);
  }catch(error){await this.fail(error,generation);}
 }
 feed(pcm:Uint8Array){
  if(this.state!=='listening')return;
  const part=pcm.slice(0,Math.max(0,224000-this.bytes));this.chunks.push(part);this.bytes+=part.length;
  if(this.bytes>=224000)void this.finish();
 }
 async finish(){
  if(this.state!=='listening')return;
  const generation=this.generation;this.state='transcribing';clearTimeout(this.timer);
  try{
   if(!await this.deps.control(false))throw Error('Microphone could not be closed. Go back and try again.');
   if(generation!==this.generation)return;
   if(this.bytes<3200)throw Error('No speech received. Start voice capture again.');
   await this.deps.state('transcribing');if(generation!==this.generation)return;
   const pcm=new Uint8Array(this.bytes);let offset=0;for(const part of this.chunks){pcm.set(part,offset);offset+=part.length;}this.chunks=[];this.bytes=0;
   this.timer=setTimeout(()=>this.abort?.abort(),25000);
   const text=await this.deps.transcribe(pcm,this.abort!.signal);
   if(generation!==this.generation)return;
   clearTimeout(this.timer);this.state='idle';await this.deps.result(text.trim());
  }catch(error){await this.fail(error,generation);}
 }
 async cancel(){
  const wasActive=this.state!=='idle';this.generation++;clearTimeout(this.timer);this.abort?.abort();this.chunks=[];this.bytes=0;this.state='idle';
  if(wasActive)await this.deps.control(false);
 }
 private async fail(error:unknown,generation:number){
  if(generation!==this.generation)return;
  clearTimeout(this.timer);this.abort?.abort();this.chunks=[];this.bytes=0;
  await this.deps.control(false).catch(()=>false);
  if(generation!==this.generation)return;
  this.state='idle';await this.deps.error(error instanceof Error?error:Error(String(error)));
 }
}
