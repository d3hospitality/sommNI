import type {LibraryWine} from './winebrary';
import {wineLocations} from './saved-locations';
const normalized=(value:unknown)=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Search only actual library/catalog records; never invent a bottle from speech. */
export function searchLibrary(wines:LibraryWine[],query:string):LibraryWine[]{
 const text=normalized(query).replace(/^(?:please )?(?:search for|look for|find|show me)(?: the)? /,'').replace(/ please$/,'');
 const tokens=text.split(/\s+/).filter(Boolean);if(!tokens.length)return [];
 return wines.filter(wine=>{const haystack=normalized([wine.wine_name,wine.producer,wine.vintage,wine.region,wine.metadata?.country,wine.metadata?.grape,wine.metadata?.color,...wineLocations(wine)].filter(Boolean).join(' '));return tokens.every(token=>/^\d+$/.test(token)?haystack.split(' ').includes(token):haystack.includes(token));});
}
