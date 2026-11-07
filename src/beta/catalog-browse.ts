import type { CatalogWine } from '../identity';
import { TYPE_DISPLAY, type WineType } from '../constants';
import { countryLabel, regionLabel } from '../origin-filters';

export type CatalogFilter = WineType | 'All' | 'Favorites';
export type CatalogGrouping = 'auto' | 'country' | 'variety' | 'style';
export type CatalogSort = 'name' | 'producer' | 'vintage';
export interface CatalogSelection {query:string;country:string;region:string;filter:CatalogFilter;grouping:CatalogGrouping;sort:CatalogSort}
const normalize=(value:string)=>value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
export const catalogOrigin=(w:CatalogWine)=>({country:countryLabel(w.country),region:regionLabel(w.wine.region,w.country)});
const styleMatches=(w:CatalogWine,filter:CatalogFilter,favorites:ReadonlySet<string>)=>filter==='All'||(filter==='Favorites'?favorites.has(w.id):filter===w.type);
const tally=(wines:CatalogWine[],label:(wine:CatalogWine)=>string)=>{const counts=new Map<string,number>();for(const wine of wines){const key=label(wine);counts.set(key,(counts.get(key)||0)+1);}return [...counts].sort(([a],[b])=>a.localeCompare(b));};
const newest=(w:CatalogWine)=>Math.max(0,...(w.vintages||[]).filter(v=>/^\d{4}$/.test(v)).map(Number));

export function browseCatalog(all:CatalogWine[],selection:CatalogSelection,favorites:ReadonlySet<string>){
 const {query,country,region,filter,grouping,sort}=selection;
 const words=normalize(query.trim()).split(/\s+/).filter(Boolean);
 const searched=all.filter(w=>{const origin=catalogOrigin(w);return words.every(word=>normalize([w.wine.name,w.wine.grape,w.wine.region,w.country,origin.country,origin.region,w.wine.nose,w.wine.style,TYPE_DISPLAY[w.type],...(w.vintages||[])].join(' ')).includes(word));});
 const byStyle=searched.filter(w=>styleMatches(w,filter,favorites));
 const byPlace=searched.filter(w=>(!country||catalogOrigin(w).country===country)&&(!region||catalogOrigin(w).region===region));
 const wines=byPlace.filter(w=>styleMatches(w,filter,favorites)).sort((a,b)=>{
  const first=sort==='producer'?(a.wine.name.split(' – ').slice(1).join(' – ').localeCompare(b.wine.name.split(' – ').slice(1).join(' – '))):sort==='vintage'?newest(b)-newest(a):0;
  return first||a.wine.name.localeCompare(b.wine.name)||a.id.localeCompare(b.id);
 });
 const level=grouping==='auto'?(!country?'country':!region?'region':'style'):grouping;
 const groupLabel=(w:CatalogWine)=>level==='country'?catalogOrigin(w).country:level==='region'?catalogOrigin(w).region:level==='style'?TYPE_DISPLAY[w.type]:w.wine.grape||'Variety to confirm';
 const groups=new Map<string,CatalogWine[]>();for(const wine of wines){const label=groupLabel(wine);if(!groups.has(label))groups.set(label,[]);groups.get(label)!.push(wine);}
 const kind=filter==='Sake'?'Sake':filter==='Favorites'?'Favorite bottles':filter==='All'?'Wines':`${TYPE_DISPLAY[filter]} wines`;
 return {wines,groups:[...groups].sort(([a,aa],[b,bb])=>(level==='style'?bb.length-aa.length:0)||a.localeCompare(b)),level,
  title:query.trim()?'Your matches.':region?`${kind} · ${region}`:country?`${kind} of ${country}`:filter==='All'?'Explore the wines.':`${kind}.`,
  countries:tally(byStyle,w=>catalogOrigin(w).country),regions:tally(byStyle.filter(w=>catalogOrigin(w).country===country),w=>catalogOrigin(w).region),
  styleCount:(value:CatalogFilter)=>byPlace.filter(w=>styleMatches(w,value,favorites)).length};
}
