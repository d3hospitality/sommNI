/** Latest selection wins. One bridge operation at a time, even after a timeout.
 * A hung bridge is paused instead of releasing the queue and overlapping sends. */
export class AtlasTransport {
  private version=0;
  private tail:Promise<void>=Promise.resolve();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private paused=false;
  constructor(private onError:(error:Error)=>void, private timeoutMs=8000){}
  invalidate(){this.version++;clearTimeout(this.timer);}
  enqueue(steps:(()=>Promise<unknown>)[], delay=0) {
    this.invalidate();const version=this.version;
    const run=()=>{this.tail=this.tail.then(async()=>{
      for(const step of steps){
        if(version!==this.version||this.paused)return;
        let timeout:ReturnType<typeof setTimeout>|undefined;
        try {
          await Promise.race([step(),new Promise((_,reject)=>{timeout=setTimeout(()=>{this.paused=true;reject(new Error('Glasses link stalled. Reload the app to reconnect.'));},this.timeoutMs);})]);
        } catch(error){this.onError(error instanceof Error?error:new Error(String(error)));return;}
        finally{clearTimeout(timeout);}
      }
    });};
    if(delay)this.timer=setTimeout(run,delay);else run();
  }
  async idle(){await this.tail;if(this.paused)throw new Error('Glasses link stalled; reload before sending more data.');}
}
