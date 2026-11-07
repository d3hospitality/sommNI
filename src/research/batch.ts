/** Bounded, incremental research. Unchecked rows never save; late results cannot cross accounts. */
export type BatchRow = {
 id:number; query:string; selected:boolean; state:'queued'|'researching'|'ready'|'saving'|'saved'|'error'|'duplicate';
 existing?:any; draft?:any; bottle?:any; artwork:'waiting'|'working'|'ready'|'error'; message:string; imageMessage:string;
};
export type BatchPorts = {
 reuse?:(query:string)=>any;
 current:()=>boolean;
 research:(query:string,signal:AbortSignal)=>Promise<any>;
 artwork:(wine:any,signal:AbortSignal)=>Promise<any>;
 save:(row:BatchRow,signal:AbortSignal)=>Promise<string>;
 changed:(row?:BatchRow)=>void;
};
export function batchQueries(text:string):string[]{
 const lines=[...new Map(text.split(/\r?\n/).map(s=>s.trim().replace(/^[-•]\s+/, '')).filter(Boolean).map(s=>[s.normalize('NFKC').toLowerCase().replace(/\s+/g,' '),s])).values()];
 if(!lines.length)throw Error('Add one wine per line, including the producer and year when you know them.');
 if(lines.length>400)throw Error('Add up to 400 wines at a time. Keep the remaining lines for your next batch.');
 if(lines.some(s=>s.length>400))throw Error('Keep each wine under 400 characters, one wine per line.');
 return lines;
}
/** Identity is conservative: never merge missing producers, unknown years with known, or distinct vintages. */
export function wineBatchIdentity(w:any){
 const norm=(v:unknown)=>String(v??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 if(!norm(w?.producer)||!norm(w?.wine_name))return '';
 return [norm(w.producer),norm(w.wine_name),norm(w.vintage_state||'unknown'),norm(w.vintage)].join('|');
}
export class WineBatch {
 rows:BatchRow[]=[]; saving=false; paused=false; stopped=false;
 private generation=0;private saveController=new AbortController();
 saveProgress:{total:number;completed:number;saved:number;failed:number;skipped:number}|null=null;
 private controller=new AbortController(); private researches=0; private clipping=false; private disposed=false;
 private ports:BatchPorts;
 constructor(ports:BatchPorts){this.ports=ports;}
 private live(){return !this.disposed&&this.ports.current();}
 start(queries:string[]){
  if(this.rows.length)throw Error('Finish or clear this batch first.');
  this.rows=queries.map((query,id)=>{const existing=this.ports.reuse?.(query);return {id,query,selected:true,state:existing?'ready':'queued',artwork:existing?'ready':'waiting',message:existing?'Already saved · reuse this bottle':'Waiting to research',imageMessage:'',...(existing?{existing,draft:{result:{...existing,vintage_state:existing.metadata?.vintage_state,country:existing.metadata?.country,grape:existing.metadata?.grape,tasting_notes:existing.metadata?.tasting_notes}},bottle:existing.image_url?{url:existing.image_url}:undefined}:{})};});
  this.ports.changed();this.pump();
 }
 select(id:number,selected:boolean){const r=this.rows[id];if(!this.live()||!r||['saving','saved','duplicate'].includes(r.state))return;r.selected=selected;this.ports.changed(r);this.pump();}
 retry(id:number){const r=this.rows[id];if(!this.live()||!r||r.state!=='error')return;r.state=r.draft?'ready':'queued';r.message=r.draft?'Ready to review':'Waiting to research';this.ports.changed(r);this.pump();}
 retryArtwork(id:number){const r=this.rows[id];if(!this.live()||!r||r.artwork!=='error'||r.state!=='ready')return;r.artwork='waiting';this.ports.changed(r);this.pump();}
 pause(){if(!this.live())return;this.paused=true;this.ports.changed();}
 resume(){if(!this.live())return;this.paused=false;this.stopped=false;this.ports.changed();this.pump();}
 stop(){if(!this.live())return;this.paused=true;this.stopped=true;this.generation++;this.controller.abort();this.controller=new AbortController();this.researches=0;this.clipping=false;
  for(const r of this.rows){if(r.state==='researching'){r.state='queued';r.message='Search stopped · resume when ready';}if(r.artwork==='working'){r.artwork='waiting';r.imageMessage='Photo search stopped';}this.ports.changed(r);}this.ports.changed();
 }
 dispose(){this.disposed=true;this.generation++;this.controller.abort();this.saveController.abort();}
 private pump(){
  if(!this.live()||this.paused)return;
  const generation=this.generation,live=()=>this.live()&&generation===this.generation;
  while(this.researches<2){
   const r=this.rows.find(r=>r.selected&&r.state==='queued');if(!r)break;
   this.researches++;r.state='researching';r.message='Checking wine identity and sources…';this.ports.changed(r);
   void this.ports.research(r.query,this.controller.signal).then(draft=>{
    if(!live())return;if(!draft?.id||!draft.result?.wine_name)throw Error('No wine identified. Check the name and try again.');
    const key=wineBatchIdentity(draft.result);
    const duplicate=key&&this.rows.find(other=>other.id!==r.id&&other.draft&&other.state!=='duplicate'&&wineBatchIdentity(other.draft.result)===key);
    if(duplicate){r.draft=draft;r.state='duplicate';r.selected=false;r.message='Repeated wine · kept once in this batch';this.ports.changed(r);return;}
    r.draft=draft;r.state='ready';r.message='Review the label, producer and vintage';this.ports.changed(r);
   }).catch(error=>{if(live()){r.state='error';r.message=error.message||'Research failed. Retry this wine.';if(error.code==='DAILY_BOTTLE_LIMIT'||r.message.startsWith('Daily limit reached'))this.paused=true;this.ports.changed(r);}}).finally(()=>{if(live()){this.researches--;this.pump();}});
  }
  if(this.clipping)return;
  const r=this.rows.find(r=>r.selected&&r.state==='ready'&&r.artwork==='waiting');if(!r)return;
  this.clipping=true;r.artwork='working';r.imageMessage='Preparing real bottle photograph…';this.ports.changed(r);
  void this.ports.artwork(r.draft.result,this.controller.signal).then(bottle=>{if(live()){r.bottle=bottle;r.artwork='ready';r.imageMessage='Bottle ready · check the pictured vintage';this.ports.changed(r);}}).catch(error=>{if(live()){r.artwork='error';r.imageMessage=(error.message||'Photo unavailable')+' Save now to queue another attempt.';this.ports.changed(r);}}).finally(()=>{if(live()){this.clipping=false;this.pump();}});
 }
 async saveSelected(){
  if(!this.live()||this.saving)return;
  // Snapshot only ready selections. Wines that arrive later need another explicit save.
  const ready=this.rows.filter(r=>r.selected&&r.state==='ready');if(!ready.length)return;
  this.saveProgress={total:ready.length,completed:0,saved:0,failed:0,skipped:0};
  this.saving=true;this.ports.changed();
  try{for(const r of ready){
   if(!this.live())return;if(!r.selected||r.state!=='ready'){this.saveProgress.completed++;this.saveProgress.skipped++;this.ports.changed();continue;}
   r.state='saving';r.message='Saving wine and queuing master-library upload…';this.ports.changed(r);
   try{const message=await this.ports.save(r,this.saveController.signal);if(!this.live())return;r.state='saved';r.message=message;this.saveProgress.saved++;}
   catch(error){if(!this.live())return;r.state='error';r.message=(error as Error).message||'Save failed. Retry this wine.';this.saveProgress.failed++;}
   this.saveProgress.completed++;this.ports.changed(r);
  }}finally{this.saving=false;if(this.live())this.ports.changed();}
 }
}
