/** Canonical browsing geography. Preserve source strings; never replace an appellation with its parent. */
export const originKey=(value:string|null|undefined)=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const countries:Record<string,string>={us:'United States',usa:'United States','u s a':'United States','united states':'United States','united states of america':'United States',it:'Italy',ita:'Italy',italia:'Italy',italy:'Italy',fr:'France',fra:'France',france:'France',es:'Spain',esp:'Spain',spain:'Spain',pt:'Portugal',prt:'Portugal',portugal:'Portugal',de:'Germany',deu:'Germany',germany:'Germany',au:'Australia',aus:'Australia',australia:'Australia',nz:'New Zealand',nzl:'New Zealand','new zealand':'New Zealand',ar:'Argentina',arg:'Argentina',argentina:'Argentina',cl:'Chile',chl:'Chile',chile:'Chile',za:'South Africa',zaf:'South Africa','south africa':'South Africa',jp:'Japan',jpn:'Japan',japan:'Japan',ca:'Canada',can:'Canada',canada:'Canada',at:'Austria',aut:'Austria',austria:'Austria',gr:'Greece',grc:'Greece',greece:'Greece',lb:'Lebanon',lbn:'Lebanon',lebanon:'Lebanon',mx:'Mexico',mex:'Mexico',mexico:'Mexico'};
const states:Record<string,string>={ca:'California',california:'California',or:'Oregon',oregon:'Oregon',wa:'Washington',washington:'Washington',ny:'New York','new york':'New York',va:'Virginia',virginia:'Virginia',tx:'Texas',texas:'Texas',mi:'Michigan',michigan:'Michigan',pa:'Pennsylvania',pennsylvania:'Pennsylvania',oh:'Ohio',ohio:'Ohio',mo:'Missouri',missouri:'Missouri',az:'Arizona',arizona:'Arizona',co:'Colorado',colorado:'Colorado',id:'Idaho',idaho:'Idaho',nm:'New Mexico','new mexico':'New Mexico'};
const aliases:Record<string,Record<string,string>>={
 'United States':{'napa valley':'Napa Valley','napa valley ava':'Napa Valley','sonoma county':'Sonoma County','russian river valley':'Russian River Valley','willamette valley':'Willamette Valley'},
 Italy:{toscana:'Tuscany',tuscany:'Tuscany',piemonte:'Piedmont',piedmont:'Piedmont',sicilia:'Sicily',sicily:'Sicily',puglia:'Puglia',apulia:'Puglia'},
 France:{bourgogne:'Burgundy',burgundy:'Burgundy'},
};
// Napa Valley's state is verified by TTB's established-AVA register. Napa town/county stay distinct.
const parents:Record<string,string>={'napa valley':'California','napa valley ava':'California'};
export function canonicalCountry(value:string|null|undefined){const text=(value||'').trim();return countries[originKey(text)]||text;}
export interface WineOrigin {country:string;subdivision:string;region:string;places:string[];path:string[]}
export function wineOrigin(rawCountry?:string|null,rawRegion?:string|null,rawSubdivision?:string|null):WineOrigin{
 let country=canonicalCountry(rawCountry),subdivision=(rawSubdivision||'').trim();
 if(states[originKey(country)]&&country.length>3){subdivision||=states[originKey(country)];country='United States';}
 let parts=String(rawRegion||'').split(/\s*[,;·]\s*/).map(p=>p.trim()).filter(Boolean);
 if(!country&&parts.some(p=>parents[originKey(p)]))country='United States';
 if(!country){const suffix=parts[parts.length-1];if(suffix&&countries[originKey(suffix)])country=countries[originKey(suffix)];}
 if(!country&&parts.some(p=>['california','oregon','washington','new york'].includes(originKey(p))))country='United States';
 if(country==='United States')subdivision=states[originKey(subdivision)]||subdivision;
 parts=parts.filter(p=>{if(canonicalCountry(p)===country)return false;if(country==='United States'&&states[originKey(p)]){subdivision||=states[originKey(p)];return false;}return true;});
 const places=[...new Map(parts.map(p=>{const label=aliases[country]?.[originKey(p)]||p;return [originKey(label),label]})).values()];
 if(country==='United States'&&!subdivision)subdivision=parents[originKey(places[0])]||'';
 // Separate state/province context from the region key used to group wines.
 const region=places.join(' · '),path=[country,subdivision,...places].filter((p,i,a)=>p&&a.findIndex(v=>originKey(v)===originKey(p))===i);
 return {country,subdivision,region,places,path};
}
