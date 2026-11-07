import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
// Exercise the production navigation class in isolation from hardware/bootstrap imports.
const source=await readFile('src/atlas-app.ts','utf8'),start=source.indexOf('export class CatalogAtlasNavigator'),end=source.indexOf('\n}',start)+2;
const dir=await mkdtemp(tmpdir()+'/sommni-handoff-');
await build({stdin:{contents:`import {AtlasNavigator} from './src/atlas/navigator';import {wineRegionFor,wineRegionById} from './src/atlas/wine-regions';import {placeSearchScore} from './src/atlas/place-search';const norm=s=>s.toLowerCase();const entryLabel=e=>e.kind==='library'?e.wine.wine_name:e.item.wine.name;${source.slice(start,end)}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:dir+'/nav.mjs'});
const {CatalogAtlasNavigator}=await import(dir+'/nav.mjs');
const countries=[{code:'USA',name:'United States',regionCount:2},{code:'ITA',name:'Italy',regionCount:1}];
const regions=[{id:'napa',name:'Napa Valley',country:'USA',count:2},{id:'oregon',name:'Willamette Valley',country:'USA',count:1},{id:'tuscany',name:'Tuscany',country:'ITA',count:1}];
const catalog=id=>({kind:'catalog',item:{id,wine:{name:id}}}),personal={kind:'library',wine:{id:'saved-napa',wine_id:'napa-public',wine_name:'My Napa vintage'}};
const entries=new Map([['napa',[catalog('napa-public'),personal]],['oregon',[catalog('oregon-public')]],['tuscany',[catalog('italy-public')]]]);
const scope={countries,data:{countries,regions},entries,mineByRegion:new Map(),mineByCountry:new Map(),countryWines:new Map(),unmapped:new Set()};
const nav=new CatalogAtlasNavigator(scope,true);
nav.choosePhoneTarget({countryCode:'USA',catalogId:'oregon-public'});assert.equal(nav.mode,'detail');assert.equal(nav.region.id,'oregon');assert.equal(nav.wines[nav.wineIndex].item.id,'oregon-public');assert.equal(nav.infoSelected,false);nav.back();assert.equal(nav.mode,'regions');nav.back();assert.equal(nav.mode,'countries');
nav.choosePhoneTarget({countryCode:'USA',libraryId:'saved-napa',catalogId:'napa-public'});assert.equal(nav.wines[nav.wineIndex],personal,'saved vintage takes precedence over its public reference');
assert.throws(()=>nav.choosePhoneTarget({countryCode:'ITA',libraryId:'deleted'}),/no longer available/);assert.equal(nav.country.code,'USA','stale handoff does not move the current display');
assert.throws(()=>nav.choosePhoneTarget({countryCode:'XXX'}),/no wines/);
nav.choosePhoneTarget({countryCode:'ITA',regionName:'Tuscany'});assert.equal(nav.region.id,'tuscany');assert.equal(nav.infoSelected,true);
nav.choosePhoneTarget({countryCode:'USA'});assert.equal(nav.country.code,'USA');assert.equal(nav.mode,'countries');
console.log('PASS phone-to-G2 country, region and exact bottle handoff; saved vintage precedence, stale ID rejection and Back navigation.');

const french=catalog('pauillac-public');scope.countries.push({code:'FRA',name:'France',regionCount:2});scope.data.regions.push({id:'wine:FRA:bordeaux',name:'Bordeaux',country:'FRA',count:1},{id:'pauillac',name:'Pauillac',country:'FRA',count:1});scope.entries.set('wine:FRA:bordeaux',[french]);scope.entries.set('pauillac',[french]);
nav.setScope(scope,true);nav.choosePhoneTarget({countryCode:'FRA',catalogId:'pauillac-public'});assert.equal(nav.wines[nav.wineIndex],french);assert.equal(nav.mode,'detail');nav.back();assert.equal(nav.mode,'regions');
// Source group comes before the virtual wine-region row in the production atlas.
scope.data.regions.reverse();nav.setScope(scope,true);nav.choosePhoneTarget({countryCode:'FRA',catalogId:'pauillac-public'});assert.equal(nav.region.id,'pauillac');assert.equal(nav.wines[nav.wineIndex],french);console.log('PASS Bordeaux parent/appellation handoff regardless of region row ordering.');
nav.chooseCountry('USA');nav.select();
assert.match(nav.rows,/Search by Voice/);assert.match(nav.rows,/3w · All Wines/);
nav.scroll(-1);assert.match(nav.rows,/> 3w · All Wines/);nav.select();
assert.equal(nav.mode,'detail');assert.equal(nav.region,undefined);assert.equal(nav.wines.length,3);assert.equal(nav.view.country.code,'USA');assert.equal(nav.view.region,undefined);assert.match(nav.rows,/About United States/);
for(let i=0;i<3;i++){nav.select();assert.equal(nav.pending,nav.wines[i]);nav.scroll(1);}
nav.back();assert.equal(nav.mode,'regions');assert.match(nav.rows,/> 3w · All Wines/);
// A region may appear in multiple administrative groups, but the country shortcut counts it once.
scope.data.regions.push({id:'duplicate-group',name:'Other Napa Group',country:'USA',count:1});scope.entries.set('duplicate-group',entries.get('napa'));
nav.setScope(scope,true);assert.match(nav.rows,/3w · All Wines/);nav.select();assert.equal(nav.wines.length,3);nav.back();nav.scroll(-1);assert.match(nav.rows,/> Search by Voice/);
console.log('PASS country-wide All Wines, deduplication across region groups, scroll/select every wine, Voice capitalization and Back cursor restoration.');
