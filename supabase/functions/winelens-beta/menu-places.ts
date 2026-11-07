import index from './data/menu-places.json' with {type:'json'};
const norm=(v:string)=>v.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Map only explicitly extracted places. Never derive geography from a producer/name. */
export function menuPlace(rawCountry:string,rawRegion:string){
 const countries=index.countries as Record<string,string>,regions=index.regions as Record<string,string[]>;
 let country=countries[norm(rawCountry)]||'',region=rawRegion;
 if(!country&&rawCountry&&regions[norm(rawCountry)])region=region||rawCountry;
 const whole=regions[norm(region)],parts=whole?[whole]:region.split(',').map(s=>regions[norm(s)]).filter(Boolean);
 const origins=new Set(parts.map(p=>p[1]));
 if(!country&&origins.size===1)country=[...origins][0];
 if(whole&&whole[1]===country)region=whole[0];
 return {country,region};
}
