import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './src/saved-locations';export * from './src/library-search';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {cleanLocations,savedLocations,atLocation,searchLibrary}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.deepEqual(cleanLocations(['  Runway   84 ','runway 84','Other',null]),['Runway 84','Other']);
const wines=[{id:'a',wine_name:'Réserve',producer:'Estate',vintage:2020,region:'Napa Valley',metadata:{country:'United States',grape:'Cabernet Sauvignon',saved_locations:['Runway 84','Second Place']}},{id:'b',wine_name:'Reserve',producer:'Estate',vintage:2021,metadata:{saved_locations:['runway 84']}}];
assert.deepEqual(savedLocations(wines),[{name:'Runway 84',count:2},{name:'Second Place',count:1}]);assert.equal(atLocation(wines[0],'RUNWAY 84'),true);assert.equal(atLocation(wines[1],'Second Place'),false);
assert.deepEqual(searchLibrary(wines,'find reserve 2020').map(w=>w.id),['a']);assert.deepEqual(searchLibrary(wines,'Cabernet Napa').map(w=>w.id),['a']);assert.equal(searchLibrary(wines,'').length,0);assert.equal(searchLibrary(wines,'5').length,0);assert.equal(searchLibrary(wines,'Runway 84').length,2);assert.equal(searchLibrary(wines,'Imaginary wine').length,0);
console.log('PASS restaurant grouping independent of origin, normalized membership, exact numeric/vintage search, accents, multi-field search and empty/no-match results.');
