import {wineOrigin} from '../wine-origin';
import { regionLabel } from '../origin-filters';
import type { CollectiveSnapshot } from '../community/atlas-activity-ui';
import { prefectureKey } from '../sake';
import type { AtlasData } from './renderer';
import type { Boundaries } from './globe-model';
import { regionAt } from './globe-model';
import { allCatalogWines, lookupWineById } from '../identity';
import type { LibraryWine } from '../winebrary';
import links from '../data/atlas-region-links.json';
export interface AtlasCoverage { countries:Set<string>; regions:Set<string>; countryCounts:Map<string,number>; regionCounts:Map<string,number>; unmapped:number }
export const regionalCatalog:Record<string,string[]>={
 'IT-21':['Piedmont, IT'], 'IT-52':['Tuscany, IT'], 'IT-82':['Sicily, IT'],
 'IT-65':['Abruzzo, IT'], 'IT-34':['Veneto, IT'], 'IT-32':['Trentino, IT','Alto Adige, IT'],
};
const codes:Record<string,string>={US:'USA',USA:'USA','UNITED STATES':'USA','UNITED STATES OF AMERICA':'USA',UK:'GBR',GB:'GBR',FR:'FRA',IT:'ITA',ES:'ESP',PT:'PRT',DE:'DEU',AT:'AUT',NZ:'NZL',ZA:'ZAF',LB:'LBN',AU:'AUS',AR:'ARG',CL:'CHL',GR:'GRC',CY:'CYP',MX:'MEX',HU:'HUN',CA:'CAN',CH:'CHE',IL:'ISR',GE:'GEO',UY:'URY',BR:'BRA',SI:'SVN',HR:'HRV',RO:'ROU',MD:'MDA',CN:'CHN',JP:'JPN'};
const norm=(s:string|null|undefined)=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Coverage means a saved bottle with a known origin, never a purchase or a learning gate.
 * Region matching is conservative: country-only records do not unlock every region. */
export function winebraryCoverage(data:AtlasData,boundaries:Boundaries,items:LibraryWine[]):AtlasCoverage {
 const result:AtlasCoverage={countries:new Set(),regions:new Set(),countryCounts:new Map(),regionCounts:new Map(),unmapped:0};
 const bump=(map:Map<string,number>,key:string)=>map.set(key,(map.get(key)??0)+1);
 for(const wine of new Map(items.map(w=>[w.id,w])).values()){
  const twin=lookupWineById(wine.wine_id),label=wine.region??twin?.wine.region??'',origin=wineOrigin(wine.metadata?.country||twin?.country,label,wine.metadata?.state),place=origin.places[0]||origin.subdivision;
  const raw=origin.country;
  const country=data.countries.find(c=>c.code===(codes[raw.toUpperCase()]??raw.toUpperCase())||norm(c.name)===norm(raw));
  if(!country){result.unmapped++;continue;}
  result.countries.add(country.code);bump(result.countryCounts,country.code);
  const candidates=boundaries.regions.filter(r=>r.country===country.code),matched=new Set<string>();
  for(const r of candidates)if((country.code==='JPN'&&prefectureKey(r.name)===prefectureKey(place))||norm(r.name)===norm(place)||regionalCatalog[r.id]?.some(name=>norm(name)===norm(label)||norm(name.split(',')[0])===norm(place)||norm(name.split(',')[0])===norm(regionLabel(label,country.name))))matched.add(r.id);
  // Winery groups only locate a region when its actual centre falls within that boundary.
  if(!matched.size){const link=links.links.find(l=>norm(l.region)===norm(label));const names=link?.clusters??[place];
   for(const cluster of data.regions.filter(r=>r.country===country.code&&names.some(n=>norm(n)===norm(r.name)))){
    const r=regionAt(cluster.center,candidates);if(r)matched.add(r.id);
   }
  }
  for(const id of matched){result.regions.add(id);bump(result.regionCounts,id);}
 }
 return result;
}
let cached:Promise<Boundaries>|null=null;
export function loadBoundaries(){return cached??=fetch(new URL('atlas/boundaries.json',location.href)).then(r=>{if(!r.ok)throw Error('Regional boundaries could not load.');return r.json() as Promise<Boundaries>}).catch(e=>{cached=null;throw e});}

/** Everyone's master catalog lights the map; personal saves stay a separate count. */
export function collectiveCoverage(data:AtlasData,boundaries:Boundaries,snapshot:CollectiveSnapshot|null):AtlasCoverage {
 const items=allCatalogWines().map(w=>({id:w.id,wine_id:w.id,wine_name:w.wine.name,producer:null,vintage:null,notes:null,region:w.wine.region,metadata:{country:w.country}}));
 const result=winebraryCoverage(data,boundaries,items);
 if(!snapshot)return result;
 result.countries=new Set(snapshot.countries.filter(c=>c.wines>0).map(c=>c.id));
 result.countryCounts=new Map(snapshot.countries.map(c=>[c.id,c.wines]));
 for(const entry of snapshot.regions){
  const region=boundaries.regions.find(r=>r.id===entry.id)||boundaries.regions.find(r=>r.country===entry.country&&norm(r.name)===norm(entry.name));
  if(region){result.regions.add(region.id);result.regionCounts.set(region.id,region.id===entry.id?entry.wines:Math.max(entry.wines,result.regionCounts.get(region.id)||0));}
 }
 result.unmapped=snapshot.countries.reduce((sum,c)=>sum+c.unplaced,0);
 return result;
}
export function atlasGlow(count:number){return count<=0?0:Math.min(1,Math.log10(1+count)/Math.log10(100001));}
