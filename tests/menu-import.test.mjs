import {menuHtmlText,menuTextChunks} from '../supabase/functions/winelens-beta/menu-html.ts';
import assert from 'node:assert/strict';
import {importMenu,normalizeMenu,MENU_MAX_BYTES} from '../supabase/functions/winelens-beta/menu-import.ts';
const entry={wine_name:'Château Test',producer:'Domaine A',vintage:'2022',section:'Wines',page:3,source_text:'Domaine A Château Test 2022',needs_review:false,reason:''};
const output={entries:[entry,{...entry,wine_name:'Chateau Test'},{...entry,vintage:'2021',source_text:'Domaine A Château Test 2021'},{...entry,producer:'Domaine B'},{...entry,vintage:'20-yr'}],warnings:[],truncated:false};
const normalized=normalizeMenu(output);
assert.equal(normalized.entries.length,4);assert.equal(normalized.duplicates,1);assert.equal(normalized.entries[3].vintage,'');assert.equal(normalized.entries[3].needs_review,true);
assert.equal(normalizeMenu({...output,entries:[{...entry,source_text:''}]}).entries.length,0);
let calls=[];
const resolveHost=async()=>['93.184.216.34'];
const good=async(url,options)=>{calls.push(String(url));if(String(url).includes('api.openai.com')){const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.input[0].content[1].type,'input_file');assert.equal(body.text.format.strict,true);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});}assert.equal(options.headers.Authorization,undefined);return new Response('%PDF-1.4 test',{headers:{'content-type':'application/pdf'}});};
const deps={env:k=>k==='OPENAI_API_KEY'?'fixture':undefined,fetch:good,resolveHost};
assert.equal((await importMenu({url:'https://example.com/menu.pdf'},deps)).entries.length,4);
assert.equal((await importMenu({document:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4 fixture').toString('base64')},deps)).format,'PDF');
for(const body of [{},{url:'https://example.com',document:'x'},{document:'data:application/pdf;base64,@@@'},{document:'data:application/pdf;base64,'+Buffer.from('<html>not PDF').toString('base64')},{document:'x'.repeat(Math.ceil(MENU_MAX_BYTES/3)*4+101)}])await assert.rejects(()=>importMenu(body,deps));
const before=calls.length;
for(const url of ['http://example.com/menu','https://127.0.0.1/menu','https://user:pass@example.com/menu'])await assert.rejects(()=>importMenu({url},deps));
await assert.rejects(()=>importMenu({url:'https://example.com/menu'},{...deps,resolveHost:async()=>['192.168.1.1']}));assert.equal(calls.length,before);
let redirects=0;await assert.rejects(()=>importMenu({url:'https://example.com/menu'},{...deps,fetch:async()=>{redirects++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}})}}));assert.equal(redirects,1);
await assert.rejects(()=>importMenu({url:'https://example.com/menu'},{...deps,fetch:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})}));
await assert.rejects(()=>importMenu({url:'https://example.com/menu'},{...deps,fetch:async()=>new Response('pdf',{headers:{'content-type':'application/pdf','content-length':String(MENU_MAX_BYTES+1)}})}));
await assert.rejects(()=>importMenu({document:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4 fixture').toString('base64')},{...deps,fetch:async()=>Response.json({status:'incomplete'})}),/too long/);
console.log('PASS menu import: URL/upload, strict structured output, safe external fetch, redirects/private hosts, type/signature/size limits, incomplete output, dedup and vintages.');
const tiny=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==','base64');
const imageResult=await importMenu({url:'https://example.com/menu'},{...deps,fetch:async(url,options)=>{if(String(url).includes('api.openai.com')){assert.equal(JSON.parse(options.body).input[0].content[1].type,'input_image');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({entries:[entry],warnings:[],truncated:false})}]}]});}return new Response(tiny);}});
assert.equal(imageResult.format,'Image');assert.equal(imageResult.entries[0].needs_review,true);assert.match(imageResult.warnings[0],/small preview/);
const unsupportedYear=normalizeMenu({entries:[{...entry,source_text:'Estate Cabernet 18',vintage:'2018'},{...entry,vintage:'['}],warnings:[],truncated:false});assert.equal(unsupportedYear.entries[0].vintage,'');assert.equal(unsupportedYear.entries[0].needs_review,true);
console.log('PASS: signature detection with missing content type, low-resolution review, and no invented full years.');

const html='<html><head><script>STEAL DATA</script></head><body><nav>Buy gift cards</nav><h2>Wine List</h2><h3>Red</h3><table><tr><td>Estate &amp; Sons Cabernet</td><td>2022</td></tr></table><h3>Food</h3><p>Clams</p></body></html>';
const htmlResult=await importMenu({url:'https://example.com/menu'},{...deps,fetch:async(url,options)=>{
 if(String(url).includes('api.openai.com')){const sent=JSON.parse(options.body).input[0].content[1];assert.equal(sent.type,'input_text');assert.match(sent.text,/Estate & Sons Cabernet.*2022/);assert(!sent.text.includes('STEAL DATA'));assert(!sent.text.includes('Buy gift cards'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});}
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
}});
assert.equal(htmlResult.format,'Web page');
console.log('PASS: inert HTML text and entities, table columns, navigation/scripts excluded, web menu extraction.');

const focused=menuHtmlText('<div id="dinner">Food and other menu text</div><section id="wine-list"><h2>Wines</h2><p>Estate Cabernet 2022 from Napa Valley</p></section><footer>Other text</footer>');assert.match(focused,/Cabernet/);assert(!focused.includes('Food'));assert(!focused.includes('Other text'));
assert.throws(()=>menuHtmlText('<script>Only scripts</script>'),/no readable/);
console.log('PASS: focused wine sections and empty/script-only menu fallback.');

const longMenu='## Red Wines\n'+Array.from({length:250},(_,i)=>`- Estate Wine ${i}\nNapa Valley 2022`).join('\n');
const sections=menuTextChunks(longMenu);assert(sections.length>1);assert(sections.every(s=>s.startsWith('## Red Wines')));for(let i=0;i<250;i++)assert(sections.some(s=>s.includes(`- Estate Wine ${i}\nNapa Valley 2022`)),'label/year stay together');
console.log('PASS: long menu section splitting preserves all entries and section context.');

const {menuPlace}=await import('../supabase/functions/winelens-beta/menu-places.ts');
assert.deepEqual(menuPlace('', 'Tuscany'),{country:'Italy',region:'Tuscany'});
assert.deepEqual(menuPlace('California', ''),{country:'United States',region:'California'});
assert.deepEqual(menuPlace('', 'Napa Valley'),{country:'United States',region:'Napa Valley'});
assert.deepEqual(menuPlace('', 'An unknown valley'),{country:'',region:'An unknown valley'});
assert.equal(menuPlace('France','Tuscany').country,'France','explicit country never silently overwritten by inferred region');
