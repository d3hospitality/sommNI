import type {LibraryWine} from './winebrary';
/** Restaurant/list membership is separate from the wine's geographic origin. */
export const locationKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export function cleanLocations(values:unknown):string[]{
 if(!Array.isArray(values))return [];
 const result=new Map<string,string>();
 for(const value of values){if(typeof value!=='string')continue;const name=value.trim().replace(/\s+/g,' ').slice(0,120);if(name)result.set(locationKey(name),result.get(locationKey(name))||name);}
 return [...result.values()].slice(0,100);
}
export const wineLocations=(wine:Pick<LibraryWine,'metadata'>)=>cleanLocations(wine.metadata?.saved_locations);
export const atLocation=(wine:Pick<LibraryWine,'metadata'>,location:string)=>!location||wineLocations(wine).some(name=>locationKey(name)===locationKey(location));
export function savedLocations(wines:LibraryWine[]){
 const locations=new Map<string,{name:string;count:number}>();
 for(const wine of wines)for(const name of wineLocations(wine)){const key=locationKey(name),entry=locations.get(key);if(entry)entry.count++;else locations.set(key,{name,count:1});}
 return [...locations.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function addLocation(wine:Pick<LibraryWine,'metadata'>,location:string){return {...wine.metadata,saved_locations:cleanLocations([...wineLocations(wine),location])};}
