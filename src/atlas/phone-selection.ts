/** Phone browsing is local until the user explicitly opens it on glasses. */
export interface AtlasPhoneTarget { countryCode:string; regionName?:string; catalogId?:string; libraryId?:string }
let read:(()=>AtlasPhoneTarget)|null=null;
export function setAtlasPhoneSelection(source:()=>AtlasPhoneTarget){read=source;}
export function atlasPhoneSelection(){return read?.();}
