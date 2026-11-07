import assert from 'node:assert/strict';
import {publicContent} from '../supabase/functions/_shared/public-content.ts';
const original={sources:[{title:'Producer',url:'https://producer.example/wine?utm_source=openai'}],search_html:'<a href="https://producer.example">Source</a>',notes:'Cassis. https://producer.example/wine',image_url:'https://mcmtasetompygfktzhpr.supabase.co/storage/v1/object/public/wines/bottle.png',photo:'data:image/png;base64,AAAA',provenance:{source_page:'https://producer.example',source_image:'https://images.example/bottle.jpg'},user:{access_token:'unchanged',name:'Wine Lover'}};
const result=publicContent(original);
assert.equal(result.sources[0].url,'');assert.equal(result.search_html,'');assert.equal(result.provenance.source_page,'');assert.equal(result.provenance.source_image,'');assert.equal(result.notes,'Cassis. ');
assert.equal(result.image_url,original.image_url);assert.equal(result.photo,original.photo);assert.deepEqual(result.user,original.user);
assert.ok(original.sources[0].url.includes('producer.example'),'stored audit object is never mutated');
console.log('PASS: outgoing evidence URLs removed; server originals, bottle assets and account fields preserved.');
