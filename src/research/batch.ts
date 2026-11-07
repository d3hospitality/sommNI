/** Bounded, incremental research. Unchecked rows never save; late results cannot cross accounts. */
export type BatchRow = {
 id:number; query:string; selected:boolean; state:'queued'|'researching'|'ready'|'saving'|'saved'|'error'|'duplicate';
 draft?:any; bottle?:any; artwork:'waiting'|'working'|'ready'|'error'; message:string; imageMessage:string;
};
export type BatchPorts = {
 current:()=>boolean;
 research:(query:string,signal:AbortSignal)=>Promise<any>;
 artwork:(wine:any)=>Promise<any>;
 save:(row:BatchRow,signal:AbortSignal)=>Promise<string>;
 changed:(row?:BatchRow)=>void;
};
export function batchQueries(text:string):string[]{
 const lines=[...new Map(text.split(/\r?\n/).map(s=>s.trim().replace(/^[-•]\s+/, '')).filter(Boolean).map(s=>[s.normalize('NFKC').toLowerCase().replace(/\s+/g,' '),s])).values()];
 if(!lines.length)throw Error('Add one wine per line, including the producer and year when you know them.');
 if(lines.length>200)throw Error('Add up to 200 wines at a time. Keep the remaining lines for your next batch.');
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
 rows:BatchRow[]=[]; saving=false;
 private controller=new AbortController(); private researches=0; private clipping=false; private disposed=false;
 private ports:BatchPorts;
 constructor(ports:BatchPorts){this.ports=ports;}
 private live(){return !this.disposed&&this.ports.current();}
 start(queries:string[]){
  if(this.rows.length)throw Error('Finish or clear this batch first.');
  this.rows=queries.map((query,id)=>({id,query,selected:true,state:'queued',artwork:'waiting',message:'Waiting to research',imageMessage:''}));
  this.ports.changed();this.pump();
 }
 select(id:number,selected:boolean){const r=this.rows[id];if(!this.live()||!r||['saving','saved','duplicate'].includes(r.state))return;r.selected=selected;this.ports.changed(r);this.pump();}
 retry(id:number){const r=this.rows[id];if(!this.live()||!r||r.state!=='error')return;r.state=r.draft?'ready':'queued';r.message=r.draft?'Ready to review':'Waiting to research';this.ports.changed(r);this.pump();}
 retryArtwork(id:number){const r=this.rows[id];if(!this.live()||!r||r.artwork!=='error'||r.state!=='ready')return;r.artwork='waiting';this.ports.changed(r);this.pump();}
 dispose(){this.disposed=true;this.controller.abort();}
 private pump(){
  if(!this.live())return;
  while(this.researches<2){
   const r=this.rows.find(r=>r.selected&&r.state==='queued');if(!r)break;
   this.researches++;r.state='researching';r.message='Checking wine identity and sources…';this.ports.changed(r);
   void this.ports.research(r.query,this.controller.signal).then(draft=>{
    if(!this.live())return;if(!draft?.id||!draft.result?.wine_name)throw Error('No wine identified. Check the name and try again.');
    const key=wineBatchIdentity(draft.result);
    const duplicate=key&&this.rows.find(other=>other.id!==r.id&&other.draft&&other.state!=='duplicate'&&wineBatchIdentity(other.draft.result)===key);
    if(duplicate){r.draft=draft;r.state='duplicate';r.selected=false;r.message='Repeated wine · kept once in this batch';this.ports.changed(r);return;}
    r.draft=draft;r.state='ready';r.message='Review the label, producer and vintage';this.ports.changed(r);
   }).catch(error=>{if(this.live()){r.state='error';r.message=error.message||'Research failed. Retry this wine.';this.ports.changed(r);}}).finally(()=>{this.researches--;this.pump();});
  }
  if(this.clipping)return;
  const r=this.rows.find(r=>r.selected&&r.state==='ready'&&r.artwork==='waiting');if(!r)return;
  this.clipping=true;r.artwork='working';r.imageMessage='Preparing real bottle photograph…';this.ports.changed(r);
  void this.ports.artwork(r.draft.result).then(bottle=>{if(this.live()){r.bottle=bottle;r.artwork='ready';r.imageMessage='Bottle ready · check the pictured vintage';this.ports.changed(r);}}).catch(error=>{if(this.live()){r.artwork='error';r.imageMessage=(error.message||'Photo unavailable')+' Save now to queue another attempt.';this.ports.changed(r);}}).finally(()=>{this.clipping=false;this.pump();});
 }
 async saveSelected(){
  if(!this.live()||this.saving)return;
  // Snapshot only ready selections. Wines that arrive later need another explicit save.
  const ready=this.rows.filter(r=>r.selected&&r.state==='ready');if(!ready.length)return;
  this.saving=true;this.ports.changed();
  try{for(const r of ready){
   if(!this.live())return;if(!r.selected||r.state!=='ready')continue;
   r.state='saving';r.message='Saving wine and queuing master-library upload…';this.ports.changed(r);
   try{const message=await this.ports.save(r,this.controller.signal);if(!this.live())return;r.state='saved';r.message=message;}
   catch(error){if(!this.live())return;r.state='error';r.message=(error as Error).message||'Save failed. Retry this wine.';}
   this.ports.changed(r);
  }}finally{this.saving=false;if(this.live())this.ports.changed();}
 }
}
