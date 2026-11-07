import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(tmpdir()+'/sommni-pairings-g2-');
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.readyState='loading';
await build({stdin:{contents:`export {buildTastingNotesPage} from './src/pages';export {allCatalogWines} from './src/identity';export {readingText,READING_MAX_BYTES} from './src/reading/document';export {validateGlassesPage} from './src/glasses-page';export {foodPairingsText} from './src/food-pairings';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:dir+'/pages.mjs',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}});
const g=await import(dir+'/pages.mjs');let count=0,pairings=0;
for(const entry of g.allCatalogWines()){
 const page=g.buildTastingNotesPage(entry.wine,entry.id);g.validateGlassesPage(page);const text=g.readingText(page,5);assert.ok(new TextEncoder().encode(text).length<=g.READING_MAX_BYTES);assert.ok(text.includes('LOOK')||text.includes('PALATE'));
 if(g.foodPairingsText({grape:entry.wine.grape,style:entry.wine.style,color:entry.type})){assert.match(text,/AT THE TABLE/);pairings++;}
 count++;
}
assert.ok(count>=215);assert.ok(pairings>200);console.log(`PASS: ${count} catalog G2 notes pages validate; ${pairings} include pairings, native scroll buffers remain within bounds.`);
