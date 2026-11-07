export type LabelOption={id:string;photo:string;provenance:Record<string,unknown>};
export type LabelRow={wine:any;options:LabelOption[];choice:number;state:'queued'|'searching'|'ready'|'error';work:'idle'|'polishing'|'saving'|'saved'|'error';message:string;result?:any;preview?:string};
export type LabelPorts={current:()=>boolean;search:(wine:any)=>Promise<LabelOption[]>;polish:(option:LabelOption)=>Promise<any>;save:(wine:any,draft:any)=>Promise<any>;changed:()=>void};
/** Searches run ahead, but only an explicit choice is polished and saved. */
export class LabelQueue{
 rows:LabelRow[]=[];index=0;busy=false;private searches=0;private disposed=false;private ports:LabelPorts;
 constructor(wines:any[],ports:LabelPorts){this.ports=ports;this.rows=wines.map(wine=>({wine,options:[],choice:0,state:'queued',work:'idle',message:'Waiting to find label photos'}));}
 get current(){return this.rows[this.index];}
 get settled(){return this.rows.filter(r=>r.state==='ready'||r.state==='error').length;}
 get saved(){return this.rows.filter(r=>r.work==='saved').length;}
 private live(){return !this.disposed&&this.ports.current();}
 acceptSaved(wine:any){
  if(!this.live()||this.busy||!wine?.image_url)return;
  const row=this.rows.find(r=>r.wine.id===wine.id);if(!row)return;
  row.wine=wine;row.result=wine;row.preview=wine.image_url;row.state='ready';row.work='saved';row.message='Bottle photo saved from Winebrary';this.ports.changed();
 }
 start(){this.pump();}
 dispose(){this.disposed=true;}
 move(delta:number){if(!this.live()||!this.rows.length)return;this.index=(this.index+delta+this.rows.length)%this.rows.length;this.ports.changed();}
 select(index:number){if(!this.live()||!this.rows[index])return;this.index=index;this.ports.changed();}
 photo(delta:number){const r=this.current;if(!this.live()||!r?.options.length||['polishing','saving'].includes(r.work))return;r.choice=(r.choice+delta+r.options.length)%r.options.length;r.preview=undefined;r.work='idle';r.message='Review the label and pictured vintage';this.ports.changed();}
 retry(){const r=this.current;if(!this.live()||!r||this.busy||r.state==='searching'||r.state==='queued')return;r.state='queued';r.work='idle';r.preview=undefined;r.options=[];r.choice=0;r.message='Waiting to retry label search';this.pump();}
 private pump(){
  if(!this.live())return;
  while(this.searches<2){const r=this.rows.find(r=>r.state==='queued');if(!r)break;this.searches++;r.state='searching';r.message='Searching for matching label photos…';this.ports.changed();
   void this.ports.search(r.wine).then(options=>{if(!this.live()||r.work==='saved')return;if(!options.length)throw Error('No matching photographs found. Retry the search.');r.options=options.slice(0,3);r.state='ready';r.message='Review the label and pictured vintage';this.ports.changed();}).catch(e=>{if(this.live()&&r.work!=='saved'){r.state='error';r.message=e.message||'Label search failed';this.ports.changed();}}).finally(()=>{this.searches--;this.pump();});
  }
 }
 async use(){
  const r=this.current;if(!this.live()||this.busy||!r||r.state!=='ready'||r.work==='saved')return;
  const option=r.options[r.choice];if(!option)return;this.busy=true;r.work='polishing';r.message='Polishing your chosen label…';this.ports.changed();
  try{const draft=await this.ports.polish(option);if(!this.live())return;r.preview=draft.url;r.work='saving';r.message='Saving bottle and preparing glasses artwork…';this.ports.changed();
   const result=await this.ports.save(r.wine,draft);if(!this.live())return;r.result=result;r.wine=result;r.work='saved';r.message='Chosen bottle saved · ready for the next wine';
  }catch(e){if(!this.live())return;r.work='error';r.message=(e as Error).message||'Could not save this label. Your previous bottle is kept.';}
  finally{this.busy=false;if(this.live())this.ports.changed();}
 }
}
