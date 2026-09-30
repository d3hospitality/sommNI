import { type AtlasData, type Country, type Region, type View } from './renderer';
export type AtlasMode='countries'|'regions'|'detail';
export class AtlasNavigator {
  mode:AtlasMode='countries';countryIndex=0;regionIndex=0;
  countries:Country[];
  constructor(public data:AtlasData) {
    const priority=['FRA','ITA','ESP','USA','PRT','ARG','CHL','AUS','NZL','DEU','AUT','ZAF','GRC','LBN'];
    this.countries=[...data.countries].filter(c=>c.regionCount>0).sort((a,b)=>{
      const ai=priority.indexOf(a.code),bi=priority.indexOf(b.code);
      return (ai<0?100:ai)-(bi<0?100:bi) || a.name.localeCompare(b.name);
    });
  }
  get country(){return this.countries[this.countryIndex];}
  get regions(){return this.data.regions.filter(r=>r.country===this.country.code).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));}
  get region():Region|undefined{return this.regions[this.regionIndex];}
  get labels(){return this.mode==='countries'?this.countries.map(c=>c.name):this.regions.map(r=>r.name);}
  get index(){return this.mode==='countries'?this.countryIndex:this.regionIndex;}
  get view():View{return {country:this.country,...(this.mode!=='countries'&&this.region?{region:this.region,radius:this.mode==='regions'?Math.max(12,this.region.radius*2):Math.max(.15,this.region.radius)}:{})};}
  scroll(delta:number){if(this.mode==='detail')return;const i=Math.max(0,Math.min(this.labels.length-1,this.index+delta));if(this.mode==='countries'){this.countryIndex=i;this.regionIndex=0;}else this.regionIndex=i;}
  select(){if(this.mode==='countries'&&this.regions.length)this.mode='regions';else if(this.mode==='regions')this.mode='detail';}
  back(){if(this.mode==='detail')this.mode='regions';else if(this.mode==='regions')this.mode='countries';}
  chooseCountry(code:string){const index=this.countries.findIndex(c=>c.code===code);if(index<0)return;this.countryIndex=index;this.regionIndex=0;this.mode='countries';}
  chooseRegion(id:string){const index=this.regions.findIndex(r=>r.id===id);if(index<0)return;this.regionIndex=index;this.mode='detail';}
  get title(){return this.mode==='countries'?'WINE ATLAS':this.country.name;}
  get rows(){
    if(this.mode==='detail')return `${this.region?.name}\n\n${this.region?.count} mapped wineries\nSource: winerymap\nWinery locations\nNot a region boundary`;
    const start=Math.max(0,Math.min(this.index-2,this.labels.length-5));
    return this.labels.slice(start,start+5).map((name,i)=>`${start+i===this.index?'>':' '} ${name}`).join('\n');
  }
  get hint(){return this.mode==='detail'?'Double tap: regions':`${this.index+1} / ${this.labels.length}   Tap: ${this.mode==='countries'?'regions':'focus'}`;}
}
