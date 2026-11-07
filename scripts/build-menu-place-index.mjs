/** Exact place names from our bundled Atlas/catalog; collisions remain unresolved. */
import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const atlas=await read('public/atlas/atlas-data.json'),bounds=await read('public/atlas/boundaries.json'),catalog=await read('supabase/functions/winelens-beta/data/catalog.json');
const norm=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const countries={},byCode=new Map(atlas.countries.map(c=>[c.code,c.name]));for(const c of atlas.countries){countries[norm(c.name)]=c.name;countries[norm(c.code)]=c.name;}
Object.assign(countries,{usa:'United States',us:'United States','united states of america':'United States',italia:'Italy',francia:'France'});
const places=new Map();const add=(name,country)=>{if(!country||!name)return;const key=norm(name),old=places.get(key);if(!old)places.set(key,{name,countries:new Set([country])});else old.countries.add(country)};
for(const r of [...atlas.regions,...bounds.regions])add(r.name,byCode.get(r.country));
for(const w of catalog.wines)add(w.region.split(',')[0],countries[norm(w.country)]||w.country);
const regions=Object.fromEntries([...places].filter(([,v])=>v.countries.size===1).map(([k,v])=>[k,[v.name,[...v.countries][0]]]));
for(const [alias,target] of Object.entries({toscana:'tuscany',piemonte:'piedmont',sicilia:'sicily',puglia:'apulia',bourgogne:'burgundy',napa:'napa valley','russian river':'russian river valley','friuli venezia guilia':'friuli venezia giulia'}))if(regions[target])regions[alias]=regions[target];
await writeFile('supabase/functions/winelens-beta/data/menu-places.json',JSON.stringify({countries,regions})+'\n');
console.log(`${Object.keys(regions).length} unambiguous Atlas region names`);
